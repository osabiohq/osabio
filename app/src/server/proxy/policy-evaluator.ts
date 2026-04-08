/**
 * Proxy Policy Evaluator — Pre-request policy enforcement
 *
 * Evaluates three policy dimensions before forwarding LLM requests:
 * 1. Model access — agent allowed to use requested model
 * 2. Budget enforcement — workspace daily spend within limit
 * 3. Rate limiting — in-memory sliding window per workspace
 *
 * Pure core with effect boundaries at spend queries and observation writes.
 *
 * Port: (ProxyPolicyContext, ProxyPolicyDependencies) -> Promise<ProxyPolicyResult>
 */

import { RecordId } from "surrealdb";
import type { Surreal } from "surrealdb";
import type { InflightTracker } from "../runtime/types";
import { createObservation } from "../observation/queries";
import { log } from "../telemetry/logger";
import {
  type RateLimiterState,
  checkRateLimit,
} from "./rate-limiter";
import { evaluateRegoPolicy, createEngineCache } from "../policy/rego-evaluator";
import type { IntentEvaluationContext } from "../policy/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProxyPolicyContext = {
  readonly workspaceId: string;
  readonly agentType?: string;
  readonly model: string;
};

export type ProxyPolicyResult =
  | { decision: "allow"; policyIds: string[] }
  | { decision: "deny_model"; status: 403; body: ModelViolationBody }
  | { decision: "deny_budget"; status: 429; body: BudgetExceededBody }
  | { decision: "deny_rate_limit"; status: 429; body: RateLimitBody; retryAfterSeconds: number };

type ModelViolationBody = {
  error: "policy_violation";
  policy_ref: string;
  policy_description: string;
  model_requested: string;
  model_suggestion: string[];
  remediation: string;
};

type BudgetExceededBody = {
  error: "budget_exceeded";
  current_spend_usd: number;
  daily_limit_usd: number;
  time_until_reset_seconds: number;
  remediation: string;
};

type RateLimitBody = {
  error: "rate_limit_exceeded";
  rate_limit_per_minute: number;
  reset_time_unix: number;
  remediation: string;
};

type ProxyPolicyRecord = {
  id: RecordId<"policy">;
  title: string;
  description?: string;
  version: number;
  selector: { agent_role?: string };
  rego_source: string;
  status: string;
};

export type SpendCacheEntry = {
  spendUsd: number;
  fetchedAt: number;
};

export type SpendCache = Map<string, SpendCacheEntry>;

const SPEND_CACHE_TTL_MS = 10_000; // 10 seconds

export type ProxyPolicyDependencies = {
  readonly surreal: Surreal;
  readonly inflight: InflightTracker;
  readonly rateLimiterState: RateLimiterState;
  readonly spendCache: SpendCache;
  readonly noPolicyWarnedWorkspaces: Set<string>;
};

// ---------------------------------------------------------------------------
// Model Access Evaluation via Rego
// ---------------------------------------------------------------------------

type ModelCheckResult =
  | { allowed: true; policyIds: string[] }
  | { allowed: false; policyRef: string; policyDescription: string };

async function evaluateModelAccess(
  policies: ProxyPolicyRecord[],
  context: ProxyPolicyContext,
): Promise<ModelCheckResult> {
  if (!context.agentType) {
    log.warn("proxy.policy.missing_agent_type", "Request lacks agent type; model access policies not enforced", {
      model: context.model,
      workspace_id: context.workspaceId,
    });
    return { allowed: true, policyIds: policies.map((p) => p.id.id as string) };
  }

  const relevantPolicies = policies.filter(
    (p) => p.selector.agent_role === context.agentType,
  );

  if (relevantPolicies.length === 0) {
    return { allowed: true, policyIds: policies.map((p) => p.id.id as string) };
  }

  // Evaluate each relevant policy via Rego. Input exposes model and agent_role
  // under action_spec.params so Rego policies use consistent field paths.
  const proxyInput = {
    goal: "proxy_model_access",
    reasoning: "proxy model access policy check",
    priority: 0,
    action_spec: { provider: "llm", action: "invoke", params: { model: context.model } },
    requester_type: "agent",
    requester_role: context.agentType,
  } as IntentEvaluationContext;

  const cache = createEngineCache();

  for (const policy of relevantPolicies) {
    const result = await evaluateRegoPolicy(
      policy.rego_source,
      policy.id.id as string,
      policy.version,
      proxyInput,
      cache,
    );

    if (result.decision === "deny") {
      return {
        allowed: false,
        policyRef: policy.id.id as string,
        policyDescription: policy.description ?? policy.title,
      };
    }
  }

  return {
    allowed: true,
    policyIds: relevantPolicies.map((p) => p.id.id as string),
  };
}

// ---------------------------------------------------------------------------
// Budget Check (effect boundary: DB query with cache)
// ---------------------------------------------------------------------------

function secondsUntilMidnightUtc(now: Date): number {
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return Math.ceil((tomorrow.getTime() - now.getTime()) / 1000);
}

async function getTodaySpend(
  surreal: Surreal,
  workspaceId: string,
  cache: SpendCache,
): Promise<number> {
  const now = Date.now();
  const cached = cache.get(workspaceId);
  if (cached && now - cached.fetchedAt < SPEND_CACHE_TTL_MS) {
    return cached.spendUsd;
  }

  try {
    const ws = new RecordId("workspace", workspaceId);
    const results = await surreal.query<[Array<{ total: number }>]>(
      `SELECT math::sum(cost_usd) AS total FROM trace WHERE workspace = $ws AND created_at >= time::floor(time::now(), 1d) GROUP ALL;`,
      { ws },
    );
    const total = results[0]?.[0]?.total ?? 0;
    cache.set(workspaceId, { spendUsd: total, fetchedAt: Date.now() });
    return total;
  } catch (error) {
    log.error("proxy.policy.spend_query_failed", "Failed to query workspace spend", error);
    // On query failure, use stale cache if available
    if (cached) return cached.spendUsd;
    return 0;
  }
}

async function getDailyBudget(
  surreal: Surreal,
  workspaceId: string,
): Promise<number | undefined> {
  try {
    const ws = new RecordId("workspace", workspaceId);
    const results = await surreal.query<[Array<{ daily_budget_usd?: number }>]>(
      `SELECT daily_budget_usd FROM $ws;`,
      { ws },
    );
    return results[0]?.[0]?.daily_budget_usd;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Load workspace policies (effect boundary)
// ---------------------------------------------------------------------------

async function loadWorkspacePolicies(
  surreal: Surreal,
  workspaceId: string,
): Promise<ProxyPolicyRecord[]> {
  try {
    const ws = new RecordId("workspace", workspaceId);
    const results = await surreal.query<[ProxyPolicyRecord[]]>(
      `SELECT * FROM policy WHERE workspace = $ws AND status = 'active';`,
      { ws },
    );
    return results[0] ?? [];
  } catch (error) {
    log.error("proxy.policy.load_failed", "Failed to load workspace policies", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Policy Decision Logger (async)
// ---------------------------------------------------------------------------

export type PolicyDecisionLog = {
  decision: "pass" | "deny";
  policy_refs: string[];
  reason?: string;
  timestamp: string;
};

// ---------------------------------------------------------------------------
// Main Evaluation Pipeline
// ---------------------------------------------------------------------------

export async function evaluateProxyPolicy(
  context: ProxyPolicyContext,
  deps: ProxyPolicyDependencies,
): Promise<ProxyPolicyResult> {
  // Step 1: Rate limit check (in-memory, sub-ms)
  if (context.workspaceId) {
    const rateLimitResult = checkRateLimit(
      deps.rateLimiterState,
      context.workspaceId,
    );

    if (!rateLimitResult.allowed) {
      log.info("proxy.policy.rate_limited", "Rate limit exceeded", {
        workspace_id: context.workspaceId,
        rate_limit_per_minute: rateLimitResult.rateLimitPerMinute,
      });

      return {
        decision: "deny_rate_limit",
        status: 429,
        body: {
          error: "rate_limit_exceeded",
          rate_limit_per_minute: rateLimitResult.rateLimitPerMinute,
          reset_time_unix: rateLimitResult.resetTimeUnix,
          remediation: `Rate limit of ${rateLimitResult.rateLimitPerMinute} requests per minute exceeded. Wait ${rateLimitResult.retryAfterSeconds} seconds before retrying.`,
        },
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      };
    }
  }

  // Step 2: Budget check (cached DB query)
  if (context.workspaceId) {
    const dailyBudget = await getDailyBudget(deps.surreal, context.workspaceId);
    if (dailyBudget !== undefined) {
      const currentSpend = await getTodaySpend(deps.surreal, context.workspaceId, deps.spendCache);
      if (currentSpend >= dailyBudget) {
        const now = new Date();
        const resetSeconds = secondsUntilMidnightUtc(now);

        log.info("proxy.policy.budget_exceeded", "Daily budget exceeded", {
          workspace_id: context.workspaceId,
          current_spend_usd: currentSpend,
          daily_limit_usd: dailyBudget,
        });

        return {
          decision: "deny_budget",
          status: 429,
          body: {
            error: "budget_exceeded",
            current_spend_usd: currentSpend,
            daily_limit_usd: dailyBudget,
            time_until_reset_seconds: resetSeconds,
            remediation: `Daily budget of $${dailyBudget.toFixed(2)} exceeded. Current spend: $${currentSpend.toFixed(2)}. Budget resets at midnight UTC (${resetSeconds}s).`,
          },
        };
      }
    }
  }

  // Step 3: Model access policy check (DB + pure evaluation)
  if (context.workspaceId) {
    const policies = await loadWorkspacePolicies(deps.surreal, context.workspaceId);

    if (policies.length === 0) {
      // No policies: permissive default with async warning (deduplicated per-process via Set)
      if (!deps.noPolicyWarnedWorkspaces.has(context.workspaceId)) {
        deps.noPolicyWarnedWorkspaces.add(context.workspaceId);
        const workspaceRecord = new RecordId("workspace", context.workspaceId);
        deps.inflight.track(
          createObservation({
            surreal: deps.surreal,
            workspaceRecord,
            text: `No LLM proxy policies configured for workspace. All requests are being forwarded without model access restrictions. Consider creating policies to control which models each agent type can use.`,
            severity: "warning",
            observationType: "missing",
            sourceAgent: "llm-proxy",
            now: new Date(),
          }).catch((error) => {
            log.error("proxy.policy.observation_failed", "Failed to create no-policy warning", error);
            return undefined as any;
          }),
        );
      }

      return { decision: "allow", policyIds: [] };
    }

    const modelCheck = await evaluateModelAccess(policies, context);

    if (!modelCheck.allowed) {
      log.info("proxy.policy.model_denied", "Model access denied by policy", {
        workspace_id: context.workspaceId,
        agent_type: context.agentType,
        model: context.model,
        policy_ref: modelCheck.policyRef,
      });

      return {
        decision: "deny_model",
        status: 403,
        body: {
          error: "policy_violation",
          policy_ref: modelCheck.policyRef,
          policy_description: modelCheck.policyDescription,
          model_requested: context.model,
          model_suggestion: [],
          remediation: `Model '${context.model}' is not allowed for agent type '${context.agentType}'. Contact workspace admin to update model access policies.`,
        },
      };
    }

    return { decision: "allow", policyIds: modelCheck.policyIds };
  }

  // No workspace: permissive (degraded mode)
  return { decision: "allow", policyIds: [] };
}

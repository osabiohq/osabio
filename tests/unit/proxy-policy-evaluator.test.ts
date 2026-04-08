/**
 * Unit Tests: Proxy Policy Evaluator (model access evaluation — pure logic)
 *
 * Tests the pure model access evaluation logic extracted from the policy evaluator.
 * No DB, no IO. Validates that model access rules are correctly applied
 * based on agent role and allowed model lists.
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";

// We test the evaluateModelAccess function indirectly through evaluateProxyPolicy
// by providing mock dependencies. For pure logic testing, we extract and test
// the model access evaluation via the public interface.

// Since evaluateModelAccess is private, we test through the public pipeline
// with stubbed dependencies.

// Import the types we need to construct test data
import {
  evaluateProxyPolicy,
  type ProxyPolicyDependencies,
  type SpendCache,
} from "../../app/src/server/proxy/policy-evaluator";
import {
  createRateLimiterState,
} from "../../app/src/server/proxy/rate-limiter";

// ---------------------------------------------------------------------------
// Stub Surreal that returns canned policy data
// ---------------------------------------------------------------------------

function createStubSurreal(policies: Array<{
  id: string;
  title: string;
  description?: string;
  agentRole?: string;
  regoSource?: string;
  version?: number;
}>, options?: { dailyBudget?: number; todaySpend?: number }) {
  return {
    query: async (sql: string, params?: Record<string, unknown>) => {
      // loadWorkspacePolicies
      if (sql.includes("FROM policy WHERE")) {
        return [policies.map((p) => ({
          id: new RecordId("policy", p.id),
          title: p.title,
          description: p.description,
          version: p.version ?? 1,
          selector: { agent_role: p.agentRole },
          rego_source: p.regoSource ?? "package osabio.policy\ndefault allow = true",
          status: "active",
        }))];
      }
      // getDailyBudget
      if (sql.includes("daily_budget_usd")) {
        return [[{ daily_budget_usd: options?.dailyBudget }]];
      }
      // getTodaySpend
      if (sql.includes("math::sum")) {
        return [[{ total: options?.todaySpend ?? 0 }]];
      }
      // createNoPolicyWarning (observation)
      if (sql.includes("CREATE $obs")) {
        return [[]];
      }
      return [[]];
    },
  } as unknown as import("surrealdb").Surreal;
}

function createStubDeps(
  surreal: import("surrealdb").Surreal,
): ProxyPolicyDependencies {
  return {
    surreal,
    inflight: { track: () => {}, drain: async () => {} },
    rateLimiterState: createRateLimiterState(1000), // high limit for non-rate-limit tests
    spendCache: new Map() as SpendCache,
    noPolicyWarnedWorkspaces: new Set<string>(),
  };
}

describe("Proxy Policy Evaluator", () => {
  describe("model access evaluation", () => {
    it("allows request when model is in allowed list", async () => {
      const surreal = createStubSurreal([{
        id: "pol-1",
        title: "Coding Agent Models",
        agentRole: "coding-agent",
        regoSource: 'package osabio.policy\ndefault allow = false\nallow if { input.action_spec.params.model in {"claude-sonnet-4-20250514", "claude-opus-4-20250514"} }',
      }]);

      const result = await evaluateProxyPolicy(
        { workspaceId: "ws-1", agentType: "coding-agent", model: "claude-sonnet-4-20250514" },
        createStubDeps(surreal),
      );

      expect(result.decision).toBe("allow");
    });

    it("denies request when model is not in allowed list", async () => {
      const surreal = createStubSurreal([{
        id: "pol-1",
        title: "Observer Models",
        description: "Observer can only use haiku",
        agentRole: "observer",
        regoSource: 'package osabio.policy\ndefault allow = false\nallow if { input.action_spec.params.model in {"claude-3-5-haiku-20241022"} }',
      }]);

      const result = await evaluateProxyPolicy(
        { workspaceId: "ws-1", agentType: "observer", model: "claude-opus-4-20250514" },
        createStubDeps(surreal),
      );

      expect(result.decision).toBe("deny_model");
      if (result.decision === "deny_model") {
        expect(result.status).toBe(403);
        expect(result.body.error).toBe("policy_violation");
        expect(result.body.policy_ref).toBe("pol-1");
        expect(result.body.remediation).toContain("observer");
      }
    });

    it("allows request when no policies match agent type", async () => {
      const surreal = createStubSurreal([{
        id: "pol-1",
        title: "Observer Only Policy",
        agentRole: "observer",
        regoSource: 'package osabio.policy\ndefault allow = false\nallow if { input.action_spec.params.model in {"claude-3-5-haiku-20241022"} }',
      }]);

      // coding-agent is not observer, so policy should not apply
      const result = await evaluateProxyPolicy(
        { workspaceId: "ws-1", agentType: "coding-agent", model: "claude-opus-4-20250514" },
        createStubDeps(surreal),
      );

      expect(result.decision).toBe("allow");
    });

    it("allows with no policies and triggers warning", async () => {
      const surreal = createStubSurreal([]);

      const result = await evaluateProxyPolicy(
        { workspaceId: "ws-1", agentType: "coding-agent", model: "claude-sonnet-4-20250514" },
        createStubDeps(surreal),
      );

      expect(result.decision).toBe("allow");
      if (result.decision === "allow") {
        expect(result.policyIds).toEqual([]);
      }
    });
  });

  describe("budget enforcement", () => {
    it("denies when daily spend exceeds budget", async () => {
      const surreal = createStubSurreal([], {
        dailyBudget: 10.0,
        todaySpend: 12.50,
      });

      const result = await evaluateProxyPolicy(
        { workspaceId: "ws-1", agentType: "coding-agent", model: "claude-sonnet-4-20250514" },
        createStubDeps(surreal),
      );

      expect(result.decision).toBe("deny_budget");
      if (result.decision === "deny_budget") {
        expect(result.status).toBe(429);
        expect(result.body.error).toBe("budget_exceeded");
        expect(result.body.current_spend_usd).toBe(12.50);
        expect(result.body.daily_limit_usd).toBe(10.0);
        expect(result.body.time_until_reset_seconds).toBeGreaterThan(0);
      }
    });

    it("allows when spend is under budget", async () => {
      const surreal = createStubSurreal([], {
        dailyBudget: 50.0,
        todaySpend: 10.0,
      });

      const result = await evaluateProxyPolicy(
        { workspaceId: "ws-1", agentType: "coding-agent", model: "claude-sonnet-4-20250514" },
        createStubDeps(surreal),
      );

      // No policies exist, so it will be "allow" (permissive default)
      expect(result.decision).toBe("allow");
    });

    it("allows when no budget configured", async () => {
      const surreal = createStubSurreal([], {
        dailyBudget: undefined,
        todaySpend: 999.0,
      });

      const result = await evaluateProxyPolicy(
        { workspaceId: "ws-1", agentType: "coding-agent", model: "claude-sonnet-4-20250514" },
        createStubDeps(surreal),
      );

      expect(result.decision).toBe("allow");
    });
  });

  describe("rate limiting integration", () => {
    it("denies when rate limit exceeded", async () => {
      const surreal = createStubSurreal([]);
      const deps = createStubDeps(surreal);
      // Override with low rate limit
      deps.rateLimiterState.limitPerMinute = 2;

      const now = Date.now();
      // Fill the rate limit
      await evaluateProxyPolicy(
        { workspaceId: "ws-1", agentType: "coding-agent", model: "claude-sonnet-4-20250514" },
        deps,
      );
      await evaluateProxyPolicy(
        { workspaceId: "ws-1", agentType: "coding-agent", model: "claude-sonnet-4-20250514" },
        deps,
      );

      // 3rd request should be rate limited
      const result = await evaluateProxyPolicy(
        { workspaceId: "ws-1", agentType: "coding-agent", model: "claude-sonnet-4-20250514" },
        deps,
      );

      expect(result.decision).toBe("deny_rate_limit");
      if (result.decision === "deny_rate_limit") {
        expect(result.status).toBe(429);
        expect(result.body.error).toBe("rate_limit_exceeded");
        expect(result.body.rate_limit_per_minute).toBe(2);
        expect(result.retryAfterSeconds).toBeGreaterThan(0);
      }
    });
  });

  describe("evaluation order", () => {
    it("checks rate limit before budget (fast path)", async () => {
      const surreal = createStubSurreal([], {
        dailyBudget: 10.0,
        todaySpend: 50.0, // over budget
      });
      const deps = createStubDeps(surreal);
      deps.rateLimiterState.limitPerMinute = 1;

      // First request passes rate limit
      await evaluateProxyPolicy(
        { workspaceId: "ws-1", agentType: "coding-agent", model: "claude-sonnet-4-20250514" },
        deps,
      );

      // Second request should hit rate limit BEFORE budget check
      const result = await evaluateProxyPolicy(
        { workspaceId: "ws-1", agentType: "coding-agent", model: "claude-sonnet-4-20250514" },
        deps,
      );

      // Rate limit takes priority (faster, in-memory check)
      expect(result.decision).toBe("deny_rate_limit");
    });
  });
});

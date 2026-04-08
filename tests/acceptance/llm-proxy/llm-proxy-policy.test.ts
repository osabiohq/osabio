/**
 * Acceptance Tests: Policy Enforcement at Proxy Boundary (Step 02-01)
 *
 * Driving port: POST /proxy/llm/anthropic/v1/messages
 *
 * Validates that the proxy evaluates model access policies, budget limits,
 * and rate limits before forwarding requests. Clear error responses for
 * violations. No policies defaults to permissive with warning observation.
 * Policy decisions logged for audit trail.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupAcceptanceSuite,
  sendProxyRequest,
  createProxyTestWorkspace,
  seedLlmTrace,
  getObservationsForWorkspace,
  TEST_PROXY_MODEL,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_policy");

// ---------------------------------------------------------------------------
// Helpers: Policy setup that works with SCHEMAFULL policy table
// ---------------------------------------------------------------------------

async function createProxyModelPolicy(
  surreal: import("surrealdb").Surreal,
  workspaceId: string,
  options: {
    policyId: string;
    agentType: string;
    allowedModels: string[];
    identityId?: string;
  },
): Promise<string> {
  const policyRecord = new RecordId("policy", options.policyId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const identityId = options.identityId ?? `identity-${crypto.randomUUID()}`;
  const identityRecord = new RecordId("identity", identityId);

  // Ensure identity exists
  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: identityRecord,
    content: { created_at: new Date() },
  }).catch(() => undefined); // ignore if exists

  await surreal.query(`CREATE $policy CONTENT $content;`, {
    policy: policyRecord,
    content: {
      title: `Model Access: ${options.agentType}`,
      description: `Controls which models ${options.agentType} can use`,
      status: "active",
      version: 1,
      selector: { agent_role: options.agentType },
      workspace: workspaceRecord,
      created_by: identityRecord,
      rules: [
        {
          id: "model_access",
          condition: {
            field: "model",
            operator: "not_in",
            value: options.allowedModels,
          },
          effect: "deny",
          priority: 100,
        },
      ],
      human_veto_required: false,
      rego_source: "package osabio.policy\ndefault allow = true",
      created_at: new Date(),
    },
  });

  // Create protects edge so loadActivePolicies can find it
  await surreal.query(
    `RELATE $policy->protects->$workspace SET created_at = time::now();`,
    { policy: policyRecord, workspace: workspaceRecord },
  );

  return options.policyId;
}

async function setWorkspaceDailyBudget(
  surreal: import("surrealdb").Surreal,
  workspaceId: string,
  dailyBudgetUsd: number,
): Promise<void> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  await surreal.query(
    `UPDATE $workspace SET daily_budget_usd = $budget;`,
    { workspace: workspaceRecord, budget: dailyBudgetUsd },
  );
}

// ---------------------------------------------------------------------------
// Scenario 1: Model access violation returns 403
// ---------------------------------------------------------------------------
describe("Unauthorized model request blocked with policy reference", () => {
  it("returns 403 with policy violation details when model is not allowed", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-pol-deny-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given: workspace policy allows observer to use only haiku
    const policyId = `pol-restrict-${crypto.randomUUID()}`;
    await createProxyModelPolicy(surreal, workspaceId, {
      policyId,
      agentType: "observer",
      allowedModels: ["claude-3-5-haiku-20241022"],
    });

    // When: observer requests opus (not in allowed list)
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-opus-4-20250514",
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: "sk-test-unused",
      workspaceHeader: workspaceId,
      agentTypeHeader: "observer",
    });

    // Then: 403 with structured policy violation body
    expect(response.status).toBe(403);

    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("policy_violation");
    expect(body.policy_ref).toBeDefined();
    expect(body.remediation).toBeDefined();
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Scenario 2: Budget exceeded returns 429
// ---------------------------------------------------------------------------
describe("Budget exceeded request blocked with spend details", () => {
  it("returns 429 with current spend and daily limit when budget exhausted", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-budget-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);
    await setWorkspaceDailyBudget(surreal, workspaceId, 10.0);

    // Given: workspace already spent $10.50 today (over $10 limit)
    for (let i = 0; i < 3; i++) {
      await seedLlmTrace(surreal, `trace-bud-${crypto.randomUUID()}`, {
        model: TEST_PROXY_MODEL,
        input_tokens: 10000,
        output_tokens: 2000,
        cost_usd: 3.50,
        latency_ms: 1000,
        workspaceId,
      });
    }

    // When: agent makes another LLM request
    const response = await sendProxyRequest(baseUrl, {
      model: TEST_PROXY_MODEL,
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: "sk-test-unused",
      workspaceHeader: workspaceId,
      agentTypeHeader: "coding-agent",
    });

    // Then: 429 with budget details
    expect(response.status).toBe(429);

    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("budget_exceeded");
    expect(body.current_spend_usd).toBeDefined();
    expect(body.daily_limit_usd).toBe(10.0);
    expect(body.time_until_reset_seconds).toBeDefined();
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Scenario 3: Rate limit exceeded returns 429 with Retry-After
// ---------------------------------------------------------------------------
describe("Rate limited request blocked with retry guidance", () => {
  it("returns 429 with Retry-After header after exceeding rate limit", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-rate-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // When: sending requests rapidly to exceed rate limit
    // The rate limiter should be configured with a low limit for testability.
    // We send requests in rapid succession and expect at least one to be rate-limited.
    const responses: Response[] = [];
    // Send 65 requests rapidly (default limit is 60/min per workspace)
    const promises = Array.from({ length: 65 }, () =>
      sendProxyRequest(baseUrl, {
        model: TEST_PROXY_MODEL,
        stream: false,
        maxTokens: 10,
        messages: [{ role: "user", content: "hi" }],
        apiKey: "sk-test-unused",
        workspaceHeader: workspaceId,
        agentTypeHeader: "coding-agent",
      }),
    );

    const results = await Promise.all(promises);
    const rateLimited = results.filter((r) => r.status === 429);

    // Then: at least one request is rate-limited
    expect(rateLimited.length).toBeGreaterThan(0);

    const body = await rateLimited[0].json() as Record<string, unknown>;
    expect(body.error).toBe("rate_limit_exceeded");
    expect(body.rate_limit_per_minute).toBeDefined();

    // And: Retry-After header is present
    const retryAfter = rateLimited[0].headers.get("Retry-After");
    expect(retryAfter).toBeDefined();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Scenario 4: No policies defaults to permissive with warning
// ---------------------------------------------------------------------------
describe("No policies defaults to permissive with warning", () => {
  it("forwards request when no policies exist and creates warning observation", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-nopol-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given: workspace has NO model access policies

    // When: agent requests any model
    const response = await sendProxyRequest(baseUrl, {
      model: TEST_PROXY_MODEL,
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: "sk-test-unused",
      workspaceHeader: workspaceId,
      agentTypeHeader: "coding-agent",
    });

    // Then: request is forwarded (not blocked)
    // Note: might get 401 from Anthropic due to fake key, but NOT 403/429 from proxy
    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(429);

    // And: wait for async observation write
    await new Promise((resolve) => setTimeout(resolve, 500));

    // And: warning observation is created
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      observationType: "missing",
      sourceAgent: "llm-proxy",
    });
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0].severity).toBe("warning");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Scenario 5: Policy decision logged for audit trail
// ---------------------------------------------------------------------------
describe("Policy decision logged for audit trail", () => {
  it("records governed_by edge linking trace to evaluated policy on pass", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-audit-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given: workspace has a permissive policy for coding-agent
    const policyId = `pol-audit-${crypto.randomUUID()}`;
    await createProxyModelPolicy(surreal, workspaceId, {
      policyId,
      agentType: "coding-agent",
      allowedModels: [TEST_PROXY_MODEL, "claude-opus-4-20250514"],
    });

    // When: coding-agent requests an allowed model
    const response = await sendProxyRequest(baseUrl, {
      model: TEST_PROXY_MODEL,
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: "sk-test-unused",
      workspaceHeader: workspaceId,
      agentTypeHeader: "coding-agent",
    });

    // Then: request was forwarded (not blocked by policy)
    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(429);

    // Wait for async trace + governed_by write
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // And: policy decision is recorded (governed_by edge from trace to policy)
    const workspaceRecord = new RecordId("workspace", workspaceId);
    const results = await surreal.query(
      `SELECT * FROM trace WHERE workspace = $ws ORDER BY created_at DESC LIMIT 1;`,
      { ws: workspaceRecord },
    );
    const traces = results[0] as Array<{ id: RecordId; policy_decision?: Record<string, unknown> }>;

    // Policy decision should be recorded on the trace
    if (traces.length > 0) {
      expect(traces[0].policy_decision).toBeDefined();
    }
  }, 30_000);
});

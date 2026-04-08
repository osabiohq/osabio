/**
 * Acceptance Tests: Audit Provenance Chain (US-LP-007)
 *
 * Traces: US-LP-007 — Audit Provenance Chain
 * Driving ports: GET /api/workspaces/:id/proxy/traces/:traceId,
 *                GET /api/workspaces/:id/proxy/traces?project=...&start=...&end=...,
 *                GET /api/workspaces/:id/proxy/compliance?start=...&end=...
 *
 * Validates that auditors can view full provenance chains for traces,
 * query by project/date range, run compliance checks, and export data.
 */
import { describe, expect, it } from "bun:test";
import { RecordId, type Surreal } from "surrealdb";
import {
  setupAcceptanceSuite,
  createProxyTestWorkspace,
  createProxyTestProject,
  createProxyTestTask,
  seedLlmTrace,
  queryTraceDetail,
  queryTracesByProject,
  runComplianceCheck,
  seedAgentSession,
  TEST_PROXY_MODEL,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_audit");

// ---------------------------------------------------------------------------
// Helper: seed a governed_by edge (trace -> policy)
// ---------------------------------------------------------------------------
async function seedGovernedByEdge(
  surreal: Surreal,
  traceId: string,
  policyId: string,
  decision: "pass" | "deny" = "pass",
): Promise<void> {
  const traceRecord = new RecordId("trace", traceId);
  const policyRecord = new RecordId("policy", policyId);

  await surreal.query(
    `RELATE $trace->governed_by->$policy SET created_at = time::now(), decision = $decision;`,
    { trace: traceRecord, policy: policyRecord, decision },
  );
}

// ---------------------------------------------------------------------------
// Helper: seed a policy with all required schema fields
// ---------------------------------------------------------------------------
async function seedAuditPolicy(
  surreal: Surreal,
  policyId: string,
  workspaceId: string,
): Promise<string> {
  const policyRecord = new RecordId("policy", policyId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  // Ensure a test identity exists for created_by
  const identityId = `audit-identity-${workspaceId}`;
  const identityRecord = new RecordId("identity", identityId);
  await surreal.query(
    `CREATE $identity CONTENT { name: "audit-test-user", type: "user", workspace: $ws, created_at: time::now() };`,
    { identity: identityRecord, ws: workspaceRecord },
  ).catch(() => undefined);

  await surreal.query(`CREATE $policy CONTENT $content;`, {
    policy: policyRecord,
    content: {
      title: `Audit Test Policy ${policyId}`,
      description: "Test policy for audit compliance",
      status: "active",
      version: 1,
      workspace: workspaceRecord,
      created_by: identityRecord,
      selector: { workspace: workspaceId },
      rules: [{
        id: "model_access",
        condition: { field: "agent_type", operator: "eq", value: "coding-agent" },
        effect: "allow",
        priority: 50,
      }],
      rego_source: "package osabio.policy\ndefault allow = true",
      created_at: new Date(),
    },
  });

  return policyId;
}

// ---------------------------------------------------------------------------
// Scenario 1: Auditor views full provenance chain for a trace
// ---------------------------------------------------------------------------
describe("Auditor views full provenance chain for a trace", () => {
  it("returns trace detail with usage data and linked provenance entities", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-audit-${crypto.randomUUID()}`;
    const projectId = `proj-audit-${crypto.randomUUID()}`;
    const taskId = `task-audit-${crypto.randomUUID()}`;
    const traceId = `tr-audit-${crypto.randomUUID()}`;
    const sessionId = `session-audit-${crypto.randomUUID()}`;
    const policyId = `pol-audit-${crypto.randomUUID()}`;

    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyTestProject(surreal, projectId, workspaceId);
    await createProxyTestTask(surreal, taskId, projectId, workspaceId);
    await seedAgentSession(surreal, sessionId, { workspaceId });
    await seedAuditPolicy(surreal, policyId, workspaceId);

    // Given a trace exists with full provenance edges
    await seedLlmTrace(surreal, traceId, {
      model: TEST_PROXY_MODEL,
      input_tokens: 12340,
      output_tokens: 2100,
      cost_usd: 0.068,
      latency_ms: 4200,
      stop_reason: "end_turn",
      cache_read_tokens: 8200,
      workspaceId,
      taskId,
      sessionId,
    });
    await seedGovernedByEdge(surreal, traceId, policyId);

    // When Elena queries the trace detail
    const response = await queryTraceDetail(baseUrl, workspaceId, traceId);

    // Then the API responds with 200 and full provenance chain
    expect(response.status).toBe(200);
    const body = await response.json();

    // Usage data
    expect(body.model).toBe(TEST_PROXY_MODEL);
    expect(body.input_tokens).toBe(12340);
    expect(body.output_tokens).toBe(2100);
    expect(body.cost_usd).toBe(0.068);
    expect(body.latency_ms).toBe(4200);
    expect(body.stop_reason).toBe("end_turn");

    // Provenance chain: linked entities
    expect(body.provenance).toBeDefined();
    expect(body.provenance.workspace).toBeDefined();
    expect(body.provenance.task).toBeDefined();
    expect(body.provenance.session).toBeDefined();
    expect(body.provenance.policy).toBeDefined();

    // JSON export shape
    expect(typeof body.provenance.workspace.id).toBe("string");
    expect(typeof body.provenance.task.id).toBe("string");
    expect(typeof body.provenance.session.id).toBe("string");
    expect(typeof body.provenance.policy.id).toBe("string");
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Scenario 2: Auditor queries traces by project and date range
// ---------------------------------------------------------------------------
describe("Auditor queries traces by project and date range", () => {
  it("returns traces within date range for specified project", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-query-${crypto.randomUUID()}`;
    const projectId = `proj-query-${crypto.randomUUID()}`;
    const taskId = `task-query-${crypto.randomUUID()}`;

    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyTestProject(surreal, projectId, workspaceId);
    await createProxyTestTask(surreal, taskId, projectId, workspaceId);

    // Given traces exist across different dates
    const march5 = new Date("2026-03-05T12:00:00Z");
    const march10 = new Date("2026-03-10T12:00:00Z");
    const march20 = new Date("2026-03-20T12:00:00Z");

    await seedLlmTrace(surreal, `trace-m5-${crypto.randomUUID()}`, {
      model: TEST_PROXY_MODEL,
      input_tokens: 1000,
      output_tokens: 200,
      cost_usd: 0.006,
      latency_ms: 1500,
      workspaceId,
      taskId,
      created_at: march5,
    });

    await seedLlmTrace(surreal, `trace-m10-${crypto.randomUUID()}`, {
      model: TEST_PROXY_MODEL,
      input_tokens: 2000,
      output_tokens: 400,
      cost_usd: 0.012,
      latency_ms: 2500,
      workspaceId,
      taskId,
      created_at: march10,
    });

    await seedLlmTrace(surreal, `trace-m20-${crypto.randomUUID()}`, {
      model: TEST_PROXY_MODEL,
      input_tokens: 3000,
      output_tokens: 600,
      cost_usd: 0.018,
      latency_ms: 3500,
      workspaceId,
      taskId,
      created_at: march20,
    });

    // When Elena queries traces between March 1 and March 15
    const response = await queryTracesByProject(
      baseUrl,
      workspaceId,
      projectId,
      "2026-03-01",
      "2026-03-15",
    );

    // Then results include march5 and march10 traces but not march20
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.traces).toBeArray();
    expect(body.traces.length).toBe(2);

    // Verify ordering by created_at DESC (march10 first)
    expect(body.traces[0].cost_usd).toBe(0.012);
    expect(body.traces[1].cost_usd).toBe(0.006);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Scenario 3: Authorization compliance check — all authorized
// ---------------------------------------------------------------------------
describe("Authorization compliance check passes", () => {
  it("reports all traces as authorized when governed_by edges exist", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-comply-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    const policyId = `pol-comply-${crypto.randomUUID()}`;
    await seedAuditPolicy(surreal, policyId, workspaceId);

    // Given two traces both have governed_by policy edges
    const traceId1 = `trace-comply1-${crypto.randomUUID()}`;
    const traceId2 = `trace-comply2-${crypto.randomUUID()}`;

    await seedLlmTrace(surreal, traceId1, {
      model: TEST_PROXY_MODEL,
      input_tokens: 1000,
      output_tokens: 200,
      cost_usd: 0.006,
      latency_ms: 1500,
      workspaceId,
      created_at: new Date("2026-03-10T10:00:00Z"),
    });
    await seedGovernedByEdge(surreal, traceId1, policyId);

    await seedLlmTrace(surreal, traceId2, {
      model: TEST_PROXY_MODEL,
      input_tokens: 500,
      output_tokens: 100,
      cost_usd: 0.003,
      latency_ms: 800,
      workspaceId,
      created_at: new Date("2026-03-12T14:00:00Z"),
    });
    await seedGovernedByEdge(surreal, traceId2, policyId);

    // When Elena runs the compliance check
    const response = await runComplianceCheck(
      baseUrl,
      workspaceId,
      "2026-03-01",
      "2026-03-31",
    );

    // Then the compliance summary shows all authorized
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.period.start).toBe("2026-03-01");
    expect(body.period.end).toBe("2026-03-31");
    expect(body.authorized_count).toBe(2);
    expect(body.unverified_count).toBe(0);
    expect(body.unverified_traces).toBeArray();
    expect(body.unverified_traces.length).toBe(0);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Scenario 4: Traces without authorization flagged as unverified
// ---------------------------------------------------------------------------
describe("Traces without authorization flagged as unverified", () => {
  it("flags traces missing governed_by policy edge as unverified", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-unverified-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    const policyId = `pol-mix-${crypto.randomUUID()}`;
    await seedAuditPolicy(surreal, policyId, workspaceId);

    // Given: one authorized trace and three unverified traces
    const authorizedTraceId = `trace-auth-${crypto.randomUUID()}`;
    await seedLlmTrace(surreal, authorizedTraceId, {
      model: TEST_PROXY_MODEL,
      input_tokens: 1000,
      output_tokens: 200,
      cost_usd: 0.006,
      latency_ms: 1500,
      workspaceId,
      created_at: new Date("2026-03-10T10:00:00Z"),
    });
    await seedGovernedByEdge(surreal, authorizedTraceId, policyId);

    const unverifiedIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = `trace-gap-${crypto.randomUUID()}`;
      unverifiedIds.push(id);
      await seedLlmTrace(surreal, id, {
        model: TEST_PROXY_MODEL,
        input_tokens: 1000,
        output_tokens: 200,
        cost_usd: 0.006,
        latency_ms: 1500,
        workspaceId,
        created_at: new Date("2026-03-03T14:00:00Z"),
      });
      // No governed_by edge -- these are unverified
    }

    // When Elena runs the compliance check
    const response = await runComplianceCheck(
      baseUrl,
      workspaceId,
      "2026-03-01",
      "2026-03-31",
    );

    // Then the compliance report flags 3 unverified traces
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.period.start).toBe("2026-03-01");
    expect(body.period.end).toBe("2026-03-31");
    expect(body.authorized_count).toBe(1);
    expect(body.unverified_count).toBe(3);
    expect(body.unverified_traces).toBeArray();
    expect(body.unverified_traces.length).toBe(3);

    // Each unverified trace includes id, model, and created_at
    for (const trace of body.unverified_traces) {
      expect(trace.id).toBeDefined();
      expect(trace.model).toBe(TEST_PROXY_MODEL);
      expect(trace.created_at).toBeDefined();
    }
  }, 15_000);
});

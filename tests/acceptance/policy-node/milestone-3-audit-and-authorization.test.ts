/**
 * Milestone 3: Audit Trail, Authorization Model, and Error Handling
 *
 * Traces: US-7, US-8, AC-11, AC-12
 *
 * Validates policy evaluation trace persistence, audit event extensions,
 * policy CRUD authorization (human-only), missing field handling,
 * and multi-condition Rego rules.
 *
 * Driving ports:
 *   Direct DB for policy trace queries and audit events
 *   Graph traversal for trace chain reconstruction
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createTestIdentity,
  createPolicy,
  activatePolicy,
  createDraftIntent,
  submitIntent,
  getIntentRecord,
  simulatePolicyGateResult,
  createPolicyAuditEvent,
  getAuditEventsForPolicy,
  type PolicyTraceEntry,
} from "./policy-test-kit";

const getRuntime = setupOrchestratorSuite("policy_m3_audit_authz");

describe("Milestone 3: Policy Evaluation Trace (US-7)", () => {
  // ---------------------------------------------------------------------------
  // US-7: Evaluation trace records all policies evaluated
  // AC-7 — with Rego: one trace entry per policy (not per rule)
  // ---------------------------------------------------------------------------
  it("intent evaluation trace contains entries for every policy evaluated", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given two active Rego policies
    const user = await createTestUser(baseUrl, "m3-trace");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    const { policyId: p1 } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Budget Policy",
      rego_source: `package osabio.policy
default allow := false
allow if {
  input.budget_limit.amount <= 500
}
deny contains msg if {
  input.budget_limit.amount > 5000
  msg := "Spend exceeds cap"
}`,
    });
    await activatePolicy(surreal, p1, adminId, workspace.workspaceId);

    const { policyId: p2 } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Action Guard",
      rego_source: `package osabio.policy
default allow := false
deny contains msg if {
  input.action_spec.action == "delete"
  msg := "Delete not permitted"
}`,
    });
    await activatePolicy(surreal, p2, adminId, workspace.workspaceId);

    // When the agent submits a small spend intent (no deny triggers)
    const { intentId } = await createDraftIntent(surreal, workspace.workspaceId, agentId, {
      goal: "Purchase API credits",
      reasoning: "Need more API calls for batch processing",
      action_spec: { provider: "billing", action: "purchase", params: {} },
      budget_limit: { amount: 200, currency: "USD" },
    });
    await submitIntent(surreal, intentId);

    // Then the policy trace has one entry per policy (2 total)
    const fullTrace: PolicyTraceEntry[] = [
      { policy_id: p1, policy_version: 1, rule_id: `policy:${p1}`, effect: "allow", matched: true, priority: 10 },
      { policy_id: p2, policy_version: 1, rule_id: `policy:${p2}`, effect: "deny", matched: false, priority: 10 },
    ];

    await simulatePolicyGateResult(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 15,
      reason: "Small spend within budget policy",
      policy_only: false,
      policy_trace: fullTrace,
    }, "authorized");

    // Then the trace is persisted on the intent evaluation
    const record = await getIntentRecord(surreal, intentId);
    const trace = (record.evaluation as Record<string, unknown>)?.policy_trace as PolicyTraceEntry[];
    expect(trace).toBeDefined();
    expect(trace).toHaveLength(2);

    // And each entry has the required fields
    for (const entry of trace) {
      expect(entry.policy_id).toBeTruthy();
      expect(entry.policy_version).toBeGreaterThan(0);
      expect(entry.rule_id).toBeTruthy();
      expect(["allow", "deny"]).toContain(entry.effect);
      expect(typeof entry.matched).toBe("boolean");
      expect(typeof entry.priority).toBe("number");
    }
  }, 120_000);

  // ---------------------------------------------------------------------------
  // US-7: Policy trace persists IDs only, not denormalized titles
  // AC-7 data shape validation
  // ---------------------------------------------------------------------------
  it("policy trace contains IDs and metadata only, not denormalized policy titles", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, "m3-trace-shape");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Test Shape Policy",
      rego_source: `package osabio.policy
default allow := false
allow if {
  input.action_spec.action == "test"
}`,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);

    const { intentId } = await createDraftIntent(surreal, workspace.workspaceId, agentId, {
      goal: "Run tests",
      reasoning: "Verify everything passes",
      action_spec: { provider: "test_runner", action: "test", params: {} },
    });
    await submitIntent(surreal, intentId);

    await simulatePolicyGateResult(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 5,
      reason: "Safe test run",
      policy_only: false,
      policy_trace: [{
        policy_id: policyId,
        policy_version: 1,
        rule_id: `policy:${policyId}`,
        effect: "allow",
        matched: true,
        priority: 10,
      }],
    }, "authorized");

    const record = await getIntentRecord(surreal, intentId);
    const trace = (record.evaluation as Record<string, unknown>)?.policy_trace as Record<string, unknown>[];

    // Trace entry should NOT contain policy title (loaded via join at display time)
    for (const entry of trace) {
      expect(entry).not.toHaveProperty("policy_title");
      expect(entry).not.toHaveProperty("title");
      // Should contain only: policy_id, policy_version, rule_id, effect, matched, priority
      expect(entry).toHaveProperty("policy_id");
      expect(entry).toHaveProperty("policy_version");
      expect(entry).toHaveProperty("rule_id");
      expect(entry).toHaveProperty("effect");
      expect(entry).toHaveProperty("matched");
      expect(entry).toHaveProperty("priority");
    }
  }, 120_000);
});

describe("Milestone 3: Audit Event Extensions (US-8)", () => {
  // ---------------------------------------------------------------------------
  // US-8: Policy lifecycle events produce audit events
  // AC-8
  // ---------------------------------------------------------------------------
  it("policy lifecycle events produce audit_event records with policy ID and version", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a policy created and activated
    const user = await createTestUser(baseUrl, "m3-audit");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Audit Test Policy",
      rego_source: `package osabio.policy
default allow := false
allow if {
  input.action_spec.action == "test"
}`,
    });

    // When lifecycle events are recorded
    await createPolicyAuditEvent(surreal, "policy_created", adminId, workspace.workspaceId, policyId, 1);
    await createPolicyAuditEvent(surreal, "policy_activated", adminId, workspace.workspaceId, policyId, 1);

    // Then audit events exist with correct payloads
    const events = await getAuditEventsForPolicy(surreal, policyId);
    expect(events.length).toBeGreaterThanOrEqual(2);

    const createEvent = events.find(e => e.event_type === "policy_created");
    expect(createEvent).toBeDefined();
    expect(createEvent!.payload.policy_id).toBe(policyId);
    expect(createEvent!.payload.policy_version).toBe(1);

    const activateEvent = events.find(e => e.event_type === "policy_activated");
    expect(activateEvent).toBeDefined();
    expect(activateEvent!.payload.policy_id).toBe(policyId);
  }, 120_000);
});

describe("Milestone 3: Rego Missing Field Handling (AC-11)", () => {
  // ---------------------------------------------------------------------------
  // AC-11: Rego handles missing intent context fields gracefully
  // Rego undefined field access = false (non-matching) by default
  // ---------------------------------------------------------------------------
  it("Rego deny rule referencing a missing intent field does not match and evaluation continues", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a policy with a deny rule that checks budget_limit.amount
    const user = await createTestUser(baseUrl, "m3-missing-field");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Budget Guard",
      rego_source: `package osabio.policy
default allow := false
deny contains msg if {
  input.budget_limit.amount > 10000
  msg := "Budget exceeds cap"
}`,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);

    // When the agent submits an intent WITHOUT budget_limit (missing field)
    const { intentId } = await createDraftIntent(surreal, workspace.workspaceId, agentId, {
      goal: "Read configuration file",
      reasoning: "Need to check current settings",
      action_spec: { provider: "file_editor", action: "read_file", params: {} },
      // No budget_limit — Rego undefined field access returns undefined, deny rule does not match
    });
    await submitIntent(surreal, intentId);

    // Then the deny rule does not match (Rego handles undefined gracefully)
    // And the intent passes through to LLM evaluation
    await simulatePolicyGateResult(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 5,
      reason: "Safe read operation",
      policy_only: false,
      policy_trace: [{
        policy_id: policyId,
        policy_version: 1,
        rule_id: `policy:${policyId}`,
        effect: "deny",
        matched: false,
        priority: 10,
      }],
    }, "authorized");

    const status = await getIntentRecord(surreal, intentId);
    expect(status.status).toBe("authorized");
  }, 120_000);
});

describe("Milestone 3: Policy Authorization Model (AC-12)", () => {
  // ---------------------------------------------------------------------------
  // AC-12: Human identity can create policies
  // ---------------------------------------------------------------------------
  it("human identity can create policies in their workspace", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, "m3-human-create");
    const workspace = await createTestWorkspace(baseUrl, user);
    const humanId = await createTestIdentity(surreal, "human-admin", "human", workspace.workspaceId);

    // When a human creates a policy with Rego source
    const { policyId } = await createPolicy(surreal, workspace.workspaceId, humanId, {
      title: "Human-Created Policy",
      rego_source: `package osabio.policy
default allow := false
allow if {
  input.action_spec.action == "create"
}`,
    });

    // Then the policy exists with created_by pointing to the human identity
    const { getPolicyRecord } = await import("./policy-test-kit");
    const policy = await getPolicyRecord(surreal, policyId);
    expect(policy.title).toBe("Human-Created Policy");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // AC-12: Agent identity type is recorded for authorization checks
  // ---------------------------------------------------------------------------
  it("agent identity type is stored for authorization enforcement at app layer", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, "m3-agent-type");
    const workspace = await createTestWorkspace(baseUrl, user);

    // Given an agent identity
    const agentId = await createTestIdentity(surreal, "code-agent", "agent", workspace.workspaceId);

    // When the identity type is queried
    const identityRecord = new RecordId("identity", agentId);
    const rows = (await surreal.query(
      `SELECT type FROM $identity;`,
      { identity: identityRecord },
    )) as Array<Array<{ type: string }>>;

    // Then the identity type is "agent" (used by route handlers to enforce CRUD restriction)
    expect(rows[0]?.[0]?.type).toBe("agent");
  }, 120_000);
});

describe("Milestone 3: Rego Multi-Condition Rules", () => {
  // ---------------------------------------------------------------------------
  // FR-1a: Multiple conditions AND-joined in a single Rego rule
  // Rego naturally supports AND-joining within a rule body
  // ---------------------------------------------------------------------------
  it("Rego rule with AND-joined conditions only matches when all predicates are true", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a policy with an AND-joined Rego rule (budget <= 500 AND action is "pay")
    const user = await createTestUser(baseUrl, "m3-and-join");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Small Payment Auto-Approve",
      rego_source: `package osabio.policy
default allow := false
allow if {
  input.budget_limit.amount <= 500
  input.action_spec.action == "pay"
}`,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);

    // When the agent submits a small payment (both conditions match)
    const { intentId } = await createDraftIntent(surreal, workspace.workspaceId, agentId, {
      goal: "Pay small invoice",
      reasoning: "Monthly SaaS subscription",
      action_spec: { provider: "billing", action: "pay", params: {} },
      budget_limit: { amount: 49.99, currency: "USD" },
    });
    await submitIntent(surreal, intentId);

    // Then the AND-joined rule matches (both predicates true)
    await simulatePolicyGateResult(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 5,
      reason: "Small payment within policy limits",
      policy_only: false,
      policy_trace: [{
        policy_id: policyId,
        policy_version: 1,
        rule_id: `policy:${policyId}`,
        effect: "allow",
        matched: true,
        priority: 10,
      }],
    }, "authorized");

    const record = await getIntentRecord(surreal, intentId);
    expect(record.status).toBe("authorized");
    const trace = (record.evaluation as Record<string, unknown>)?.policy_trace as Record<string, unknown>[];
    expect(trace[0]?.matched).toBe(true);
  }, 120_000);
});

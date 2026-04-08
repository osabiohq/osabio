/**
 * Milestone 6: Policy Trace Integration
 *
 * Traces: US-PCUI-06 (Policy Trace in Review)
 *
 * Validates that when an intent is evaluated against active policies,
 * the policy_trace on the intent record captures which policies and
 * rules matched, enabling reviewers to see the governance reasoning.
 *
 * Driving ports:
 *   POST  /api/workspaces/:wsId/policies (create)
 *   PATCH /api/workspaces/:wsId/policies/:id/activate
 *   GET   /api/workspaces/:wsId/policies/:id (policy detail for trace links)
 *   Direct DB for intent creation + policy gate simulation
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createTestUser,
  createTestWorkspace,
  createTestIdentity,
  createPolicy,
  activatePolicy,
  createDraftIntent,
  submitIntent,
  simulatePolicyGateResult,
  getIntentRecord,
  getPolicyDetail,
  DEFAULT_REGO_SOURCE,
  type PolicyTraceEntry,
  type PolicyDetailResponse,
} from "./policy-crud-test-kit";

const getRuntime = setupAcceptanceSuite("policy_crud_m6_trace");

// =============================================================================
// US-PCUI-06: Policy Trace in Review
// =============================================================================

describe("Milestone 6: Policy Trace on Intent Evaluation (US-PCUI-06)", () => {

  // ---------------------------------------------------------------------------
  // Walking Skeleton: Intent evaluation persists policy trace
  // AC: Reviewer can see which rules matched and why on the intent record
  // ---------------------------------------------------------------------------
  it("intent evaluation includes policy trace with matching rules", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active policy with a deny rule
    const user = await createTestUser(baseUrl, "m6-trace-happy");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Deploy Blocker",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);

    // And an intent that triggers the deny rule
    const { intentId } = await createDraftIntent(surreal, workspace.workspaceId, agentId, {
      goal: "Deploy feature branch to production",
      reasoning: "Feature is complete and tested",
      action_spec: { provider: "infra", action: "deploy", params: {} },
    });
    await submitIntent(surreal, intentId);

    // When the policy gate evaluates the intent
    const trace: PolicyTraceEntry[] = [{
      policy_id: policyId,
      policy_version: 1,
      rule_id: "block_prod_deploy",
      effect: "deny",
      matched: true,
      priority: 100,
    }];

    await simulatePolicyGateResult(surreal, intentId, {
      decision: "REJECT",
      risk_score: 0,
      reason: "Policy deny rule 'block_prod_deploy' matched",
      policy_only: true,
      policy_trace: trace,
    }, "vetoed");

    // Then the intent record contains the policy trace
    const record = await getIntentRecord(surreal, intentId);
    const evaluation = record.evaluation as Record<string, unknown>;
    const persistedTrace = evaluation.policy_trace as PolicyTraceEntry[];

    expect(persistedTrace).toHaveLength(1);
    expect(persistedTrace[0].policy_id).toBe(policyId);
    expect(persistedTrace[0].policy_version).toBe(1);
    expect(persistedTrace[0].rule_id).toBe("block_prod_deploy");
    expect(persistedTrace[0].effect).toBe("deny");
    expect(persistedTrace[0].matched).toBe(true);
    expect(persistedTrace[0].priority).toBe(100);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Policy trace captures both matched and unmatched rules
  // AC: Trace shows full picture of rule evaluation
  // ---------------------------------------------------------------------------
  it("policy trace captures both matched and unmatched rules", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given two active policies with rules that partially match
    const user = await createTestUser(baseUrl, "m6-trace-mixed");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    const { policyId: p1 } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Deploy Guard",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, p1, adminId, workspace.workspaceId);

    const { policyId: p2 } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Read Allowance",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, p2, adminId, workspace.workspaceId);

    // And a read intent (matches allow_read, not block_deploy)
    const { intentId } = await createDraftIntent(surreal, workspace.workspaceId, agentId, {
      goal: "Read project configuration",
      reasoning: "Need config for implementation",
      action_spec: { provider: "file_reader", action: "read", params: {} },
    });
    await submitIntent(surreal, intentId);

    // When the policy gate evaluates the intent
    const trace: PolicyTraceEntry[] = [
      { policy_id: p1, policy_version: 1, rule_id: "block_deploy", effect: "deny", matched: false, priority: 100 },
      { policy_id: p2, policy_version: 1, rule_id: "allow_read", effect: "allow", matched: true, priority: 10 },
    ];

    await simulatePolicyGateResult(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 5,
      reason: "No deny rules matched, allow rule matched",
      policy_only: false,
      policy_trace: trace,
    }, "authorized");

    // Then both rule evaluations are captured in the trace
    const record = await getIntentRecord(surreal, intentId);
    const evaluation = record.evaluation as Record<string, unknown>;
    const persistedTrace = evaluation.policy_trace as PolicyTraceEntry[];

    expect(persistedTrace).toHaveLength(2);

    // And the deny rule is marked as not matched
    const denyEntry = persistedTrace.find(t => t.rule_id === "block_deploy");
    expect(denyEntry?.matched).toBe(false);
    expect(denyEntry?.effect).toBe("deny");

    // And the allow rule is marked as matched
    const allowEntry = persistedTrace.find(t => t.rule_id === "allow_read");
    expect(allowEntry?.matched).toBe(true);
    expect(allowEntry?.effect).toBe("allow");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Policy trace links back to policy detail
  // AC: Each trace entry's policy_id resolves to a valid policy detail
  // ---------------------------------------------------------------------------
  it("policy trace entries link to retrievable policy details", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an evaluated intent with a policy trace
    const user = await createTestUser(baseUrl, "m6-trace-link");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Linkable Policy",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);

    const { intentId } = await createDraftIntent(surreal, workspace.workspaceId, agentId, {
      goal: "Purchase expensive tool license",
      reasoning: "Team needs new tooling",
      action_spec: { provider: "billing", action: "purchase", params: {} },
      budget_limit: { amount: 999, currency: "USD" },
    });
    await submitIntent(surreal, intentId);

    await simulatePolicyGateResult(surreal, intentId, {
      decision: "REJECT",
      risk_score: 0,
      reason: "Budget exceeds policy limit",
      policy_only: true,
      policy_trace: [{
        policy_id: policyId,
        policy_version: 1,
        rule_id: "check_budget",
        effect: "deny",
        matched: true,
        priority: 50,
      }],
    }, "vetoed");

    // When a reviewer follows the policy_id from the trace to the policy detail
    const record = await getIntentRecord(surreal, intentId);
    const evaluation = record.evaluation as Record<string, unknown>;
    const persistedTrace = evaluation.policy_trace as PolicyTraceEntry[];
    const tracePolicyId = persistedTrace[0].policy_id;

    const detailResponse = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, tracePolicyId,
    );

    // Then the policy detail is retrievable
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json() as PolicyDetailResponse;
    expect(detail.policy.title).toBe("Linkable Policy");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Empty policy trace when no policies are active
  // AC: Intent evaluated with no active policies has empty trace
  // ---------------------------------------------------------------------------
  it("intent evaluated with no active policies has empty policy trace", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with no active policies
    const user = await createTestUser(baseUrl, "m6-trace-empty");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    // And an intent submitted in this workspace
    const { intentId } = await createDraftIntent(surreal, workspace.workspaceId, agentId, {
      goal: "Refactor utils module",
      reasoning: "Code cleanup",
      action_spec: { provider: "file_editor", action: "edit_file", params: {} },
    });
    await submitIntent(surreal, intentId);

    // When the policy gate evaluates with no policies
    await simulatePolicyGateResult(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 10,
      reason: "No policies configured",
      policy_only: false,
      policy_trace: [],
    }, "authorized");

    // Then the policy trace is empty
    const record = await getIntentRecord(surreal, intentId);
    const evaluation = record.evaluation as Record<string, unknown>;
    const persistedTrace = evaluation.policy_trace as PolicyTraceEntry[];
    expect(persistedTrace).toHaveLength(0);
  }, 120_000);
});

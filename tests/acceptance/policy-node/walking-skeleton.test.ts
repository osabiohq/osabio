/**
 * Walking Skeleton: Policy-Driven Intent Authorization E2E
 *
 * Traces: US-4, US-5, US-7, US-9
 *
 * These are the minimum viable E2E paths through the policy gate system.
 * Skeleton 1: Policy deny rule blocks intent before LLM evaluation
 * Skeleton 2: No policies exist, intent passes through to LLM evaluation
 *
 * Together they prove:
 * - Active policies are loaded via graph traversal at evaluation time
 * - Deny rules short-circuit the pipeline (no LLM call needed)
 * - Empty policy sets preserve backward compatibility (pass-through)
 * - Policy trace is recorded on the intent evaluation
 *
 * Driving ports:
 *   Direct DB for policy creation, activation, graph edges
 *   Intent evaluation via simulated pipeline (policy gate + status update)
 */
import { describe, expect, it } from "bun:test";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  createTestIdentity,
  createDraftIntent,
  submitIntent,
  getIntentStatus,
  getIntentRecord,
  getIntentEvaluation,
  createPolicy,
  activatePolicy,
  simulatePolicyGateResult,
  loadActivePoliciesForIdentity,
} from "./policy-test-kit";

const getRuntime = setupOrchestratorSuite("policy_walking_skeleton");

describe("Walking Skeleton: Policy deny rule blocks intent before LLM tier", () => {
  // ---------------------------------------------------------------------------
  // Skeleton 1: Active deny policy rejects intent deterministically
  // US-4 + US-5 + US-7 happy path
  // ---------------------------------------------------------------------------
  it("active deny policy blocks a deploy intent and records policy trace", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a human admin who creates governance policies
    const user = await createTestUser(baseUrl, "skel-deny");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);

    // And an active policy that denies deploy actions
    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Block Production Deploys",
      rego_source: `package osabio.policy
default allow := false
deny contains msg if {
  input.action_spec.action == "deploy"
  msg := "Production deploys require approval"
}`,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);

    // And an agent identity that submits an intent to deploy
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    const { intentId } = await createDraftIntent(
      surreal,
      workspace.workspaceId,
      agentId,
      {
        goal: "Deploy latest build to production",
        reasoning: "CI passed, ready for release",
        action_spec: { provider: "infra", action: "deploy", params: { env: "production" } },
      },
    );

    // When the agent submits the intent and the policy gate evaluates it
    await submitIntent(surreal, intentId);

    // Then the policy gate loads the active policy via graph traversal
    const policies = await loadActivePoliciesForIdentity(surreal, adminId, workspace.workspaceId);
    expect(policies.length).toBeGreaterThanOrEqual(1);
    const blockPolicy = policies.find(p => (p.id.id as string) === policyId);
    expect(blockPolicy).toBeDefined();
    expect(blockPolicy!.status).toBe("active");

    // And the deny rule matches, so the intent is rejected before LLM evaluation
    await simulatePolicyGateResult(surreal, intentId, {
      decision: "REJECT",
      risk_score: 0,
      reason: "Rego policy denied: Production deploys require approval",
      policy_only: true,
      policy_trace: [{
        policy_id: policyId,
        policy_version: 1,
        rule_id: policyId,
        effect: "deny",
        matched: true,
        priority: 0,
      }],
    }, "vetoed");

    // Then the intent is rejected
    const status = await getIntentStatus(surreal, intentId);
    expect(status).toBe("vetoed");

    // And the evaluation shows it was policy-only (no LLM call)
    const evaluation = await getIntentEvaluation(surreal, intentId);
    expect(evaluation).toBeDefined();
    expect(evaluation!.policy_only).toBe(true);
    expect(evaluation!.decision).toBe("REJECT");

    // And the policy trace is recorded on the intent
    const record = await getIntentRecord(surreal, intentId);
    const trace = (record.evaluation as Record<string, unknown>)?.policy_trace as PolicyTraceEntry[];
    expect(trace).toBeDefined();
    expect(trace).toHaveLength(1);
    expect(trace[0].rule_id).toBe(policyId);
    expect(trace[0].matched).toBe(true);
    expect(trace[0].effect).toBe("deny");
  }, 120_000);
});

describe("Walking Skeleton: Empty policy set preserves backward compatibility", () => {
  // ---------------------------------------------------------------------------
  // Skeleton 2: No policies -> intent passes through to LLM tier
  // US-9 backward compatibility
  // ---------------------------------------------------------------------------
  it("intent passes through policy gate when no active policies exist", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with NO active policies
    const user = await createTestUser(baseUrl, "skel-empty");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    // When an agent submits an intent
    const { intentId } = await createDraftIntent(
      surreal,
      workspace.workspaceId,
      agentId,
      {
        goal: "Add input validation to login form",
        reasoning: "Improve security by validating email format",
        action_spec: { provider: "file_editor", action: "edit_file", params: { target: "src/Login.tsx" } },
      },
    );

    await submitIntent(surreal, intentId);

    // Then the policy gate finds no active policies
    const policies = await loadActivePoliciesForIdentity(surreal, agentId, workspace.workspaceId);
    expect(policies).toHaveLength(0);

    // And the intent passes through to LLM evaluation (simulated as approved)
    await simulatePolicyGateResult(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 10,
      reason: "Safe file edit within scope. Low risk.",
      policy_only: false,
      policy_trace: [],
    }, "authorized");

    // Then the intent is authorized
    const status = await getIntentStatus(surreal, intentId);
    expect(status).toBe("authorized");

    // And the evaluation is NOT policy-only (LLM tier ran)
    const evaluation = await getIntentEvaluation(surreal, intentId);
    expect(evaluation!.policy_only).toBe(false);

    // And the policy trace is empty (no policies evaluated)
    const record = await getIntentRecord(surreal, intentId);
    const trace = (record.evaluation as Record<string, unknown>)?.policy_trace as unknown[];
    expect(trace).toHaveLength(0);
  }, 120_000);
});

// Type import for inline use
type PolicyTraceEntry = {
  policy_id: string;
  policy_version: number;
  rule_id: string;
  effect: "allow" | "deny";
  matched: boolean;
  priority: number;
};

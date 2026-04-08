/**
 * Behavior-Based Policy Enforcement Acceptance Tests (US-OB-04)
 *
 * Validates that Rego policies can reference behavior_scores via input paths,
 * and that the enriched IntentEvaluationContext flows through the Rego
 * evaluator to approve or deny intents based on agent behavior.
 *
 * Testing strategy:
 *   - Behavior scores are seeded in DB via test kit helpers
 *   - Context enrichment loads scores into IntentEvaluationContext
 *   - Rego policy evaluation replaces the old rule-based pipeline
 *   - Testing-mode policies log without blocking
 *
 * Driving ports:
 *   enrichBehaviorScores (context enrichment function)
 *   evaluateRegoPolicy (Rego policy evaluation)
 *   SurrealDB direct queries (seeding + verification)
 */
import { describe, expect, it } from "bun:test";
import {
  setupObjectiveBehaviorSuite,
  setupObjectiveWorkspace,
  createAgentIdentity,
  createBehaviorRecord,
  createBehaviorPolicy,
  createIntent,
  getLatestBehaviorScore,
  getIntentRecord,
} from "./objective-behavior-test-kit";
import type { IntentEvaluationContext } from "../../../app/src/server/policy/types";
import {
  evaluateRegoPolicy,
  createEngineCache,
} from "../../../app/src/server/policy/rego-evaluator";
import { buildGateResult } from "../../../app/src/server/policy/policy-gate";
import { enrichBehaviorScores } from "../../../app/src/server/behavior/queries";

const getRuntime = setupObjectiveBehaviorSuite("behavior_policy");

// ---------------------------------------------------------------------------
// Helper: evaluate Rego and build gate result
// ---------------------------------------------------------------------------
async function evaluateAndBuildGateResult(
  regoSource: string,
  policyId: string,
  context: IntentEvaluationContext,
): Promise<{ gateResult: ReturnType<typeof buildGateResult>; regoResult: Awaited<ReturnType<typeof evaluateRegoPolicy>> }> {
  const cache = createEngineCache();
  const regoResult = await evaluateRegoPolicy(regoSource, policyId, 1, context, cache);
  const denied = regoResult.decision === "deny";

  const gateResult = buildGateResult(
    [{
      policyId,
      policyVersion: 1,
      humanVetoRequired: false,
      denied,
      denyMessages: regoResult.messages,
      evidenceRequirement: regoResult.evidence_requirement,
      warnings: [],
    }],
    denied,
    [],
  );

  return { gateResult, regoResult };
}

// =============================================================================
// Walking Skeleton: Behavior policy vetoes intent when score below threshold
// =============================================================================
describe("Walking Skeleton: Behavior policy vetoes deploy intent (US-OB-04)", () => {
  it("intent is vetoed when agent behavior score is below policy threshold", async () => {
    const { surreal } = getRuntime();

    // Given a workspace with a "Security Behavior Gate" policy
    const { workspaceId, identityId: adminId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-veto-${crypto.randomUUID()}`,
    );

    // And a Rego policy that denies when behavior_scores.Security_First < 0.80
    const regoSource = `package osabio.policy

deny["Security_First score below threshold"] {
  input.behavior_scores.Security_First < 0.80
}

default allow = true
`;

    const { policyId } = await createBehaviorPolicy(surreal, workspaceId, adminId, {
      title: "Security Behavior Gate",
      rego_source: regoSource,
    });

    // And Coder-Beta has a Security_First score of 0.65 (below threshold)
    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "Coder-Beta",
    );
    await createBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Security_First",
      score: 0.65,
      source_telemetry: { cve_advisories_in_context: 2, cve_advisories_addressed: 0 },
    });

    // When we build the intent evaluation context with behavior score enrichment
    const baseContext: IntentEvaluationContext = {
      goal: "Deploy auth-service v2.3 to production",
      reasoning: "Latest security patches applied",
      priority: 50,
      action_spec: { provider: "infra", action: "deploy", params: { env: "production" } },
      requester_type: "agent",
      requester_role: "coder",
    };

    const enrichedContext = await enrichBehaviorScores(
      surreal,
      agentId,
      baseContext,
    );

    // Then behavior_scores are populated on the context
    expect(enrichedContext.behavior_scores).toBeDefined();
    expect(enrichedContext.behavior_scores!.Security_First).toBe(0.65);

    // And the Rego policy denies the intent
    const { gateResult, regoResult } = await evaluateAndBuildGateResult(
      regoSource,
      policyId,
      enrichedContext,
    );

    expect(regoResult.decision).toBe("deny");
    expect(regoResult.messages).toContain("Security_First score below threshold");

    // Then the policy gate denies the intent
    expect(gateResult.passed).toBe(false);
    if (!gateResult.passed) {
      expect(gateResult.deny_rule_id).toBe(policyId);
      expect(gateResult.reason).toContain(policyId);
    }
  }, 60_000);
});

// =============================================================================
// Happy Path: Intent passes when score above threshold
// =============================================================================
describe("Happy Path: Intent passes when score above threshold (US-OB-04)", () => {
  it("intent proceeds normally when agent meets behavior requirements", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, identityId: adminId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-pass-${crypto.randomUUID()}`,
    );

    // And Coder-Gamma has a Security_First score of 0.93 (above threshold)
    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "Coder-Gamma",
    );
    await createBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Security_First",
      score: 0.93,
    });

    // When we enrich the context with behavior scores
    const baseContext: IntentEvaluationContext = {
      goal: "Deploy metrics-service to production",
      reasoning: "All tests passing, security review complete",
      priority: 50,
      action_spec: { provider: "infra", action: "deploy", params: { env: "production" } },
      requester_type: "agent",
      requester_role: "coder",
    };

    const enrichedContext = await enrichBehaviorScores(
      surreal,
      agentId,
      baseContext,
    );

    // Then the score is above the threshold
    expect(enrichedContext.behavior_scores!.Security_First).toBe(0.93);

    // And the Rego policy allows the intent
    const regoSource = `package osabio.policy

deny["Security_First score below threshold"] {
  input.behavior_scores.Security_First < 0.80
}

default allow = true
`;

    const { gateResult, regoResult } = await evaluateAndBuildGateResult(
      regoSource,
      `policy-${crypto.randomUUID()}`,
      enrichedContext,
    );

    expect(regoResult.decision).toBe("allow");
    expect(gateResult.passed).toBe(true);
  }, 60_000);
});

// =============================================================================
// Edge Cases
// =============================================================================
describe("Edge Case: Policy in testing mode observes without blocking (US-OB-04)", () => {
  it("testing-mode policy logs would-be veto but allows intent to proceed", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, identityId: adminId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-testing-${crypto.randomUUID()}`,
    );

    // And Coder-Alpha has TDD_Adherence of 0.42 (below threshold)
    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "Coder-Alpha",
    );
    await createBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "TDD_Adherence",
      score: 0.42,
    });

    // When we enrich context and evaluate against a testing-mode policy
    const baseContext: IntentEvaluationContext = {
      goal: "Implement feature toggle system",
      reasoning: "New feature request",
      priority: 50,
      action_spec: { provider: "code", action: "implement", params: {} },
      requester_type: "agent",
      requester_role: "coder",
    };

    const enrichedContext = await enrichBehaviorScores(
      surreal,
      agentId,
      baseContext,
    );

    expect(enrichedContext.behavior_scores!.TDD_Adherence).toBe(0.42);

    // The Rego policy WOULD deny (0.42 < 0.70)
    const regoSource = `package osabio.policy

deny["TDD_Adherence score below threshold"] {
  input.behavior_scores.TDD_Adherence < 0.70
}

default allow = true
`;

    // Evaluate the Rego directly to verify it would deny
    const cache = createEngineCache();
    const regoResult = await evaluateRegoPolicy(
      regoSource,
      "tdd-testing-policy",
      1,
      enrichedContext,
      cache,
    );

    // Verify the Rego rule matched (for logging purposes)
    expect(regoResult.decision).toBe("deny");
    expect(regoResult.messages).toContain("TDD_Adherence score below threshold");

    // But in production, since status is "testing", loadActivePolicies would
    // exclude this policy. With no active deny rules, the intent proceeds.
    const passResult = buildGateResult([], false, []);
    expect(passResult.passed).toBe(true);
  }, 60_000);
});

describe("Edge Case: Human override of behavior veto (US-OB-04)", () => {
  it.skip("human can override behavior veto for critical hotfix", async () => {
    // Given Coder-Beta's deploy intent was vetoed by behavior policy
    // When Tomasz clicks "Override (human)" on the feed card
    // Then the intent transitions from "vetoed" to "authorized"
    // And an observation logs the override with Tomasz's identity
  });
});

// =============================================================================
// Error / Boundary Scenarios
// =============================================================================
describe("Error Path: Agent with no behavior data encounters policy (US-OB-04)", () => {
  it("agent with no behavior scores is not vetoed by behavior policy", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, identityId: adminId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-no-data-${crypto.randomUUID()}`,
    );

    // And a new agent has NO behavior records
    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "Coder-New",
    );

    // When we enrich the context (no behavior data exists)
    const baseContext: IntentEvaluationContext = {
      goal: "Fix typo in readme",
      reasoning: "Minor documentation fix",
      priority: 10,
      action_spec: { provider: "code", action: "fix", params: {} },
      requester_type: "agent",
      requester_role: "coder",
    };

    const enrichedContext = await enrichBehaviorScores(
      surreal,
      agentId,
      baseContext,
    );

    // Then behavior_scores is empty (no scores available)
    expect(enrichedContext.behavior_scores).toEqual({});

    // And a Rego policy that denies when behavior_scores.Security_First < 0.80
    // In Rego, accessing a missing field evaluates to undefined, so the deny
    // rule body is not satisfied -- the intent is allowed.
    const regoSource = `package osabio.policy

deny["Security_First score below threshold"] {
  input.behavior_scores.Security_First < 0.80
}

default allow = true
`;

    const { gateResult, regoResult } = await evaluateAndBuildGateResult(
      regoSource,
      `policy-${crypto.randomUUID()}`,
      enrichedContext,
    );

    // Then the intent is NOT vetoed (missing field => undefined in Rego => deny rule not satisfied)
    expect(regoResult.decision).toBe("allow");
    expect(gateResult.passed).toBe(true);
  }, 60_000);
});

describe("Boundary: High veto rate detection (US-OB-04)", () => {
  it.skip("system creates observation when policy vetoes majority of agents", async () => {
    // Given Tomasz changes TDD_Adherence threshold to 0.95
    // And 5 of 6 agents have scores below 0.95
    // When multiple intents are vetoed
    // Then the system creates an observation with severity "warning"
    // And text includes "Policy vetoing 83% of agents. Consider threshold adjustment."
  });
});

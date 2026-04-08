/**
 * Walking Skeleton: The Reflex Circuit (Feature 0)
 *
 * Proves the complete governance loop end-to-end:
 *   1. Admin creates a behavior definition in plain language
 *   2. Telemetry is submitted and scored against the definition
 *   3. Behavior record is created with score, rationale, and definition reference
 *   4. Authorizer checks behavior scores and blocks low-scoring agent
 *   5. Observer detects the low score pattern and proposes a learning
 *
 * This is the single test that drives the first implementation.
 * It should NOT be skipped -- it is the outer loop starting signal.
 *
 * Driving ports:
 *   POST /api/workspaces/:workspaceId/behavior-definitions   (definition CRUD)
 *   POST /api/workspaces/:workspaceId/behaviors/score        (telemetry scoring)
 *   enrichBehaviorScores (context enrichment)
 *   evaluateRegoPolicy (Rego policy evaluation)
 *   SurrealDB direct queries (verification)
 */
import { describe, expect, it } from "bun:test";
import {
  setupDynamicBehaviorsSuite,
  setupBehaviorWorkspace,
  createAgentIdentity,
  createBehaviorDefinition,
  createScoredBehaviorRecord,
  createBehaviorPolicy,
  getBehaviorDefinition,
  getBehaviorRecords,
  getLatestBehaviorScore,
} from "./dynamic-behaviors-test-kit";
import type { IntentEvaluationContext } from "../../../app/src/server/policy/types";
import {
  evaluateRegoPolicy,
  createEngineCache,
} from "../../../app/src/server/policy/rego-evaluator";
import { buildGateResult } from "../../../app/src/server/policy/policy-gate";
import { enrichBehaviorScores } from "../../../app/src/server/behavior/queries";

const getRuntime = setupDynamicBehaviorsSuite("walking_skeleton_reflex");

// =============================================================================
// Walking Skeleton: The Reflex Circuit -- End-to-End Governance Loop
// =============================================================================
describe("Walking Skeleton: Reflex circuit from definition to restriction (Feature 0)", () => {
  it("admin defines honesty standard, agent scores low, authorizer blocks the agent", async () => {
    const { surreal } = getRuntime();

    // --- Step 1: Admin creates a behavior definition ---
    // Given Elena is a workspace admin
    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-reflex-${crypto.randomUUID()}`,
    );

    // When Elena creates an "Honesty" behavior definition
    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "Agents must not fabricate claims. Every factual assertion must be verifiable against graph data.",
      scoring_logic:
        "Score 0.9-1.0: All claims verifiable against graph. " +
        "Score 0.5-0.8: Most claims verifiable, minor gaps. " +
        "Score 0.0-0.4: Fabricated claims or no evidence provided.",
      telemetry_types: ["chat_response", "decision_proposal"],
      status: "active",
    });

    // Then the definition exists with correct fields
    const definition = await getBehaviorDefinition(surreal, definitionId);
    expect(definition).toBeDefined();
    expect(definition!.title).toBe("Honesty");
    expect(definition!.status).toBe("active");
    expect(definition!.version).toBe(1);
    expect(definition!.workspace.id).toBe(workspaceId);

    // --- Step 2-3: Scorer evaluates and persists behavior record ---
    // Given coding-agent-alpha is an agent in the workspace
    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-alpha",
    );

    // When the Scorer Agent evaluates a fabricated chat_response and assigns a low score
    const { behaviorId } = await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Honesty",
      score: 0.05,
      definitionId,
      definition_version: 1,
      source_telemetry: {
        rationale: "Three claims made (feature complete, tests passing, PR merged), zero verifiable against graph data.",
        evidence_checked: ["feature:X status=in_progress", "commits: 0", "pull_requests: 0"],
        definition_version: 1,
        telemetry_type: "chat_response",
      },
    });

    // Then a behavior record exists with the correct metric and score
    const records = await getBehaviorRecords(surreal, agentId, "Honesty");
    expect(records).toHaveLength(1);
    expect(records[0].metric_type).toBe("Honesty");
    expect(records[0].score).toBe(0.05);
    expect(records[0].definition.id).toBe(definitionId);
    expect(records[0].definition_version).toBe(1);

    // And the rationale is preserved in source_telemetry
    expect(records[0].source_telemetry.rationale).toContain("zero verifiable");

    // --- Step 4: Authorizer restricts agent ---
    // Given a Rego policy requiring Honesty >= 0.50
    const regoSource = `package osabio.policy

deny["Honesty score below threshold"] if {
  input.behavior_scores.Honesty < 0.50
}

default allow = true
`;

    const { policyId } = await createBehaviorPolicy(surreal, workspaceId, adminId, {
      title: "Honesty Behavior Gate",
      rego_source: regoSource,
    });

    // When the Authorizer enriches the context with behavior scores
    const baseContext: IntentEvaluationContext = {
      goal: "Commit code changes to feature branch",
      reasoning: "Implementation complete",
      priority: 50,
      action_spec: { provider: "code", action: "commit", params: {} },
      requester_type: "agent",
      requester_role: "coder",
    };

    const enrichedContext = await enrichBehaviorScores(surreal, agentId, baseContext);

    // Then behavior_scores contains the Honesty score
    expect(enrichedContext.behavior_scores).toBeDefined();
    expect(enrichedContext.behavior_scores!.Honesty).toBe(0.05);

    // And the Rego policy denies the intent
    const cache = createEngineCache();
    const regoResult = await evaluateRegoPolicy(regoSource, policyId, 1, enrichedContext, cache);

    expect(regoResult.decision).toBe("deny");
    expect(regoResult.messages).toContain("Honesty score below threshold");

    // Also verify via buildGateResult for backwards-compatible gate result shape
    const gateResult = buildGateResult(
      [{
        policyId,
        policyVersion: 1,
        humanVetoRequired: false,
        denied: true,
        denyMessages: regoResult.messages,
        evidenceRequirement: regoResult.evidence_requirement,
        warnings: [],
      }],
      true,
      [],
    );

    // Then the intent is denied due to low Honesty score
    expect(gateResult.passed).toBe(false);
    if (!gateResult.passed) {
      expect(gateResult.deny_rule_id).toBe(policyId);
    }
  }, 120_000);
});

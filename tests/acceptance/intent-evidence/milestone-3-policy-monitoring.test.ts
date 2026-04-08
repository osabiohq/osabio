/**
 * Milestone 3: Policy-Driven Evidence Rules and Observer Monitoring
 *
 * Traces: US-10
 *
 * Validates:
 * - Policy rules define per-action evidence requirements
 * - Policy overrides default tier requirements
 * - Observer detects evidence spam patterns
 * - Observer detects evidence reuse anomalies
 * - Normal usage does not trigger false positives
 *
 * Driving ports:
 *   POST /api/workspaces/:ws/policies (policy creation)
 *   POST /api/workspaces/:ws/observer/scan (Observer scan trigger)
 *   GET /api/workspaces/:ws/observer/observations (Observer results)
 *   Intent creation with evidence_refs (SurrealDB direct)
 *   POST /api/intents/:id/evaluate (SurrealQL EVENT target)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createTestIdentity,
  wireIntentEvaluationEvent,
  submitIntent,
  getIntentRecord,
  waitForIntentStatus,
  fetchJson,
  // Evidence-specific helpers
  createEvidenceDecision,
  createEvidenceTask,
  createEvidenceObservation,
  createIntentWithEvidence,
  setWorkspaceEnforcementMode,
  getEvidenceVerification,
  // Policy helpers
  createPolicy,
  activatePolicy,
} from "./intent-evidence-test-kit";
import { queryWorkspaceObservations } from "../shared-fixtures";

const getRuntime = setupOrchestratorSuite("intent_evidence_m3");

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireIntentEvaluationEvent(surreal, port);
});

// =============================================================================
// US-10: Policy Evidence Rules
// =============================================================================
describe("US-10: Policy-driven evidence requirements", () => {
  it("policy defines stricter evidence requirements for financial actions", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a policy requiring 4 evidence refs for financial transactions
    // Driving port: POST /api/workspaces/:ws/policies
    const user = await createTestUser(baseUrl, "m3-policy-strict");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "hard");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // Create and activate policy with evidence_requirement rule for financial actions
    // Driving port: SurrealDB direct (policy creation + activation)
    const { policyId } = await createPolicy(surreal, workspace.workspaceId, agentId, {
      title: "Financial Transaction Evidence Policy",
      description: "Requires 4 evidence references for financial transaction actions",
      selector: { resource: "intent" },
      rego_source: "package osabio.policy\ndefault allow = true\nevidence_requirement = {\"min_count\": 4, \"required_types\": [\"decision\", \"task\"]} {\n  input.action_spec.action == \"financial_transaction\"\n}",
    });
    await activatePolicy(surreal, policyId, agentId, workspace.workspaceId);

    // And the agent provides only 2 evidence references for a financial transaction
    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Approve Q3 budget allocation",
    });
    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Review financial projections",
    });

    // When the agent submits a financial transaction intent
    // Driving port: intent creation with evidence_refs (SurrealDB)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Execute Q3 budget disbursement to suppliers",
        reasoning: "Budget approved and projections reviewed",
        priority: 70,
        evidenceRefs: [decision.decisionRecord, task.taskRecord],
        actionSpec: { provider: "finance", action: "financial_transaction", params: {} },
      },
    );

    // And the verification pipeline runs
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the intent fails the policy-specific evidence requirement
    const record = await getIntentRecord(surreal, intentId);
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    // Policy requires 4 evidence refs but only 2 were provided
    expect(verification!.warnings).toBeDefined();
    expect(verification!.warnings!.some((w: string) =>
      w.includes("policy") || w.includes("evidence") || w.includes("4"),
    )).toBe(true);
    // The intent should be rejected or reflect the unmet policy requirement
    expect(record.status).toBe("failed");
  }, 60_000);

  it("policy overrides default tier requirements for specific action type", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a policy allowing 1 ref for data_read actions
    // Driving port: POST /api/workspaces/:ws/policies
    const user = await createTestUser(baseUrl, "m3-policy-override");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "hard");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // Create and activate policy allowing 1 ref for data_read actions
    // Driving port: SurrealDB direct (policy creation + activation)
    const { policyId } = await createPolicy(surreal, workspace.workspaceId, agentId, {
      title: "Data Read Evidence Policy",
      description: "Allows 1 evidence reference for data_read actions",
      selector: { resource: "intent" },
      rego_source: "package osabio.policy\ndefault allow = true\nevidence_requirement = {\"min_count\": 1} {\n  input.action_spec.action == \"data_read\"\n}",
    });
    await activatePolicy(surreal, policyId, agentId, workspace.workspaceId);

    // When the agent submits a data read intent with 1 observation reference
    // Driving port: intent creation with evidence_refs (SurrealDB)
    const obs = await createEvidenceObservation(surreal, workspace.workspaceId, {
      text: "Data quality check passed",
      sourceAgent: "observer-agent",
    });
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Read supplier performance data for Q3 report",
        reasoning: "Data quality verified by observer",
        priority: 10,
        evidenceRefs: [obs.observationRecord],
        actionSpec: { provider: "analytics", action: "data_read", params: {} },
      },
    );

    // And the verification pipeline runs
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the policy-specific requirement is met
    const record = await getIntentRecord(surreal, intentId);
    expect(record.status).not.toBe("failed");
  }, 60_000);

  it("intent without matching policy falls back to default tier requirements", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with no policy for "configuration_update" actions
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m3-policy-fallback");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Review configuration change request",
    });

    // When the agent submits a configuration update intent
    // Driving port: intent creation with evidence_refs (SurrealDB)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Update warehouse routing configuration",
        reasoning: "Configuration review task complete",
        priority: 30,
        evidenceRefs: [task.taskRecord],
        actionSpec: { provider: "config", action: "configuration_update", params: {} },
      },
    );

    // And the verification pipeline runs
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the default risk-tiered evidence requirements apply
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
  }, 60_000);
});

// =============================================================================
// US-10: Observer Anomaly Detection
// =============================================================================
describe("US-10: Observer evidence anomaly detection", () => {
  it("M3-4: evidence spam pattern triggers Observer anomaly detection", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    const user = await createTestUser(baseUrl, "m3-observer-spam");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And the Logistics-Planner agent creates 15 observations rapidly
    for (let i = 0; i < 15; i++) {
      await createEvidenceObservation(surreal, workspace.workspaceId, {
        text: `Rapid observation ${i + 1} for evidence spam test`,
        sourceAgent: "logistics-planner",
      });
    }

    // When the Observer runs its evidence anomaly scan
    // Driving port: detectEvidenceSpam (deterministic graph scan function)
    const { detectEvidenceSpam } = await import("../../../app/src/server/observer/graph-scan");
    const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
    const scanResult = await detectEvidenceSpam(surreal, workspaceRecord);

    // Then the Observer creates an anomaly observation of type "evidence_anomaly"
    expect(scanResult.observations_created).toBeGreaterThanOrEqual(1);

    const observations = await queryWorkspaceObservations(surreal, workspace.workspaceId, "observer_agent");
    const evidenceAnomalies = observations.filter(o => o.observation_type === "evidence_anomaly");
    expect(evidenceAnomalies.length).toBeGreaterThanOrEqual(1);
    // The observation should mention the agent and the spam pattern
    expect(evidenceAnomalies[0].text).toContain("logistics-planner");
    expect(evidenceAnomalies[0].severity).toBe("warning");
  }, 60_000);

  it("M3-5: repeated evidence reuse across intents triggers anomaly detection", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m3-observer-reuse");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And the same 2 evidence references are reused across 8 intents
    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Reused decision across many intents",
    });
    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Reused task across many intents",
    });

    for (let i = 0; i < 8; i++) {
      await createIntentWithEvidence(
        surreal, workspace.workspaceId, agentId,
        {
          goal: `Intent ${i + 1} reusing same evidence`,
          reasoning: "Testing evidence reuse detection",
          evidenceRefs: [decision.decisionRecord, task.taskRecord],
        },
      );
    }

    // When the Observer runs its evidence reuse scan
    // Driving port: detectEvidenceReuse (deterministic graph scan function)
    const { detectEvidenceReuse } = await import("../../../app/src/server/observer/graph-scan");
    const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
    const scanResult = await detectEvidenceReuse(surreal, workspaceRecord);

    // Then the Observer flags the reuse pattern as an evidence anomaly
    expect(scanResult.observations_created).toBeGreaterThanOrEqual(1);

    const observations = await queryWorkspaceObservations(surreal, workspace.workspaceId, "observer_agent");
    const evidenceAnomalies = observations.filter(o => o.observation_type === "evidence_anomaly");
    expect(evidenceAnomalies.length).toBeGreaterThanOrEqual(1);
    // The observation should mention the agent and the reuse pattern
    expect(evidenceAnomalies[0].text).toContain("logistics-planner");
    expect(evidenceAnomalies[0].severity).toBe("warning");
  }, 60_000);

  it("M3-6: normal evidence usage does not trigger anomaly", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with normal evidence usage patterns
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m3-observer-normal");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And agents submit a few intents with varied evidence
    for (let i = 0; i < 3; i++) {
      const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
        summary: `Normal decision ${i + 1}`,
      });
      await createIntentWithEvidence(
        surreal, workspace.workspaceId, agentId,
        {
          goal: `Normal intent ${i + 1}`,
          reasoning: "Normal evidence usage",
          evidenceRefs: [decision.decisionRecord],
        },
      );
    }

    // When the Observer runs its evidence anomaly scans
    // Driving port: detectEvidenceSpam + detectEvidenceReuse (deterministic graph scan functions)
    const { detectEvidenceSpam, detectEvidenceReuse } = await import("../../../app/src/server/observer/graph-scan");
    const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
    await detectEvidenceSpam(surreal, workspaceRecord);
    await detectEvidenceReuse(surreal, workspaceRecord);

    // Then no evidence anomaly observations are created
    const observations = await queryWorkspaceObservations(surreal, workspace.workspaceId, "observer_agent");
    const anomalies = observations.filter(o => o.observation_type === "evidence_anomaly");
    expect(anomalies).toHaveLength(0);
  }, 60_000);
});

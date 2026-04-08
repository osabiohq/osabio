/**
 * Objective & Behavior Acceptance Test Kit
 *
 * Extends acceptance-test-kit with helpers specific to the objective and
 * behavior node feature set.
 *
 * All helpers use business language -- no technical jargon in function names.
 *
 * Driving ports:
 *   POST /api/workspaces/:workspaceId/objectives       (objective CRUD)
 *   GET  /api/workspaces/:workspaceId/objectives        (list objectives)
 *   GET  /api/workspaces/:workspaceId/objectives/:id    (objective detail + progress)
 *   POST /api/workspaces/:workspaceId/behaviors         (behavior record creation)
 *   GET  /api/workspaces/:workspaceId/behaviors          (behavior listing)
 *   POST /api/observe/scan/:workspaceId                 (coherence auditor via graph scan)
 *   POST /api/workspaces/:workspaceId/learnings         (learning proposal)
 *   SurrealDB direct queries                            (verification of outcomes)
 */
import { RecordId, type Surreal } from "surrealdb";
import {
  setupAcceptanceSuite,
  createTestUser,
  createTestUserWithMcp,
  type AcceptanceTestRuntime,
  type TestUser,
  type TestUserWithMcp,
} from "../acceptance-test-kit";
import {
  createWorkspaceDirectly,
  createIdentity,
  createIntentDirectly,
  createDecisionDirectly,
  queryWorkspaceObservations as sharedQueryWorkspaceObservations,
  type ActionSpec,
} from "../shared-fixtures";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  setupAcceptanceSuite,
  createTestUser,
  createTestUserWithMcp,
  type AcceptanceTestRuntime,
  type TestUser,
  type TestUserWithMcp,
};

// ---------------------------------------------------------------------------
// Suite Setup
// ---------------------------------------------------------------------------

/**
 * Sets up an objective-behavior acceptance test suite with isolated server + DB.
 */
export function setupObjectiveBehaviorSuite(
  suiteName: string,
): () => AcceptanceTestRuntime {
  return setupAcceptanceSuite(suiteName);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ObjectiveStatus = "draft" | "active" | "completed" | "archived" | "expired";
export type ObjectivePriority = "low" | "medium" | "high" | "critical";

export type SuccessCriterion = {
  metric_name: string;
  target_value: number;
  current_value: number;
  unit: string;
};

export type ObjectiveRecord = {
  id: RecordId<"objective">;
  title: string;
  description?: string;
  status: ObjectiveStatus;
  priority: ObjectivePriority;
  target_date?: string;
  success_criteria: SuccessCriterion[];
  workspace: RecordId<"workspace">;
  created_at: string;
  updated_at?: string;
};

export type BehaviorRecord = {
  id: RecordId<"behavior">;
  metric_type: string;
  score: number;
  source_telemetry: Record<string, unknown>;
  workspace: RecordId<"workspace">;
  created_at: string;
};

export type SupportsEdge = {
  id: RecordId<"supports">;
  in: RecordId<"intent">;
  out: RecordId<"objective">;
  alignment_score: number;
  alignment_method: "embedding" | "manual" | "rule" | "graph" | "bm25";
  reasoning?: string;
};

export type ExhibitsEdge = {
  id: RecordId<"exhibits">;
  in: RecordId<"identity">;
  out: RecordId<"behavior">;
};

// ---------------------------------------------------------------------------
// Given Helpers -- Seed preconditions
// ---------------------------------------------------------------------------

/**
 * Creates a workspace and test user for objective-behavior tests.
 */
export async function setupObjectiveWorkspace(
  baseUrl: string,
  surreal: Surreal,
  suffix: string,
): Promise<{
  user: TestUser;
  workspaceId: string;
  identityId: string;
}> {
  const user = await createTestUser(baseUrl, suffix);
  const ws = await createWorkspaceDirectly(surreal, suffix, {
    workspaceName: `Objective Test Workspace ${suffix}`,
  });
  return { user, workspaceId: ws.workspaceId, identityId: ws.identityId };
}

/**
 * Creates an agent identity in the workspace.
 */
export async function createAgentIdentity(
  surreal: Surreal,
  workspaceId: string,
  agentName: string,
): Promise<{ identityId: string }> {
  const result = await createIdentity(surreal, workspaceId, agentName, "agent");
  return { identityId: result.identityId };
}

/**
 * Creates an objective node directly in the database.
 */
export async function createObjective(
  surreal: Surreal,
  workspaceId: string,
  opts: {
    title: string;
    description?: string;
    status?: ObjectiveStatus;
    priority?: ObjectivePriority;
    target_date?: string;
    success_criteria?: SuccessCriterion[];
  },
): Promise<{ objectiveId: string }> {
  const objectiveId = `obj-${crypto.randomUUID()}`;
  const objectiveRecord = new RecordId("objective", objectiveId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $objective CONTENT $content;`, {
    objective: objectiveRecord,
    content: {
      title: opts.title,
      description: opts.description ?? opts.title,
      status: opts.status ?? "active",
      priority: opts.priority ?? "high",
      target_date: opts.target_date,
      success_criteria: opts.success_criteria ?? [],
      workspace: workspaceRecord,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  return { objectiveId };
}

/**
 * Links an objective to a project or workspace via has_objective edge.
 */
export async function linkObjectiveToProject(
  surreal: Surreal,
  projectId: string,
  objectiveId: string,
): Promise<void> {
  const projectRecord = new RecordId("project", projectId);
  const objectiveRecord = new RecordId("objective", objectiveId);

  await surreal.query(
    `RELATE $project->has_objective->$objective SET added_at = time::now();`,
    { project: projectRecord, objective: objectiveRecord },
  );
}

/**
 * Creates a behavior_definition record (required by behavior records).
 */
export async function createBehaviorDefinition(
  surreal: Surreal,
  workspaceId: string,
  opts: {
    title: string;
    goal?: string;
    scoring_logic?: string;
    telemetry_types?: string[];
    status?: "draft" | "active" | "archived";
    version?: number;
    created_by?: string;
  },
): Promise<{ definitionId: string }> {
  const definitionId = `bdef-${crypto.randomUUID()}`;
  const definitionRecord = new RecordId("behavior_definition", definitionId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const content: Record<string, unknown> = {
    title: opts.title,
    goal: opts.goal ?? `Measure ${opts.title}`,
    scoring_logic: opts.scoring_logic ?? "LLM evaluation of session telemetry",
    telemetry_types: opts.telemetry_types ?? ["files_changed", "test_files_changed"],
    status: opts.status ?? "active",
    version: opts.version ?? 1,
    enforcement_mode: "warn_only",
    workspace: workspaceRecord,
    created_at: new Date(),
  };
  if (opts.created_by) {
    content.created_by = new RecordId("identity", opts.created_by);
  }

  await surreal.query(`CREATE $def CONTENT $content;`, {
    def: definitionRecord,
    content,
  });

  return { definitionId };
}

/**
 * Creates a behavior record for an agent.
 * Auto-creates a behavior_definition if definitionId is not provided.
 */
export async function createBehaviorRecord(
  surreal: Surreal,
  workspaceId: string,
  identityId: string,
  opts: {
    metric_type: string;
    score: number;
    source_telemetry?: Record<string, unknown>;
    created_at?: Date;
    definitionId?: string;
    definition_version?: number;
  },
): Promise<{ behaviorId: string; definitionId: string }> {
  // Auto-create a behavior_definition if not provided
  const definitionId = opts.definitionId
    ?? (await createBehaviorDefinition(surreal, workspaceId, {
        title: opts.metric_type,
      })).definitionId;

  const behaviorId = `beh-${crypto.randomUUID()}`;
  const behaviorRecord = new RecordId("behavior", behaviorId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const identityRecord = new RecordId("identity", identityId);
  const definitionRecord = new RecordId("behavior_definition", definitionId);

  await surreal.query(`CREATE $behavior CONTENT $content;`, {
    behavior: behaviorRecord,
    content: {
      metric_type: opts.metric_type,
      score: opts.score,
      source_telemetry: opts.source_telemetry ?? {},
      definition: definitionRecord,
      definition_version: opts.definition_version ?? 1,
      workspace: workspaceRecord,
      created_at: opts.created_at ?? new Date(),
    },
  });

  // Create exhibits edge: identity ->exhibits-> behavior
  await surreal.query(
    `RELATE $identity->exhibits->$behavior SET added_at = time::now();`,
    { identity: identityRecord, behavior: behaviorRecord },
  );

  return { behaviorId, definitionId };
}

/**
 * Creates multiple consecutive behavior records for trend testing.
 * Records are created with staggered timestamps to simulate sessions over time.
 */
export async function createBehaviorTrend(
  surreal: Surreal,
  workspaceId: string,
  identityId: string,
  metricType: string,
  scores: number[],
): Promise<{ behaviorIds: string[]; definitionId: string }> {
  const behaviorIds: string[] = [];
  const now = Date.now();

  // Create one shared definition for the whole trend
  const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, {
    title: metricType,
  });

  for (let i = 0; i < scores.length; i++) {
    // Each record 1 day apart, oldest first
    const created_at = new Date(now - (scores.length - 1 - i) * 24 * 60 * 60 * 1000);
    const { behaviorId } = await createBehaviorRecord(surreal, workspaceId, identityId, {
      metric_type: metricType,
      score: scores[i],
      source_telemetry: { session_index: i },
      created_at,
      definitionId,
    });
    behaviorIds.push(behaviorId);
  }

  return { behaviorIds, definitionId };
}

/**
 * Creates an intent record in the graph.
 */
export async function createIntent(
  surreal: Surreal,
  workspaceId: string,
  requesterId: string,
  opts: {
    goal: string;
    reasoning?: string;
    status?: string;
    action_spec?: ActionSpec;
  },
): Promise<{ intentId: string }> {
  const result = await createIntentDirectly(surreal, workspaceId, requesterId, {
    goal: opts.goal,
    reasoning: opts.reasoning,
    status: opts.status ?? "pending_auth",
    actionSpec: opts.action_spec,
  });
  return { intentId: result.intentId };
}

/**
 * Creates a supports edge between an intent and an objective.
 */
export async function createSupportsEdge(
  surreal: Surreal,
  intentId: string,
  objectiveId: string,
  opts?: {
    alignment_score?: number;
    alignment_method?: "embedding" | "manual" | "rule";
    reasoning?: string;
  },
): Promise<void> {
  const intentRecord = new RecordId("intent", intentId);
  const objectiveRecord = new RecordId("objective", objectiveId);

  await surreal.query(
    `RELATE $intent->supports->$objective CONTENT $content;`,
    {
      intent: intentRecord,
      objective: objectiveRecord,
      content: {
        alignment_score: opts?.alignment_score ?? 0.85,
        alignment_method: opts?.alignment_method ?? "embedding",
        reasoning: opts?.reasoning ?? "Automatically aligned by embedding similarity",
        added_at: new Date(),
      },
    },
  );
}

/**
 * Creates a policy with behavior-based rules.
 */
export async function createBehaviorPolicy(
  surreal: Surreal,
  workspaceId: string,
  creatorId: string,
  opts: {
    title: string;
    status?: "draft" | "active" | "testing" | "archived";
    rego_source: string;
  },
): Promise<{ policyId: string }> {
  const policyId = `policy-${crypto.randomUUID()}`;
  const policyRecord = new RecordId("policy", policyId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const creatorRecord = new RecordId("identity", creatorId);

  await surreal.query(`CREATE $policy CONTENT $content;`, {
    policy: policyRecord,
    content: {
      title: opts.title,
      description: `Policy: ${opts.title}`,
      status: opts.status ?? "active",
      version: 1,
      selector: {},
      rego_source: opts.rego_source,
      created_by: creatorRecord,
      workspace: workspaceRecord,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  return { policyId };
}

/**
 * Creates a confirmed decision in the workspace (for coherence auditor tests).
 */
export async function createDecision(
  surreal: Surreal,
  workspaceId: string,
  opts: {
    summary: string;
    status?: string;
    created_at?: Date;
  },
): Promise<{ decisionId: string }> {
  const result = await createDecisionDirectly(surreal, workspaceId, {
    summary: opts.summary,
    status: opts.status,
    created_at: opts.created_at,
  });
  return { decisionId: result.decisionId };
}

/**
 * Creates an agent session record for behavior telemetry tests.
 */
export async function createAgentSession(
  surreal: Surreal,
  workspaceId: string,
  identityId: string,
  opts?: {
    status?: string;
    files_changed?: number;
    test_files_changed?: number;
  },
): Promise<{ sessionId: string }> {
  const sessionId = `session-${crypto.randomUUID()}`;
  const sessionRecord = new RecordId("agent_session", sessionId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const identityRecord = new RecordId("identity", identityId);

  await surreal.query(`CREATE $sess CONTENT $content;`, {
    sess: sessionRecord,
    content: {
      status: opts?.status ?? "completed",
      agent: identityRecord,
      workspace: workspaceRecord,
      telemetry: {
        files_changed: opts?.files_changed ?? 10,
        test_files_changed: opts?.test_files_changed ?? 3,
      },
      started_at: new Date(),
      completed_at: new Date(),
      created_at: new Date(),
    },
  });

  return { sessionId };
}

// ---------------------------------------------------------------------------
// Alignment Adapter Helpers (for automatic alignment tests)
// ---------------------------------------------------------------------------

/**
 * Creates a deterministic 1536-dim test embedding vector.
 *
 * Vectors with the same primaryDim share high cosine similarity.
 * Vectors with different primaryDims are near-orthogonal.
 */
export function makeTestEmbedding(primaryDim: number, secondaryDim?: number): number[] {
  const vec = new Array(1536).fill(0);
  vec[primaryDim % 1536] = 1.0;
  if (secondaryDim !== undefined) vec[secondaryDim % 1536] = 0.3;
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => v / mag);
}

/**
 * Runs the alignment adapter to find objectives matching an intent embedding.
 * Direct call to the SurrealDB KNN adapter — no authorizer pipeline.
 */
export async function findAlignedObjectives(
  surreal: Surreal,
  intentEmbedding: number[],
  workspaceId: string,
): Promise<Array<{ objectiveId: string; title: string; score: number }>> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const rows = (await surreal.query(
    `LET $candidates = SELECT id, title, workspace, status,
        vector::similarity::cosine(embedding, $vec) AS score
      FROM objective WHERE embedding <|20, COSINE|> $vec;
     SELECT id, title, score FROM $candidates
      WHERE workspace = $ws AND status = 'active'
      ORDER BY score DESC LIMIT 10;`,
    { vec: intentEmbedding, ws: workspaceRecord },
  )) as [null, Array<{ id: RecordId<"objective">; title: string; score: number }>];

  const candidates = rows[1] ?? [];
  return candidates.map((row) => ({
    objectiveId: row.id.id as string,
    title: row.title,
    score: row.score,
  }));
}

/**
 * Creates a warning observation for unaligned intent.
 */
export async function createAlignmentWarningObservation(
  surreal: Surreal,
  workspaceId: string,
  intentId: string,
  bestScore: number,
): Promise<void> {
  const observationId = crypto.randomUUID();
  const observationRecord = new RecordId("observation", observationId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const intentRecord = new RecordId("intent", intentId);

  await surreal.query(`CREATE $obs CONTENT $content;`, {
    obs: observationRecord,
    content: {
      text: `Intent has no supporting objective (best alignment score: ${bestScore.toFixed(2)}). Agent work may not align with organizational goals.`,
      severity: "warning",
      status: "open",
      observation_type: "alignment",
      source_agent: "authorizer",
      workspace: workspaceRecord,
      verified: false,
      evidence_refs: [intentRecord],
      created_at: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// Then Helpers -- Verify outcomes
// ---------------------------------------------------------------------------

/**
 * Retrieves an objective by ID.
 */
export async function getObjective(
  surreal: Surreal,
  objectiveId: string,
): Promise<ObjectiveRecord | undefined> {
  const objectiveRecord = new RecordId("objective", objectiveId);
  const rows = (await surreal.query(
    `SELECT * FROM $objective;`,
    { objective: objectiveRecord },
  )) as Array<ObjectiveRecord[]>;
  return rows[0]?.[0];
}

/**
 * Lists all objectives in a workspace.
 */
export async function listObjectives(
  surreal: Surreal,
  workspaceId: string,
  status?: ObjectiveStatus,
): Promise<ObjectiveRecord[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  if (status) {
    const rows = (await surreal.query(
      `SELECT * FROM objective WHERE workspace = $ws AND status = $status ORDER BY created_at DESC;`,
      { ws: workspaceRecord, status },
    )) as Array<ObjectiveRecord[]>;
    return rows[0] ?? [];
  }

  const rows = (await surreal.query(
    `SELECT * FROM objective WHERE workspace = $ws ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  )) as Array<ObjectiveRecord[]>;
  return rows[0] ?? [];
}

/**
 * Retrieves behavior records for an identity.
 */
export async function getBehaviorRecords(
  surreal: Surreal,
  identityId: string,
  metricType?: string,
): Promise<BehaviorRecord[]> {
  const identityRecord = new RecordId("identity", identityId);

  // Traverse exhibits edges from identity to behavior
  const edgeRows = (await surreal.query(
    `SELECT ->exhibits->behavior AS behaviors FROM $identity;`,
    { identity: identityRecord },
  )) as Array<Array<{ behaviors: RecordId[] }>>;

  const behaviorIds = edgeRows[0]?.[0]?.behaviors ?? [];
  if (behaviorIds.length === 0) return [];

  if (metricType) {
    const rows = (await surreal.query(
      `SELECT * FROM behavior WHERE id IN $ids AND metric_type = $mt ORDER BY created_at DESC;`,
      { ids: behaviorIds, mt: metricType },
    )) as Array<BehaviorRecord[]>;
    return rows[0] ?? [];
  }

  const rows = (await surreal.query(
    `SELECT * FROM behavior WHERE id IN $ids ORDER BY created_at DESC;`,
    { ids: behaviorIds },
  )) as Array<BehaviorRecord[]>;
  return rows[0] ?? [];
}

/**
 * Gets the latest behavior score for an identity and metric type.
 */
export async function getLatestBehaviorScore(
  surreal: Surreal,
  identityId: string,
  metricType: string,
): Promise<number | undefined> {
  const records = await getBehaviorRecords(surreal, identityId, metricType);
  return records[0]?.score;
}

/**
 * Retrieves supports edges for an intent.
 */
export async function getSupportsEdgesForIntent(
  surreal: Surreal,
  intentId: string,
): Promise<SupportsEdge[]> {
  const intentRecord = new RecordId("intent", intentId);
  const rows = (await surreal.query(
    `SELECT * FROM supports WHERE in = $intent;`,
    { intent: intentRecord },
  )) as Array<SupportsEdge[]>;
  return rows[0] ?? [];
}

/**
 * Retrieves supports edges for an objective.
 */
export async function getSupportsEdgesForObjective(
  surreal: Surreal,
  objectiveId: string,
): Promise<SupportsEdge[]> {
  const objectiveRecord = new RecordId("objective", objectiveId);
  const rows = (await surreal.query(
    `SELECT * FROM supports WHERE out = $objective;`,
    { objective: objectiveRecord },
  )) as Array<SupportsEdge[]>;
  return rows[0] ?? [];
}

/**
 * Counts supporting intents for an objective.
 */
export async function countSupportingIntents(
  surreal: Surreal,
  objectiveId: string,
): Promise<number> {
  const edges = await getSupportsEdgesForObjective(surreal, objectiveId);
  return edges.length;
}

/**
 * Retrieves observations in a workspace filtered by text content.
 */
export async function getWorkspaceObservations(
  surreal: Surreal,
  workspaceId: string,
  opts?: { sourceAgent?: string },
): Promise<Array<{
  id: RecordId;
  text: string;
  severity: string;
  status: string;
  source_agent: string;
}>> {
  return sharedQueryWorkspaceObservations(surreal, workspaceId, opts?.sourceAgent);
}

/**
 * Gets the intent record by ID.
 */
export async function getIntentRecord(
  surreal: Surreal,
  intentId: string,
): Promise<Record<string, unknown> | undefined> {
  const intentRecord = new RecordId("intent", intentId);
  const rows = (await surreal.query(
    `SELECT * FROM $intent;`,
    { intent: intentRecord },
  )) as Array<Array<Record<string, unknown>>>;
  return rows[0]?.[0];
}

/**
 * Checks if a behavior record can be updated (should fail for append-only).
 */
export async function attemptBehaviorUpdate(
  surreal: Surreal,
  behaviorId: string,
  newScore: number,
): Promise<{ updated: boolean; error?: string }> {
  try {
    const behaviorRecord = new RecordId("behavior", behaviorId);
    await surreal.query(
      `UPDATE $behavior SET score = $score;`,
      { behavior: behaviorRecord, score: newScore },
    );
    // Verify the update actually took effect
    const rows = (await surreal.query(
      `SELECT score FROM $behavior;`,
      { behavior: behaviorRecord },
    )) as Array<Array<{ score: number }>>;
    const actualScore = rows[0]?.[0]?.score;
    return { updated: actualScore === newScore };
  } catch (error) {
    return { updated: false, error: error instanceof Error ? error.message : String(error) };
  }
}

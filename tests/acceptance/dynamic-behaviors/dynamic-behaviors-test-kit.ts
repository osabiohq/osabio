/**
 * Dynamic Behavior Definitions Acceptance Test Kit
 *
 * Extends acceptance-test-kit with helpers specific to the dynamic
 * behavior definition feature set (US-DB-001 through US-DB-004).
 *
 * All helpers use business language -- no technical jargon in function names.
 *
 * Driving ports:
 *   POST /api/workspaces/:workspaceId/behavior-definitions       (definition CRUD)
 *   GET  /api/workspaces/:workspaceId/behavior-definitions        (list definitions)
 *   GET  /api/workspaces/:workspaceId/behavior-definitions/:id    (definition detail)
 *   PUT  /api/workspaces/:workspaceId/behavior-definitions/:id    (update definition)
 *   POST /api/workspaces/:workspaceId/behaviors/score             (telemetry scoring)
 *   GET  /api/workspaces/:workspaceId/behaviors                   (behavior listing)
 *   POST /api/observe/scan/:workspaceId                           (observer graph scan)
 *   SurrealDB direct queries                                      (verification of outcomes)
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
 * Sets up a dynamic-behaviors acceptance test suite with isolated server + DB.
 */
export function setupDynamicBehaviorsSuite(
  suiteName: string,
): () => AcceptanceTestRuntime {
  return setupAcceptanceSuite(suiteName);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DefinitionStatus = "draft" | "active" | "archived";
export type EnforcementMode = "warn_only" | "automatic";

export type BehaviorDefinitionRecord = {
  id: RecordId<"behavior_definition">;
  title: string;
  goal: string;
  scoring_logic: string;
  telemetry_types: string[];
  category?: string;
  status: DefinitionStatus;
  version: number;
  enforcement_mode: EnforcementMode;
  enforcement_threshold?: number;
  workspace: RecordId<"workspace">;
  created_by?: RecordId<"identity">;
  created_at: string;
  updated_at?: string;
};

export type BehaviorRecord = {
  id: RecordId<"behavior">;
  metric_type: string;
  score: number;
  source_telemetry: Record<string, unknown>;
  definition: RecordId<"behavior_definition">;
  definition_version: number;
  workspace: RecordId<"workspace">;
  created_at: string;
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
 * Creates a workspace and admin identity for dynamic behavior tests.
 */
export async function setupBehaviorWorkspace(
  baseUrl: string,
  surreal: Surreal,
  suffix: string,
): Promise<{
  user: TestUser;
  workspaceId: string;
  adminId: string;
}> {
  const workspaceId = crypto.randomUUID();
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const user = await createTestUser(baseUrl, suffix);

  await surreal.query(`CREATE $workspace CONTENT $content;`, {
    workspace: workspaceRecord,
    content: {
      name: `Dynamic Behaviors Workspace ${suffix}`,
      status: "active",
      onboarding_complete: true,
      onboarding_turn_count: 0,
      onboarding_summary_pending: false,
      onboarding_started_at: new Date(),
      created_at: new Date(),
    },
  });

  const adminId = crypto.randomUUID();
  const adminRecord = new RecordId("identity", adminId);

  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: adminRecord,
    content: {
      name: `Admin ${suffix}`,
      type: "human",
      identity_status: "active",
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  await surreal.query(`RELATE $identity->member_of->$workspace SET added_at = time::now();`, {
    identity: adminRecord,
    workspace: workspaceRecord,
  });

  return { user, workspaceId, adminId };
}

/**
 * Creates an agent identity in the workspace.
 */
export async function createAgentIdentity(
  surreal: Surreal,
  workspaceId: string,
  agentName: string,
): Promise<{ identityId: string }> {
  const identityId = crypto.randomUUID();
  const identityRecord = new RecordId("identity", identityId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: identityRecord,
    content: {
      name: agentName,
      type: "agent",
      identity_status: "active",
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  await surreal.query(`RELATE $identity->member_of->$workspace SET added_at = time::now();`, {
    identity: identityRecord,
    workspace: workspaceRecord,
  });

  return { identityId };
}

/**
 * Creates a behavior definition directly in the database.
 */
export async function createBehaviorDefinition(
  surreal: Surreal,
  workspaceId: string,
  adminId: string,
  opts: {
    title: string;
    goal: string;
    scoring_logic: string;
    telemetry_types: string[];
    category?: string;
    status?: DefinitionStatus;
    version?: number;
    enforcement_mode?: EnforcementMode;
    enforcement_threshold?: number;
  },
): Promise<{ definitionId: string }> {
  const definitionId = `def-${crypto.randomUUID()}`;
  const definitionRecord = new RecordId("behavior_definition", definitionId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const adminRecord = new RecordId("identity", adminId);

  const content: Record<string, unknown> = {
    title: opts.title,
    goal: opts.goal,
    scoring_logic: opts.scoring_logic,
    telemetry_types: opts.telemetry_types,
    status: opts.status ?? "draft",
    version: opts.version ?? 1,
    enforcement_mode: opts.enforcement_mode ?? "warn_only",
    workspace: workspaceRecord,
    created_by: adminRecord,
    created_at: new Date(),
  };

  if (opts.category !== undefined) content.category = opts.category;
  if (opts.enforcement_threshold !== undefined) content.enforcement_threshold = opts.enforcement_threshold;

  await surreal.query(`CREATE $definition CONTENT $content;`, {
    definition: definitionRecord,
    content,
  });

  return { definitionId };
}

/**
 * Creates a behavior record scored against a definition.
 */
export async function createScoredBehaviorRecord(
  surreal: Surreal,
  workspaceId: string,
  identityId: string,
  opts: {
    metric_type: string;
    score: number;
    definitionId: string;
    definition_version?: number;
    source_telemetry?: Record<string, unknown>;
    created_at?: Date;
  },
): Promise<{ behaviorId: string }> {
  const behaviorId = `beh-${crypto.randomUUID()}`;
  const behaviorRecord = new RecordId("behavior", behaviorId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const identityRecord = new RecordId("identity", identityId);
  const definitionRecord = new RecordId("behavior_definition", opts.definitionId);

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

  // Create exhibits edge: identity -> behavior
  await surreal.query(
    `RELATE $identity->exhibits->$behavior SET added_at = time::now();`,
    { identity: identityRecord, behavior: behaviorRecord },
  );

  return { behaviorId };
}

/**
 * Creates multiple scored behavior records with staggered timestamps for trend testing.
 */
export async function createScoredBehaviorTrend(
  surreal: Surreal,
  workspaceId: string,
  identityId: string,
  metricType: string,
  definitionId: string,
  scores: number[],
): Promise<{ behaviorIds: string[] }> {
  const behaviorIds: string[] = [];
  const now = Date.now();

  for (let i = 0; i < scores.length; i++) {
    const created_at = new Date(now - (scores.length - 1 - i) * 24 * 60 * 60 * 1000);
    const { behaviorId } = await createScoredBehaviorRecord(surreal, workspaceId, identityId, {
      metric_type: metricType,
      score: scores[i],
      definitionId,
      source_telemetry: { session_index: i },
      created_at,
    });
    behaviorIds.push(behaviorId);
  }

  return { behaviorIds };
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
      created_by: creatorRecord,
      workspace: workspaceRecord,
      rego_source: opts.rego_source,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  return { policyId };
}

// ---------------------------------------------------------------------------
// Then Helpers -- Verify outcomes
// ---------------------------------------------------------------------------

/**
 * Retrieves a behavior definition by ID.
 */
export async function getBehaviorDefinition(
  surreal: Surreal,
  definitionId: string,
): Promise<BehaviorDefinitionRecord | undefined> {
  const definitionRecord = new RecordId("behavior_definition", definitionId);
  const rows = (await surreal.query(
    `SELECT * FROM $definition;`,
    { definition: definitionRecord },
  )) as Array<BehaviorDefinitionRecord[]>;
  return rows[0]?.[0];
}

/**
 * Lists behavior definitions in a workspace, optionally filtered by status.
 */
export async function listBehaviorDefinitions(
  surreal: Surreal,
  workspaceId: string,
  status?: DefinitionStatus,
): Promise<BehaviorDefinitionRecord[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  if (status) {
    const rows = (await surreal.query(
      `SELECT * FROM behavior_definition WHERE workspace = $ws AND status = $status ORDER BY created_at DESC;`,
      { ws: workspaceRecord, status },
    )) as Array<BehaviorDefinitionRecord[]>;
    return rows[0] ?? [];
  }

  const rows = (await surreal.query(
    `SELECT * FROM behavior_definition WHERE workspace = $ws ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  )) as Array<BehaviorDefinitionRecord[]>;
  return rows[0] ?? [];
}

/**
 * Retrieves behavior records for an identity, optionally filtered by metric type.
 */
export async function getBehaviorRecords(
  surreal: Surreal,
  identityId: string,
  metricType?: string,
): Promise<BehaviorRecord[]> {
  const identityRecord = new RecordId("identity", identityId);

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
 * Retrieves observations in a workspace, optionally filtered by source agent.
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
  const workspaceRecord = new RecordId("workspace", workspaceId);

  if (opts?.sourceAgent) {
    const rows = (await surreal.query(
      `SELECT * FROM observation WHERE workspace = $ws AND source_agent = $agent ORDER BY created_at DESC;`,
      { ws: workspaceRecord, agent: opts.sourceAgent },
    )) as Array<Array<{
      id: RecordId;
      text: string;
      severity: string;
      status: string;
      source_agent: string;
    }>>;
    return rows[0] ?? [];
  }

  const rows = (await surreal.query(
    `SELECT * FROM observation WHERE workspace = $ws ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  )) as Array<Array<{
    id: RecordId;
    text: string;
    severity: string;
    status: string;
    source_agent: string;
  }>>;
  return rows[0] ?? [];
}


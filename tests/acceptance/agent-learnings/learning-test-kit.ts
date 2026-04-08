/**
 * Agent Learnings Acceptance Test Kit
 *
 * Extends the shared acceptance-test-kit with learning-specific helpers.
 * All helpers use business language -- no technical jargon in function names.
 *
 * Driving ports:
 *   POST   /api/workspaces/:workspaceId/learnings                     (create learning)
 *   GET    /api/workspaces/:workspaceId/learnings                     (list learnings)
 *   POST   /api/workspaces/:workspaceId/learnings/:learningId/actions (status transitions)
 *   SurrealDB direct queries                                         (verification of outcomes)
 */
import { RecordId, type Surreal } from "surrealdb";
import {
  createWorkspaceDirectly,
  createDecisionDirectly,
  type DirectWorkspaceResult,
} from "../shared-fixtures";

// ---------------------------------------------------------------------------
// Re-exports from shared kit
// ---------------------------------------------------------------------------

export {
  setupAcceptanceSuite,
  createTestUser,
  createTestUserWithMcp,
  fetchJson,
  fetchRaw,
  type AcceptanceTestRuntime,
  type TestUser,
  type TestUserWithMcp,
} from "../acceptance-test-kit";

import {
  setupAcceptanceSuite,
  fetchJson,
  fetchRaw,
  type AcceptanceTestRuntime,
  type TestUser,
} from "../acceptance-test-kit";

// ---------------------------------------------------------------------------
// Learning Domain Types
// ---------------------------------------------------------------------------

export type LearningType = "constraint" | "instruction" | "precedent";

export type LearningStatus =
  | "active"
  | "pending_approval"
  | "dismissed"
  | "superseded"
  | "deactivated";

export type LearningSource = "human" | "agent";

export type LearningPriority = "low" | "medium" | "high";

export type LearningRecord = {
  id: RecordId<"learning">;
  text: string;
  learning_type: LearningType;
  status: LearningStatus;
  source: LearningSource;
  priority: LearningPriority;
  target_agents: string[];
  workspace: RecordId<"workspace">;
  suggested_by?: string;
  pattern_confidence?: number;
  created_by?: RecordId<"identity">;
  created_at: string;
  updated_at?: string;
  approved_by?: RecordId<"identity">;
  approved_at?: string;
  activated_at?: string;
  dismissed_by?: RecordId<"identity">;
  dismissed_at?: string;
  dismissed_reason?: string;
  deactivated_by?: RecordId<"identity">;
  deactivated_at?: string;
};

export type CreateLearningInput = {
  text: string;
  learning_type: LearningType;
  priority?: LearningPriority;
  target_agents?: string[];
};

export type LearningActionInput = {
  action: "approve" | "dismiss" | "deactivate" | "supersede";
  reason?: string;
  new_text?: string;
};

// ---------------------------------------------------------------------------
// Suite Setup
// ---------------------------------------------------------------------------

/**
 * Sets up a learning acceptance test suite with an isolated server + DB.
 */
export function setupLearningSuite(
  suiteName: string,
): () => AcceptanceTestRuntime {
  return setupAcceptanceSuite(suiteName);
}

// ---------------------------------------------------------------------------
// Domain Helpers -- Business Language Layer
// ---------------------------------------------------------------------------

/**
 * Creates a workspace and identity directly in SurrealDB for learning tests.
 * Returns workspace ID and identity ID for use in test scenarios.
 */
export async function createTestWorkspace(
  surreal: Surreal,
  suffix: string,
): Promise<{ workspaceId: string; identityId: string }> {
  const result = await createWorkspaceDirectly(surreal, suffix, {
    workspaceName: `Learning Test Workspace ${suffix}`,
  });
  return { workspaceId: result.workspaceId, identityId: result.identityId };
}

/**
 * Creates a learning record directly in SurrealDB.
 * Used as a Given-step to seed learning state for test scenarios.
 */
export async function createTestLearning(
  surreal: Surreal,
  workspaceId: string,
  overrides: Partial<{
    text: string;
    learning_type: LearningType;
    status: LearningStatus;
    source: LearningSource;
    priority: LearningPriority;
    target_agents: string[];
    suggested_by: string;
    pattern_confidence: number;
    created_by: string;
  }> = {},
): Promise<{ learningId: string; learningRecord: RecordId<"learning"> }> {
  const learningId = `learning-${crypto.randomUUID()}`;
  const learningRecord = new RecordId("learning", learningId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const content: Record<string, unknown> = {
    text: overrides.text ?? "Default test learning text",
    learning_type: overrides.learning_type ?? "instruction",
    status: overrides.status ?? "active",
    source: overrides.source ?? "human",
    priority: overrides.priority ?? "medium",
    target_agents: overrides.target_agents ?? [],
    workspace: workspaceRecord,
    created_at: new Date(),
  };

  if (overrides.suggested_by !== undefined) {
    content.suggested_by = overrides.suggested_by;
  }
  if (overrides.pattern_confidence !== undefined) {
    content.pattern_confidence = overrides.pattern_confidence;
  }
  if (overrides.created_by !== undefined) {
    content.created_by = new RecordId("identity", overrides.created_by);
  }
  if (overrides.status === "active") {
    content.activated_at = new Date();
  }

  await surreal.query(`CREATE $learning CONTENT $content;`, {
    learning: learningRecord,
    content,
  });

  return { learningId, learningRecord };
}

/**
 * Queries active learnings for a workspace, optionally filtered by agent type.
 */
export async function listActiveLearnings(
  surreal: Surreal,
  workspaceId: string,
  agentType?: string,
): Promise<LearningRecord[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  if (agentType) {
    const rows = (await surreal.query(
      `SELECT * FROM learning
       WHERE workspace = $ws
         AND status = "active"
         AND (array::len(target_agents) = 0 OR $agentType IN target_agents)
       ORDER BY created_at DESC;`,
      { ws: workspaceRecord, agentType },
    )) as Array<LearningRecord[]>;
    return rows[0] ?? [];
  }

  const rows = (await surreal.query(
    `SELECT * FROM learning WHERE workspace = $ws AND status = "active" ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  )) as Array<LearningRecord[]>;
  return rows[0] ?? [];
}

/**
 * Queries all learnings for a workspace, optionally filtered by status.
 */
export async function listLearningsByStatus(
  surreal: Surreal,
  workspaceId: string,
  status: LearningStatus,
): Promise<LearningRecord[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const rows = (await surreal.query(
    `SELECT * FROM learning WHERE workspace = $ws AND status = $status ORDER BY created_at DESC;`,
    { ws: workspaceRecord, status },
  )) as Array<LearningRecord[]>;
  return rows[0] ?? [];
}

/**
 * Creates a policy record for collision detection tests.
 */
export async function createTestPolicy(
  surreal: Surreal,
  workspaceId: string,
  overrides: Partial<{
    name: string;
    description: string;
    rules: Array<Record<string, unknown>>;
  }> = {},
): Promise<{ policyId: string }> {
  const policyId = `policy-${crypto.randomUUID()}`;
  const policyRecord = new RecordId("policy", policyId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const identityId = crypto.randomUUID();
  const identityRecord = new RecordId("identity", identityId);
  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: identityRecord,
    content: {
      name: "Policy Creator",
      type: "human",
      identity_status: "active",
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  await surreal.query(`CREATE $policy CONTENT $content;`, {
    policy: policyRecord,
    content: {
      title: overrides.name ?? "Test Policy",
      description: overrides.description ?? "A test policy for collision detection",
      version: 1,
      status: "active",
      selector: {},
      rules: overrides.rules ?? [],
      rego_source: "package osabio.policy\ndefault allow = true",
      human_veto_required: false,
      created_by: identityRecord,
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  return { policyId };
}

/**
 * Creates a decision record for collision detection tests.
 */
export async function createTestDecision(
  surreal: Surreal,
  workspaceId: string,
  overrides: Partial<{
    summary: string;
    rationale: string;
    status: string;
  }> = {},
): Promise<{ decisionId: string }> {
  const result = await createDecisionDirectly(surreal, workspaceId, {
    summary: overrides.summary ?? "Test decision for collision detection",
    rationale: overrides.rationale ?? "Decided for testing purposes",
    status: overrides.status,
  });
  return { decisionId: result.decisionId };
}

/**
 * Gets a learning record by ID from SurrealDB.
 */
export async function getLearningById(
  surreal: Surreal,
  learningId: string,
): Promise<LearningRecord | undefined> {
  const learningRecord = new RecordId("learning", learningId);
  const rows = (await surreal.query(
    `SELECT * FROM $learning;`,
    { learning: learningRecord },
  )) as Array<LearningRecord[]>;
  return rows[0]?.[0];
}

/**
 * Creates a learning via the HTTP endpoint (driving port).
 */
export async function createLearningViaHttp(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  input: CreateLearningInput,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/learnings`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify(input),
    },
  );
}

/**
 * Lists learnings via the HTTP endpoint (driving port).
 */
export async function listLearningsViaHttp(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  params?: { status?: string; type?: string; agent?: string },
): Promise<Response> {
  const url = new URL(`${baseUrl}/api/workspaces/${workspaceId}/learnings`);
  if (params?.status) url.searchParams.set("status", params.status);
  if (params?.type) url.searchParams.set("type", params.type);
  if (params?.agent) url.searchParams.set("agent", params.agent);

  return fetchRaw(url.toString(), {
    method: "GET",
    headers: user.headers,
  });
}

/**
 * Performs a status transition action on a learning via HTTP (driving port).
 */
export async function performLearningAction(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  learningId: string,
  action: LearningActionInput,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/learnings/${learningId}/actions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify(action),
    },
  );
}

/**
 * Checks whether evidence edges exist for a learning.
 */
export async function getLearningEvidence(
  surreal: Surreal,
  learningId: string,
): Promise<Array<{ id: RecordId; out: RecordId }>> {
  const learningRecord = new RecordId("learning", learningId);
  const rows = (await surreal.query(
    `SELECT id, out FROM learning_evidence WHERE in = $learning;`,
    { learning: learningRecord },
  )) as Array<Array<{ id: RecordId; out: RecordId }>>;
  return rows[0] ?? [];
}

/**
 * Checks whether a supersedes edge exists between two learnings.
 */
export async function getSupersessionEdge(
  surreal: Surreal,
  newLearningId: string,
  oldLearningId: string,
): Promise<boolean> {
  const newRecord = new RecordId("learning", newLearningId);
  const oldRecord = new RecordId("learning", oldLearningId);
  const rows = (await surreal.query(
    `SELECT id FROM supersedes WHERE in = $new AND out = $old;`,
    { new: newRecord, old: oldRecord },
  )) as Array<Array<{ id: RecordId }>>;
  return (rows[0]?.length ?? 0) > 0;
}


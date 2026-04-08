/**
 * Skill Acceptance Test Kit
 *
 * Extends the shared acceptance-test-kit with skill-specific helpers.
 * All helpers use business language -- no technical jargon in function names.
 *
 * Driving ports:
 *   POST   /api/workspaces/:wsId/skills                        (create skill)
 *   GET    /api/workspaces/:wsId/skills                        (list skills)
 *   GET    /api/workspaces/:wsId/skills/:skillId               (skill detail)
 *   PUT    /api/workspaces/:wsId/skills/:skillId               (update skill)
 *   DELETE /api/workspaces/:wsId/skills/:skillId               (delete skill)
 *   POST   /api/workspaces/:wsId/skills/:skillId/activate      (activate)
 *   POST   /api/workspaces/:wsId/skills/:skillId/deprecate     (deprecate)
 *   POST   /api/workspaces/:wsId/agents                        (create agent)
 *   GET    /api/workspaces/:wsId/agents/:agentId               (agent detail)
 *   SurrealDB direct queries                                   (verification)
 */
import { RecordId, type Surreal } from "surrealdb";
import {
  createWorkspaceDirectly,
  type DirectWorkspaceResult,
} from "../shared-fixtures";

// ---------------------------------------------------------------------------
// Re-exports from shared kit
// ---------------------------------------------------------------------------

export {
  setupAcceptanceSuite,
  createTestUser,
  fetchJson,
  fetchRaw,
  type AcceptanceTestRuntime,
  type TestUser,
} from "../acceptance-test-kit";

import {
  setupAcceptanceSuite,
  type AcceptanceTestRuntime,
  type TestUser,
} from "../acceptance-test-kit";

// ---------------------------------------------------------------------------
// Skill Domain Types
// ---------------------------------------------------------------------------

export type SkillStatus = "draft" | "active" | "deprecated";
export type SkillSourceType = "github" | "git";

export type SkillSource = {
  readonly type: SkillSourceType;
  readonly source: string;
  readonly ref?: string;
  readonly subpath?: string;
  readonly skills?: string[];
};

export type CreateSkillInput = {
  name: string;
  description: string;
  version: string;
  source: SkillSource;
  required_tool_ids?: string[];
};

export type SkillListItem = {
  id: string;
  name: string;
  description: string;
  version: string;
  status: SkillStatus;
  source: SkillSource;
  required_tools: Array<{ id: string; name: string }>;
  agent_count: number;
  created_at: string;
};

export type SkillDetailResponse = {
  skill: SkillListItem & {
    created_by?: string;
    updated_at?: string;
  };
  required_tools: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
  governed_by: Array<{ id: string; name: string; status: string }>;
};

// ---------------------------------------------------------------------------
// Suite Setup
// ---------------------------------------------------------------------------

export function setupSkillSuite(suiteName: string) {
  return setupAcceptanceSuite(`skill_${suiteName}`);
}

// ---------------------------------------------------------------------------
// Workspace + Skill Helpers
// ---------------------------------------------------------------------------

export async function createTestWorkspace(
  surreal: Surreal,
  suffix: string,
): Promise<DirectWorkspaceResult> {
  return createWorkspaceDirectly(surreal, `skill-${suffix}`);
}

/**
 * Link a test user's person record to the workspace's identity via
 * identity_person edge. Required for session-based identity resolution
 * in browser-facing routes.
 */
export async function linkUserToWorkspaceIdentity(
  baseUrl: string,
  surreal: Surreal,
  user: TestUser,
  workspace: DirectWorkspaceResult,
): Promise<void> {
  // Resolve person ID from session
  const sessionResponse = await fetch(`${baseUrl}/api/auth/get-session`, {
    headers: user.headers,
  });
  const session = (await sessionResponse.json()) as { user?: { id?: string } };
  const personId = session?.user?.id;
  if (!personId) throw new Error("Could not resolve person ID from session");

  const personRecord = new RecordId("person", personId);

  // Remove existing identity_person edges for this person
  await surreal.query(
    `DELETE identity_person WHERE out = $person;`,
    { person: personRecord },
  );

  // Create new edge from workspace identity to person
  await surreal.query(
    `RELATE $identity->identity_person->$person SET added_at = time::now();`,
    { identity: workspace.identityRecord, person: personRecord },
  );
}

// ---------------------------------------------------------------------------
// MCP Tool Seed Helpers (for skill_requires edges)
// ---------------------------------------------------------------------------

export type SeededTool = {
  id: string;
  name: string;
  record: RecordId<"mcp_tool">;
};

/**
 * Create mcp_tool records in the workspace for testing skill_requires edges.
 */
export async function seedMcpTools(
  surreal: Surreal,
  workspaceId: string,
  toolNames: string[],
): Promise<SeededTool[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const tools: SeededTool[] = [];

  for (const name of toolNames) {
    const toolId = crypto.randomUUID();
    const toolRecord = new RecordId("mcp_tool", toolId);

    await surreal.query(`CREATE $tool CONTENT $content;`, {
      tool: toolRecord,
      content: {
        name,
        toolkit: "test-toolkit",
        description: `Test tool: ${name}`,
        workspace: workspaceRecord,
        input_schema: { type: "object", properties: {} },
        risk_level: "low",
        status: "active",
        created_at: new Date(),
      },
    });

    tools.push({ id: toolId, name, record: toolRecord });
  }

  return tools;
}

// ---------------------------------------------------------------------------
// Policy Seed Helpers
// ---------------------------------------------------------------------------

export type SeededPolicy = {
  id: string;
  name: string;
  record: RecordId<"policy">;
};

/**
 * Create a policy record for testing governs_skill relations.
 */
export async function seedPolicy(
  surreal: Surreal,
  workspaceId: string,
  name: string,
): Promise<SeededPolicy> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const policyId = crypto.randomUUID();
  const policyRecord = new RecordId("policy", policyId);

  // Resolve an identity in this workspace for the required created_by field
  const [identityRows] = await surreal.query<[Array<{ id: RecordId<"identity"> }>]>(
    `SELECT id FROM identity WHERE workspace = $ws LIMIT 1;`,
    { ws: workspaceRecord },
  );
  const createdBy = identityRows[0]?.id ?? new RecordId("identity", crypto.randomUUID());

  await surreal.query(`CREATE $policy CONTENT $content;`, {
    policy: policyRecord,
    content: {
      title: name,
      description: `Test policy: ${name}`,
      status: "active",
      workspace: workspaceRecord,
      selector: {},
      rules: [],
      rego_source: "package osabio.policy\ndefault allow = true",
      version: 1,
      created_by: createdBy,
      created_at: new Date(),
    },
  });

  return { id: policyId, name, record: policyRecord };
}

/**
 * Create a governs_skill relation between a policy and a skill.
 */
export async function linkPolicyToSkill(
  surreal: Surreal,
  policyId: string,
  skillId: string,
): Promise<void> {
  const policyRecord = new RecordId("policy", policyId);
  const skillRecord = new RecordId("skill", skillId);

  await surreal.query(
    `RELATE $policy->governs_skill->$skill SET created_at = time::now();`,
    { policy: policyRecord, skill: skillRecord },
  );
}

// ---------------------------------------------------------------------------
// Skill API Helpers (driving ports)
// ---------------------------------------------------------------------------

/**
 * Create a skill via HTTP API.
 */
export async function createSkillViaHttp(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  input: CreateSkillInput,
): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${workspaceId}/skills`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...user.headers },
    body: JSON.stringify(input),
  });
}

/**
 * List skills via HTTP API.
 */
export async function listSkillsViaHttp(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  statusFilter?: SkillStatus,
): Promise<Response> {
  const url = statusFilter
    ? `${baseUrl}/api/workspaces/${workspaceId}/skills?status=${statusFilter}`
    : `${baseUrl}/api/workspaces/${workspaceId}/skills`;

  return fetch(url, {
    method: "GET",
    headers: { ...user.headers },
  });
}

/**
 * Get skill detail via HTTP API.
 */
export async function getSkillDetailViaHttp(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  skillId: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${workspaceId}/skills/${skillId}`, {
    method: "GET",
    headers: { ...user.headers },
  });
}

/**
 * Update skill via HTTP API.
 */
export async function updateSkillViaHttp(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  skillId: string,
  updates: Partial<CreateSkillInput>,
): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${workspaceId}/skills/${skillId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...user.headers },
    body: JSON.stringify(updates),
  });
}

/**
 * Delete skill via HTTP API.
 */
export async function deleteSkillViaHttp(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  skillId: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${workspaceId}/skills/${skillId}`, {
    method: "DELETE",
    headers: { ...user.headers },
  });
}

/**
 * Activate a draft skill via HTTP API.
 */
export async function activateSkillViaHttp(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  skillId: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${workspaceId}/skills/${skillId}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...user.headers },
  });
}

/**
 * Deprecate an active skill via HTTP API.
 */
export async function deprecateSkillViaHttp(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  skillId: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${workspaceId}/skills/${skillId}/deprecate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...user.headers },
  });
}

// ---------------------------------------------------------------------------
// Agent API Helpers (driving ports)
// ---------------------------------------------------------------------------

export type CreateAgentWithSkillsInput = {
  name: string;
  description?: string;
  runtime: "sandbox" | "external";
  model?: string;
  skill_ids?: string[];
  additional_tool_ids?: string[];
  authority_scopes?: Array<{ action: string; permission: string }>;
};

/**
 * Create an agent with optional skills and tools via HTTP API.
 */
export async function createAgentViaHttp(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  input: CreateAgentWithSkillsInput,
): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${workspaceId}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...user.headers },
    body: JSON.stringify(input),
  });
}

/**
 * Get agent detail via HTTP API.
 */
export async function getAgentDetailViaHttp(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  agentId: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${workspaceId}/agents/${agentId}`, {
    method: "GET",
    headers: { ...user.headers },
  });
}

// ---------------------------------------------------------------------------
// DB Verification Helpers (not driving ports -- used for Then assertions)
// ---------------------------------------------------------------------------

/**
 * Count possesses edges for an agent identity.
 */
export async function countPossessesEdges(
  surreal: Surreal,
  identityId: string,
): Promise<number> {
  const identityRecord = new RecordId("identity", identityId);
  const [rows] = await surreal.query<[Array<{ count: number }>]>(
    `SELECT count() AS count FROM possesses WHERE in = $identity GROUP ALL;`,
    { identity: identityRecord },
  );
  return rows[0]?.count ?? 0;
}

/**
 * Count can_use edges for an agent identity.
 */
export async function countCanUseEdges(
  surreal: Surreal,
  identityId: string,
): Promise<number> {
  const identityRecord = new RecordId("identity", identityId);
  const [rows] = await surreal.query<[Array<{ count: number }>]>(
    `SELECT count() AS count FROM can_use WHERE in = $identity GROUP ALL;`,
    { identity: identityRecord },
  );
  return rows[0]?.count ?? 0;
}

/**
 * Count skill_requires edges for a skill.
 */
export async function countSkillRequiresEdges(
  surreal: Surreal,
  skillId: string,
): Promise<number> {
  const skillRecord = new RecordId("skill", skillId);
  const [rows] = await surreal.query<[Array<{ count: number }>]>(
    `SELECT count() AS count FROM skill_requires WHERE in = $skill GROUP ALL;`,
    { skill: skillRecord },
  );
  return rows[0]?.count ?? 0;
}

/**
 * Get skill record directly from DB for verification.
 */
export async function getSkillFromDb(
  surreal: Surreal,
  skillId: string,
): Promise<Record<string, unknown> | undefined> {
  const skillRecord = new RecordId("skill", skillId);
  const [rows] = await surreal.query<[Array<Record<string, unknown>>]>(
    `SELECT * FROM $skill;`,
    { skill: skillRecord },
  );
  return rows[0];
}

/**
 * Resolve skill-derived tools for an identity via graph traversal.
 * Follows: identity -> possesses -> skill -> skill_requires -> mcp_tool
 */
export async function resolveSkillDerivedTools(
  surreal: Surreal,
  identityId: string,
): Promise<Array<{ tool_id: string; tool_name: string; skill_name: string }>> {
  const identityRecord = new RecordId("identity", identityId);
  const [rows] = await surreal.query<[Array<{
    tool_id: RecordId;
    tool_name: string;
    skill_name: string;
  }>]>(
    `SELECT
       out.id AS tool_id,
       out.name AS tool_name,
       in.name AS skill_name
     FROM skill_requires
     WHERE in IN (SELECT VALUE out FROM possesses WHERE in = $identity AND out.status = "active");`,
    { identity: identityRecord },
  );
  return rows.map((r) => ({
    tool_id: r.tool_id.id as string,
    tool_name: r.tool_name,
    skill_name: r.skill_name,
  }));
}

// ---------------------------------------------------------------------------
// Test Data Factories
// ---------------------------------------------------------------------------

/**
 * Create a standard GitHub-sourced skill input for testing.
 */
export function makeSkillInput(
  overrides?: Partial<CreateSkillInput>,
): CreateSkillInput {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    name: `test-skill-${suffix}`,
    description: "A test skill for acceptance testing",
    version: "1.0",
    source: {
      type: "github",
      source: "acme-corp/agent-skills",
      ref: "v1.0",
      subpath: `skills/test-${suffix}`,
    },
    ...overrides,
  };
}

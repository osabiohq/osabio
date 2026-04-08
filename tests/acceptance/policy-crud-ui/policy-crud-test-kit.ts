/**
 * Policy CRUD UI Acceptance Test Kit
 *
 * Extends policy-test-kit with HTTP API helpers for testing the
 * Policy CRUD endpoints. Tests invoke through the driving ports
 * (HTTP API endpoints) exclusively.
 *
 * Driving ports:
 *   GET    /api/workspaces/:wsId/policies
 *   GET    /api/workspaces/:wsId/policies/:id
 *   GET    /api/workspaces/:wsId/policies/:id/versions
 *   POST   /api/workspaces/:wsId/policies
 *   PATCH  /api/workspaces/:wsId/policies/:id/activate
 *   PATCH  /api/workspaces/:wsId/policies/:id/deprecate
 *   POST   /api/workspaces/:wsId/policies/:id/versions
 */
import { RecordId, type Surreal } from "surrealdb";

// Re-export everything from policy-test-kit
export {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createTestIdentity,
  createPolicy,
  activatePolicy,
  deprecatePolicy,
  getPolicyRecord,
  loadActivePoliciesForIdentity,
  simulatePolicyGateResult,
  createPolicyAuditEvent,
  createPolicyVersion,
  createDraftIntent,
  submitIntent,
  getIntentStatus,
  getIntentRecord,
  getIntentEvaluation,
  fetchJson,
  fetchRaw,
  type PolicyRecord,
  type PolicyRule,
  type PolicyStatus,
  type PolicySelector,
  type RulePredicate,
  type RuleCondition,
  type CreatePolicyOptions,
  type PolicyTraceEntry,
  type OrchestratorTestRuntime,
  type TestUser,
  type TestWorkspace,
} from "../policy-node/policy-test-kit";

export {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  type TestUserWithMcp,
  type AcceptanceTestRuntime,
} from "../acceptance-test-kit";

// ---------------------------------------------------------------------------
// Policy CRUD API Types (wire format)
// ---------------------------------------------------------------------------

export type PolicyListItem = {
  id: string;
  title: string;
  status: string;
  version: number;
  rules_count: number;
  human_veto_required: boolean;
  created_at: string;
  updated_at?: string;
};

export type PolicyListResponse = {
  policies: PolicyListItem[];
};

export type PolicyEdgeInfo = {
  governing: Array<{ identity_id: string; created_at: string }>;
  protects: Array<{ workspace_id: string; created_at: string }>;
};

export type PolicyVersionChainItem = {
  id: string;
  version: number;
  status: string;
  created_at: string;
};

export type PolicyDetailResponse = {
  policy: {
    id: string;
    title: string;
    description: string;
    version: number;
    status: string;
    selector: {
      workspace?: string;
      agent_role?: string;
      resource?: string;
    };
    rego_source: string;
    human_veto_required: boolean;
    max_ttl?: string;
    supersedes?: string;
    created_at: string;
    updated_at?: string;
  };
  edges: PolicyEdgeInfo;
  version_chain: PolicyVersionChainItem[];
};

export type PolicyCreateBody = {
  title: string;
  description: string;
  selector?: {
    workspace?: string;
    agent_role?: string;
    resource?: string;
  };
  rego_source: string;
  human_veto_required?: boolean;
  max_ttl?: string;
};

// ---------------------------------------------------------------------------
// HTTP API Helpers -- Business Language Layer
// ---------------------------------------------------------------------------

/**
 * Lists policies in a workspace, optionally filtered by status.
 * Exercises: GET /api/workspaces/:wsId/policies
 */
export async function listPolicies(
  baseUrl: string,
  headers: Record<string, string>,
  workspaceId: string,
  statusFilter?: string,
): Promise<Response> {
  const url = new URL(`${baseUrl}/api/workspaces/${workspaceId}/policies`);
  if (statusFilter) url.searchParams.set("status", statusFilter);

  return fetch(url.toString(), {
    method: "GET",
    headers: { ...headers },
  });
}

/**
 * Gets a single policy with edges and version chain.
 * Exercises: GET /api/workspaces/:wsId/policies/:id
 */
export async function getPolicyDetail(
  baseUrl: string,
  headers: Record<string, string>,
  workspaceId: string,
  policyId: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${workspaceId}/policies/${policyId}`, {
    method: "GET",
    headers: { ...headers },
  });
}

/**
 * Creates a new draft policy.
 * Exercises: POST /api/workspaces/:wsId/policies
 */
export async function createPolicyViaApi(
  baseUrl: string,
  headers: Record<string, string>,
  workspaceId: string,
  body: PolicyCreateBody,
): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${workspaceId}/policies`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/**
 * Activates a draft or testing policy.
 * Exercises: PATCH /api/workspaces/:wsId/policies/:id/activate
 */
export async function activatePolicyViaApi(
  baseUrl: string,
  headers: Record<string, string>,
  workspaceId: string,
  policyId: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${workspaceId}/policies/${policyId}/activate`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/**
 * Deprecates an active policy.
 * Exercises: PATCH /api/workspaces/:wsId/policies/:id/deprecate
 */
export async function deprecatePolicyViaApi(
  baseUrl: string,
  headers: Record<string, string>,
  workspaceId: string,
  policyId: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${workspaceId}/policies/${policyId}/deprecate`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/**
 * Creates a new version of an active policy.
 * Exercises: POST /api/workspaces/:wsId/policies/:id/versions
 */
export async function createPolicyVersionViaApi(
  baseUrl: string,
  headers: Record<string, string>,
  workspaceId: string,
  policyId: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${workspaceId}/policies/${policyId}/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/**
 * Gets the version history for a policy.
 * Exercises: GET /api/workspaces/:wsId/policies/:id/versions
 */
export async function getVersionHistory(
  baseUrl: string,
  headers: Record<string, string>,
  workspaceId: string,
  policyId: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${workspaceId}/policies/${policyId}/versions`, {
    method: "GET",
    headers: { ...headers },
  });
}

// ---------------------------------------------------------------------------
// Identity Setup Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a human identity with member_of edge for a workspace.
 * Returns headers that include session auth for the workspace.
 */
export async function createHumanIdentityInWorkspace(
  surreal: Surreal,
  name: string,
  workspaceId: string,
): Promise<string> {
  const identityId = `id-human-${crypto.randomUUID()}`;
  const identityRecord = new RecordId("identity", identityId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: identityRecord,
    content: {
      name,
      type: "human",
      workspace: workspaceRecord,
      identity_status: "active",
      created_at: new Date(),
    },
  });

  await surreal.query(`RELATE $identity->member_of->$workspace SET added_at = time::now();`, {
    identity: identityRecord,
    workspace: workspaceRecord,
  });

  return identityId;
}

/**
 * Creates an agent identity with member_of edge for a workspace.
 */
export async function createAgentIdentityInWorkspace(
  surreal: Surreal,
  name: string,
  workspaceId: string,
): Promise<string> {
  const identityId = `id-agent-${crypto.randomUUID()}`;
  const identityRecord = new RecordId("identity", identityId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: identityRecord,
    content: {
      name,
      type: "agent",
      workspace: workspaceRecord,
      identity_status: "active",
      created_at: new Date(),
    },
  });

  await surreal.query(`RELATE $identity->member_of->$workspace SET added_at = time::now();`, {
    identity: identityRecord,
    workspace: workspaceRecord,
  });

  return identityId;
}

// ---------------------------------------------------------------------------
// Identity Linkage Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the person record for a session user by calling the auth session
 * endpoint, then replaces the identity_person edge so the user resolves to
 * the given identity. Used to make a session user appear as an agent identity.
 */
export async function linkUserToIdentity(
  baseUrl: string,
  surreal: Surreal,
  user: { headers: Record<string, string> },
  identityId: string,
): Promise<void> {
  // Resolve person ID from session
  const sessionResponse = await fetch(`${baseUrl}/api/auth/get-session`, {
    headers: user.headers,
  });
  const session = (await sessionResponse.json()) as { user?: { id?: string } };
  const personId = session?.user?.id;
  if (!personId) throw new Error("Could not resolve person ID from session");

  const personRecord = new RecordId("person", personId);
  const identityRecord = new RecordId("identity", identityId);

  // Remove existing identity_person edges for this person
  await surreal.query(
    `DELETE identity_person WHERE out = $person;`,
    { person: personRecord },
  );

  // Create new edge from target identity to person
  await surreal.query(
    `RELATE $identity->identity_person->$person SET added_at = time::now();`,
    { identity: identityRecord, person: personRecord },
  );
}

// ---------------------------------------------------------------------------
// Common Test Data Builders
// ---------------------------------------------------------------------------

/** Default Rego source for test policies. */
export const DEFAULT_REGO_SOURCE = 'package osabio.policy\ndefault allow = true';

/** A valid policy creation body with Rego source. */
export function buildPolicyBody(overrides?: Partial<PolicyCreateBody>): PolicyCreateBody {
  return {
    title: `Test Policy ${crypto.randomUUID().slice(0, 8)}`,
    description: "Test policy description for automated testing",
    rego_source: DEFAULT_REGO_SOURCE,
    ...overrides,
  };
}

/**
 * Milestone 1: Authorization Gate + Policy List
 *
 * Traces: US-PCUI-08 (Agent Authorization), US-PCUI-01 (Policy List View)
 *
 * Validates that agent identities are restricted to read-only access
 * while human identities have full CRUD, and that the policy list
 * endpoint returns workspace policies with status filtering.
 *
 * Driving ports:
 *   GET    /api/workspaces/:wsId/policies
 *   POST   /api/workspaces/:wsId/policies
 *   PATCH  /api/workspaces/:wsId/policies/:id/activate
 *   PATCH  /api/workspaces/:wsId/policies/:id/deprecate
 *   POST   /api/workspaces/:wsId/policies/:id/versions
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createTestUser,
  createTestWorkspace,
  createTestIdentity,
  createPolicy,
  activatePolicy,
  listPolicies,
  createPolicyViaApi,
  activatePolicyViaApi,
  deprecatePolicyViaApi,
  createPolicyVersionViaApi,
  getPolicyDetail,
  buildPolicyBody,
  DEFAULT_REGO_SOURCE,
  linkUserToIdentity,
  type PolicyListResponse,
} from "./policy-crud-test-kit";

const getRuntime = setupAcceptanceSuite("policy_crud_m1_auth_list");

// =============================================================================
// US-PCUI-08: Agent Authorization
// =============================================================================

describe("Milestone 1: Agent Authorization Gate (US-PCUI-08)", () => {

  // ---------------------------------------------------------------------------
  // Agent identity is denied policy creation
  // AC: Agent identities receive 403 on POST /policies
  // ---------------------------------------------------------------------------
  it("agent identity is denied when attempting to create a policy", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent identity linked to the session user
    const user = await createTestUser(baseUrl, "m1-agent-create");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);
    await linkUserToIdentity(baseUrl, surreal, user, agentId);

    // When the agent attempts to create a policy
    const response = await createPolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      buildPolicyBody({ title: "Agent Attempted Policy" }),
    );

    // Then the request is rejected with 403
    expect(response.status).toBe(403);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("agents cannot modify policies");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Agent identity is denied policy activation
  // AC: Agent identities receive 403 on PATCH /policies/:id/activate
  // ---------------------------------------------------------------------------
  it("agent identity is denied when attempting to activate a policy", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a draft policy in the workspace and an agent-linked session user
    const user = await createTestUser(baseUrl, "m1-agent-activate");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);
    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Draft Policy",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);
    await linkUserToIdentity(baseUrl, surreal, user, agentId);

    // When the agent attempts to activate the policy
    const response = await activatePolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      policyId,
    );

    // Then the request is rejected with 403
    expect(response.status).toBe(403);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Agent identity is denied policy deprecation
  // AC: Agent identities receive 403 on PATCH /policies/:id/deprecate
  // ---------------------------------------------------------------------------
  it("agent identity is denied when attempting to deprecate a policy", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active policy in the workspace and an agent-linked session user
    const user = await createTestUser(baseUrl, "m1-agent-deprecate");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);
    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Active Policy",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);
    await linkUserToIdentity(baseUrl, surreal, user, agentId);

    // When the agent attempts to deprecate the policy
    const response = await deprecatePolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      policyId,
    );

    // Then the request is rejected with 403
    expect(response.status).toBe(403);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Agent identity is denied version creation
  // AC: Agent identities receive 403 on POST /policies/:id/versions
  // ---------------------------------------------------------------------------
  it("agent identity is denied when attempting to create a policy version", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active policy in the workspace and an agent-linked session user
    const user = await createTestUser(baseUrl, "m1-agent-version");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);
    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Active Policy for Version",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);
    await linkUserToIdentity(baseUrl, surreal, user, agentId);

    // When the agent attempts to create a new version
    const response = await createPolicyVersionViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      policyId,
    );

    // Then the request is rejected with 403
    expect(response.status).toBe(403);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Agent identity can read the policy list
  // AC: Agent identities receive 200 on GET /policies
  // ---------------------------------------------------------------------------
  it("agent identity can read the policy list", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a policy and an agent-linked session user
    const user = await createTestUser(baseUrl, "m1-agent-read-list");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);
    await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Readable Policy",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);
    await linkUserToIdentity(baseUrl, surreal, user, agentId);

    // When the agent requests the policy list
    const response = await listPolicies(baseUrl, user.headers, workspace.workspaceId);

    // Then the list is returned successfully
    expect(response.status).toBe(200);
    const body = await response.json() as PolicyListResponse;
    expect(body.policies.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Agent identity can read policy details
  // AC: Agent identities receive 200 on GET /policies/:id
  // ---------------------------------------------------------------------------
  it("agent identity can read policy details", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a draft policy in the workspace and an agent-linked session user
    const user = await createTestUser(baseUrl, "m1-agent-read-detail");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);
    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Detail Readable Policy",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);
    await linkUserToIdentity(baseUrl, surreal, user, agentId);

    // When the agent requests policy details
    const response = await getPolicyDetail(baseUrl, user.headers, workspace.workspaceId, policyId);

    // Then the detail is returned successfully
    expect(response.status).toBe(200);
  }, 120_000);
});

// =============================================================================
// US-PCUI-01: Policy List View
// =============================================================================

describe("Milestone 1: Policy List View (US-PCUI-01)", () => {

  // ---------------------------------------------------------------------------
  // Walking Skeleton: Admin lists workspace policies
  // AC: Human identity sees all policies in the workspace
  // ---------------------------------------------------------------------------
  it("admin sees all policies in the workspace", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with draft and active policies
    const user = await createTestUser(baseUrl, "m1-list-all");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId: draftId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Draft Budget Guard",
      rego_source: DEFAULT_REGO_SOURCE,
    });

    const { policyId: activeId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Active Deploy Guard",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, activeId, adminId, workspace.workspaceId);

    // When admin requests the policy list
    const response = await listPolicies(baseUrl, user.headers, workspace.workspaceId);

    // Then both policies are returned with correct fields
    expect(response.status).toBe(200);
    const body = await response.json() as PolicyListResponse;
    expect(body.policies.length).toBeGreaterThanOrEqual(2);

    const ids = body.policies.map(p => p.id);
    expect(ids).toContain(draftId);
    expect(ids).toContain(activeId);

    // And each policy has the expected fields
    for (const policy of body.policies) {
      expect(policy.title).toBeDefined();
      expect(policy.status).toBeDefined();
      expect(policy.version).toBeDefined();
      expect(typeof policy.rules_count).toBe("number");
      expect(policy.created_at).toBeDefined();
    }
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Status filter returns only matching policies
  // AC: ?status=active returns only active policies
  // ---------------------------------------------------------------------------
  it("status filter returns only matching policies", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with one draft and one active policy
    const user = await createTestUser(baseUrl, "m1-filter");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Draft Policy",
      rego_source: DEFAULT_REGO_SOURCE,
    });

    const { policyId: activeId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Active Policy",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, activeId, adminId, workspace.workspaceId);

    // When admin filters by active status
    const response = await listPolicies(baseUrl, user.headers, workspace.workspaceId, "active");

    // Then only the active policy is returned
    expect(response.status).toBe(200);
    const body = await response.json() as PolicyListResponse;
    expect(body.policies.length).toBe(1);
    expect(body.policies[0].id).toBe(activeId);
    expect(body.policies[0].status).toBe("active");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Empty workspace returns empty policy list
  // AC: New workspace with no policies returns empty array
  // ---------------------------------------------------------------------------
  it("empty workspace returns empty policy list", async () => {
    const { baseUrl } = getRuntime();

    // Given a workspace with no policies
    const user = await createTestUser(baseUrl, "m1-empty");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin requests the policy list
    const response = await listPolicies(baseUrl, user.headers, workspace.workspaceId);

    // Then an empty array is returned
    expect(response.status).toBe(200);
    const body = await response.json() as PolicyListResponse;
    expect(body.policies).toEqual([]);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Status filter with no matches returns empty list
  // AC: Filtering by a status with no matching policies returns empty array
  // ---------------------------------------------------------------------------
  it("status filter with no matches returns empty list", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with only draft policies
    const user = await createTestUser(baseUrl, "m1-filter-empty");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Draft Only",
      rego_source: DEFAULT_REGO_SOURCE,
    });

    // When admin filters by deprecated status
    const response = await listPolicies(baseUrl, user.headers, workspace.workspaceId, "deprecated");

    // Then an empty array is returned
    expect(response.status).toBe(200);
    const body = await response.json() as PolicyListResponse;
    expect(body.policies).toEqual([]);
  }, 120_000);
});

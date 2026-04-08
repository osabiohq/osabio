/**
 * Milestone 3: Policy Lifecycle (Activate + Deprecate)
 *
 * Traces: US-PCUI-04 (Activate/Deprecate Policy)
 *
 * Validates the status transitions of the policy lifecycle:
 * draft -> active (creates governing/protects edges),
 * active -> deprecated (removes edges), and rejection of
 * invalid transitions.
 *
 * Driving ports:
 *   PATCH /api/workspaces/:wsId/policies/:id/activate
 *   PATCH /api/workspaces/:wsId/policies/:id/deprecate
 *   GET   /api/workspaces/:wsId/policies/:id
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupAcceptanceSuite,
  createTestUser,
  createTestWorkspace,
  createTestIdentity,
  createPolicy,
  activatePolicy,
  deprecatePolicy,
  loadActivePoliciesForIdentity,
  createPolicyViaApi,
  activatePolicyViaApi,
  deprecatePolicyViaApi,
  getPolicyDetail,
  buildPolicyBody,
  DEFAULT_REGO_SOURCE,
  type PolicyDetailResponse,
} from "./policy-crud-test-kit";

const getRuntime = setupAcceptanceSuite("policy_crud_m3_lifecycle");

// =============================================================================
// US-PCUI-04: Activate Policy
// =============================================================================

describe("Milestone 3: Policy Activation (US-PCUI-04)", () => {

  // ---------------------------------------------------------------------------
  // Walking Skeleton: Admin activates a draft policy
  // AC: Draft -> active, governing and protects edges created
  // ---------------------------------------------------------------------------
  it("admin activates a draft policy and governance edges are created", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a draft policy with one deny rule
    const user = await createTestUser(baseUrl, "m3-activate-happy");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const createResponse = await createPolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      buildPolicyBody({
        title: "Deploy Guard",
        rego_source: DEFAULT_REGO_SOURCE,
      }),
    );
    const { policy_id: policyId } = await createResponse.json() as { policy_id: string };

    // When admin activates the policy
    const response = await activatePolicyViaApi(
      baseUrl, user.headers, workspace.workspaceId, policyId,
    );

    // Then the policy status transitions to active
    expect(response.status).toBe(200);
    const body = await response.json() as { status: string };
    expect(body.status).toBe("active");

    // And the policy detail confirms active status
    const detailResponse = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, policyId,
    );
    const detail = await detailResponse.json() as PolicyDetailResponse;
    expect(detail.policy.status).toBe("active");

    // And governing and protects edges are created
    expect(detail.edges.governing.length).toBeGreaterThanOrEqual(1);
    expect(detail.edges.protects.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Cannot activate an already-active policy
  // AC: PATCH /activate on active policy returns 409
  // ---------------------------------------------------------------------------
  it("cannot activate an already-active policy", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active policy
    const user = await createTestUser(baseUrl, "m3-activate-again");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Already Active",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);

    // When admin attempts to activate it again
    const response = await activatePolicyViaApi(
      baseUrl, user.headers, workspace.workspaceId, policyId,
    );

    // Then the request is rejected
    expect(response.status).toBe(409);
    const body = await response.json() as { error: string };
    expect(body.error).toContain("draft");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Cannot activate a deprecated policy
  // AC: PATCH /activate on deprecated policy returns 409
  // ---------------------------------------------------------------------------
  it("cannot activate a deprecated policy", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a deprecated policy
    const user = await createTestUser(baseUrl, "m3-activate-deprecated");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Deprecated Policy",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);
    await deprecatePolicy(surreal, policyId);

    // When admin attempts to activate the deprecated policy
    const response = await activatePolicyViaApi(
      baseUrl, user.headers, workspace.workspaceId, policyId,
    );

    // Then the request is rejected
    expect(response.status).toBe(409);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Cannot activate a superseded policy
  // AC: PATCH /activate on superseded policy returns 409
  // ---------------------------------------------------------------------------
  it("cannot activate a superseded policy", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a superseded policy (v1 superseded by v2)
    const user = await createTestUser(baseUrl, "m3-activate-superseded");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId: v1Id } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Original Policy",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, v1Id, adminId, workspace.workspaceId);

    // Supersede v1 by creating and activating v2
    // (simulate via direct DB update to put v1 in superseded state)
    const v1Record = new RecordId("policy", v1Id);
    await surreal.query(
      `UPDATE $policy SET status = 'superseded', updated_at = time::now();`,
      { policy: v1Record },
    );

    // When admin attempts to activate the superseded v1
    const response = await activatePolicyViaApi(
      baseUrl, user.headers, workspace.workspaceId, v1Id,
    );

    // Then the request is rejected
    expect(response.status).toBe(409);
  }, 120_000);
});

// =============================================================================
// US-PCUI-04: Deprecate Policy
// =============================================================================

describe("Milestone 3: Policy Deprecation (US-PCUI-04)", () => {

  // ---------------------------------------------------------------------------
  // Admin deprecates an active policy and edges are removed
  // AC: Active -> deprecated, governing and protects edges removed
  // ---------------------------------------------------------------------------
  it("admin deprecates an active policy and governance edges are removed", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active policy with governing and protects edges
    const user = await createTestUser(baseUrl, "m3-deprecate-happy");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Policy to Deprecate",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);

    // Verify edges exist before deprecation
    const policiesBefore = await loadActivePoliciesForIdentity(surreal, adminId, workspace.workspaceId);
    expect(policiesBefore.map(p => p.id.id as string)).toContain(policyId);

    // When admin deprecates the policy
    const response = await deprecatePolicyViaApi(
      baseUrl, user.headers, workspace.workspaceId, policyId,
    );

    // Then the policy is deprecated
    expect(response.status).toBe(200);
    const body = await response.json() as { status: string };
    expect(body.status).toBe("deprecated");

    // And the detail confirms deprecated status with no edges
    const detailResponse = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, policyId,
    );
    const detail = await detailResponse.json() as PolicyDetailResponse;
    expect(detail.policy.status).toBe("deprecated");
    expect(detail.edges.governing).toHaveLength(0);
    expect(detail.edges.protects).toHaveLength(0);

    // And the policy is excluded from active policy loading
    const policiesAfter = await loadActivePoliciesForIdentity(surreal, adminId, workspace.workspaceId);
    expect(policiesAfter.map(p => p.id.id as string)).not.toContain(policyId);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Cannot deprecate a draft policy
  // AC: PATCH /deprecate on draft policy returns 409
  // ---------------------------------------------------------------------------
  it("cannot deprecate a draft policy", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a draft policy
    const user = await createTestUser(baseUrl, "m3-deprecate-draft");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Draft Cannot Deprecate",
      rego_source: DEFAULT_REGO_SOURCE,
    });

    // When admin attempts to deprecate the draft policy
    const response = await deprecatePolicyViaApi(
      baseUrl, user.headers, workspace.workspaceId, policyId,
    );

    // Then the request is rejected
    expect(response.status).toBe(409);
    const body = await response.json() as { error: string };
    expect(body.error).toContain("active");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Cannot deprecate an already-deprecated policy
  // AC: PATCH /deprecate on deprecated policy returns 409
  // ---------------------------------------------------------------------------
  it("cannot deprecate an already-deprecated policy", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a deprecated policy
    const user = await createTestUser(baseUrl, "m3-deprecate-twice");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Already Deprecated",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);
    await deprecatePolicy(surreal, policyId);

    // When admin attempts to deprecate it again
    const response = await deprecatePolicyViaApi(
      baseUrl, user.headers, workspace.workspaceId, policyId,
    );

    // Then the request is rejected
    expect(response.status).toBe(409);
  }, 120_000);
});

/**
 * Milestone 5: Version Creation + Supersede
 *
 * Traces: US-PCUI-05 (Create New Version)
 *
 * Validates that new versions can be created from active policies,
 * that version numbers increment correctly, and that activating a
 * new version atomically supersedes the old version.
 *
 * Driving ports:
 *   POST  /api/workspaces/:wsId/policies/:id/versions
 *   PATCH /api/workspaces/:wsId/policies/:id/activate
 *   GET   /api/workspaces/:wsId/policies/:id
 *   GET   /api/workspaces/:wsId/policies/:id/versions
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createTestUser,
  createTestWorkspace,
  createTestIdentity,
  createPolicy,
  activatePolicy,
  deprecatePolicy,
  createPolicyVersionViaApi,
  activatePolicyViaApi,
  getPolicyDetail,
  getVersionHistory,
  DEFAULT_REGO_SOURCE,
  type PolicyDetailResponse,
} from "./policy-crud-test-kit";

const getRuntime = setupAcceptanceSuite("policy_crud_m5_version");

// =============================================================================
// US-PCUI-05: Create New Version
// =============================================================================

describe("Milestone 5: Version Creation (US-PCUI-05)", () => {

  // ---------------------------------------------------------------------------
  // Walking Skeleton: Admin creates a new version from active policy
  // AC: New draft version created with incremented version, supersedes reference
  // ---------------------------------------------------------------------------
  it("admin creates a new version from an active policy", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active policy at version 1
    const user = await createTestUser(baseUrl, "m5-version-happy");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId: v1Id } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Versioned Policy",
      description: "Original rules",
      selector: { agent_role: "coding" },
      rego_source: DEFAULT_REGO_SOURCE,
      human_veto_required: true,
      max_ttl: "PT1H",
    });
    await activatePolicy(surreal, v1Id, adminId, workspace.workspaceId);

    // When admin creates a new version
    const response = await createPolicyVersionViaApi(
      baseUrl, user.headers, workspace.workspaceId, v1Id,
    );

    // Then a new draft version is created
    expect(response.status).toBe(201);
    const body = await response.json() as { policy_id: string; version: number };
    expect(body.policy_id).toBeDefined();
    expect(body.version).toBe(2);

    // And the new version has draft status and copies fields from v1
    const detailResponse = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, body.policy_id,
    );
    const detail = await detailResponse.json() as PolicyDetailResponse;
    expect(detail.policy.status).toBe("draft");
    expect(detail.policy.version).toBe(2);
    expect(detail.policy.title).toBe("Versioned Policy");
    expect(detail.policy.description).toBe("Original rules");
    expect(detail.policy.selector.agent_role).toBe("coding");
    expect(detail.policy.human_veto_required).toBe(true);
    expect(detail.policy.max_ttl).toBe("PT1H");

    // And the supersedes field points to v1
    expect(detail.policy.supersedes).toBe(v1Id);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Cannot create version from a draft policy
  // AC: POST /versions on draft returns 409
  // ---------------------------------------------------------------------------
  it("cannot create a version from a draft policy", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a draft policy
    const user = await createTestUser(baseUrl, "m5-version-draft");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Draft Cannot Version",
      rego_source: DEFAULT_REGO_SOURCE,
    });

    // When admin attempts to create a version from the draft
    const response = await createPolicyVersionViaApi(
      baseUrl, user.headers, workspace.workspaceId, policyId,
    );

    // Then the request is rejected
    expect(response.status).toBe(409);
    const body = await response.json() as { error: string };
    expect(body.error).toContain("active");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Cannot create version from a deprecated policy
  // AC: POST /versions on deprecated returns 409
  // ---------------------------------------------------------------------------
  it("cannot create a version from a deprecated policy", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a deprecated policy
    const user = await createTestUser(baseUrl, "m5-version-deprecated");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Deprecated Cannot Version",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);
    await deprecatePolicy(surreal, policyId);

    // When admin attempts to create a version from the deprecated policy
    const response = await createPolicyVersionViaApi(
      baseUrl, user.headers, workspace.workspaceId, policyId,
    );

    // Then the request is rejected
    expect(response.status).toBe(409);
  }, 120_000);
});

// =============================================================================
// US-PCUI-05: Supersede on Activation
// =============================================================================

describe("Milestone 5: Supersede Atomicity (US-PCUI-05)", () => {

  // ---------------------------------------------------------------------------
  // Activating new version supersedes the old version atomically
  // AC: Old version -> superseded, new version -> active, edges moved
  // ---------------------------------------------------------------------------
  it("activating new version supersedes the old version atomically", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given v1 active and v2 created as draft from v1
    const user = await createTestUser(baseUrl, "m5-supersede-atomic");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId: v1Id } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Atomic Supersede Policy",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, v1Id, adminId, workspace.workspaceId);

    // Create v2 from v1
    const versionResponse = await createPolicyVersionViaApi(
      baseUrl, user.headers, workspace.workspaceId, v1Id,
    );
    const { policy_id: v2Id } = await versionResponse.json() as { policy_id: string };

    // When admin activates v2
    const activateResponse = await activatePolicyViaApi(
      baseUrl, user.headers, workspace.workspaceId, v2Id,
    );

    // Then v2 is active
    expect(activateResponse.status).toBe(200);

    // And v1 is now superseded
    const v1Detail = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, v1Id,
    );
    const v1Body = await v1Detail.json() as PolicyDetailResponse;
    expect(v1Body.policy.status).toBe("superseded");

    // And v1 no longer has governance edges
    expect(v1Body.edges.governing).toHaveLength(0);
    expect(v1Body.edges.protects).toHaveLength(0);

    // And v2 has the governance edges
    const v2Detail = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, v2Id,
    );
    const v2Body = await v2Detail.json() as PolicyDetailResponse;
    expect(v2Body.policy.status).toBe("active");
    expect(v2Body.edges.governing.length).toBeGreaterThanOrEqual(1);
    expect(v2Body.edges.protects.length).toBeGreaterThanOrEqual(1);
  }, 120_000);
});

// =============================================================================
// US-PCUI-07: Version History Endpoint
// =============================================================================

describe("Milestone 5: Version History (US-PCUI-07)", () => {

  // ---------------------------------------------------------------------------
  // Version history returns all versions ordered by version number
  // AC: GET /versions returns complete chain
  // ---------------------------------------------------------------------------
  it("version history returns all versions in the chain", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given v1 active, v2 created and activated (v1 superseded)
    const user = await createTestUser(baseUrl, "m5-history");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId: v1Id } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "History Policy",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, v1Id, adminId, workspace.workspaceId);

    const versionResponse = await createPolicyVersionViaApi(
      baseUrl, user.headers, workspace.workspaceId, v1Id,
    );
    const { policy_id: v2Id } = await versionResponse.json() as { policy_id: string };

    // Activate v2 (supersedes v1)
    await activatePolicyViaApi(baseUrl, user.headers, workspace.workspaceId, v2Id);

    // When admin requests the version history from v2
    const response = await getVersionHistory(
      baseUrl, user.headers, workspace.workspaceId, v2Id,
    );

    // Then both versions are returned
    expect(response.status).toBe(200);
    const body = await response.json() as { versions: Array<{ id: string; version: number; status: string; title: string; rules_count: number; created_at: string }> };
    expect(body.versions.length).toBeGreaterThanOrEqual(2);

    // And versions are ordered by version number
    const versions = body.versions;
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i].version).toBeGreaterThan(versions[i - 1].version);
    }

    // And v1 is superseded, v2 is active
    const v1 = versions.find(v => v.id === v1Id);
    const v2 = versions.find(v => v.id === v2Id);
    expect(v1?.status).toBe("superseded");
    expect(v2?.status).toBe("active");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Version history for non-existent policy returns 404
  // ---------------------------------------------------------------------------
  it("version history for non-existent policy returns 404", async () => {
    const { baseUrl } = getRuntime();

    // Given a workspace with no matching policy
    const user = await createTestUser(baseUrl, "m5-history-404");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin requests version history for a non-existent policy
    const response = await getVersionHistory(
      baseUrl, user.headers, workspace.workspaceId, `policy-${crypto.randomUUID()}`,
    );

    // Then 404 is returned
    expect(response.status).toBe(404);
  }, 120_000);
});

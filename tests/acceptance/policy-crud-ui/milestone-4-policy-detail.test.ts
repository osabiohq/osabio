/**
 * Milestone 4: Policy Detail + Edges
 *
 * Traces: US-PCUI-03 (Policy Detail View), US-PCUI-07 (Version History)
 *
 * Validates that the policy detail endpoint returns the full policy
 * record including resolved governing/protects edges and the version
 * history from the supersedes chain.
 *
 * Driving ports:
 *   GET /api/workspaces/:wsId/policies/:id
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
  createPolicyVersion,
  getPolicyDetail,
  DEFAULT_REGO_SOURCE,
  type PolicyDetailResponse,
} from "./policy-crud-test-kit";

const getRuntime = setupAcceptanceSuite("policy_crud_m4_detail");

// =============================================================================
// US-PCUI-03: Policy Detail View
// =============================================================================

describe("Milestone 4: Policy Detail (US-PCUI-03)", () => {

  // ---------------------------------------------------------------------------
  // Walking Skeleton: Admin views full policy details
  // AC: Detail includes all PolicyRecord fields, edges, and version chain
  // ---------------------------------------------------------------------------
  it("admin views full details of a draft policy", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a draft policy with description, selector, and two rules
    const user = await createTestUser(baseUrl, "m4-detail-full");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Full Detail Policy",
      description: "Comprehensive access control for coding agents",
      selector: { agent_role: "coding" },
      rego_source: DEFAULT_REGO_SOURCE,
      human_veto_required: true,
      max_ttl: "PT1H",
    });

    // When admin requests the policy detail
    const response = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, policyId,
    );

    // Then the full policy record is returned
    expect(response.status).toBe(200);
    const detail = await response.json() as PolicyDetailResponse;
    expect(detail.policy.id).toBe(policyId);
    expect(detail.policy.title).toBe("Full Detail Policy");
    expect(detail.policy.description).toBe("Comprehensive access control for coding agents");
    expect(detail.policy.version).toBe(1);
    expect(detail.policy.status).toBe("draft");
    expect(detail.policy.selector.agent_role).toBe("coding");
    expect(detail.policy.human_veto_required).toBe(true);
    expect(detail.policy.max_ttl).toBe("PT1H");
    expect(detail.policy.created_at).toBeDefined();
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Active policy detail includes governing and protects edges
  // AC: Edges populated after activation
  // ---------------------------------------------------------------------------
  it("active policy detail includes governing and protects edges", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active policy
    const user = await createTestUser(baseUrl, "m4-detail-edges");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Edged Policy",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);

    // When admin requests the policy detail
    const response = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, policyId,
    );

    // Then governing and protects edges are included
    expect(response.status).toBe(200);
    const detail = await response.json() as PolicyDetailResponse;
    expect(detail.edges.governing.length).toBeGreaterThanOrEqual(1);
    expect(detail.edges.protects.length).toBeGreaterThanOrEqual(1);

    // And the protects edge points to the workspace
    expect(detail.edges.protects[0].workspace_id).toBe(workspace.workspaceId);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Deprecated policy detail shows empty edges
  // AC: Edges removed after deprecation
  // ---------------------------------------------------------------------------
  it("deprecated policy detail shows no governance edges", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a deprecated policy (was active, then deprecated)
    const user = await createTestUser(baseUrl, "m4-detail-deprecated");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Deprecated Detail",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);
    await deprecatePolicy(surreal, policyId);

    // When admin requests the policy detail
    const response = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, policyId,
    );

    // Then edges are empty
    expect(response.status).toBe(200);
    const detail = await response.json() as PolicyDetailResponse;
    expect(detail.policy.status).toBe("deprecated");
    expect(detail.edges.governing).toHaveLength(0);
    expect(detail.edges.protects).toHaveLength(0);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Non-existent policy returns 404
  // AC: GET with invalid ID returns 404
  // ---------------------------------------------------------------------------
  it("non-existent policy returns 404", async () => {
    const { baseUrl } = getRuntime();

    // Given a workspace with no matching policy
    const user = await createTestUser(baseUrl, "m4-detail-404");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin requests a non-existent policy
    const response = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, `policy-${crypto.randomUUID()}`,
    );

    // Then 404 is returned
    expect(response.status).toBe(404);
  }, 120_000);
});

// =============================================================================
// US-PCUI-07: Version History in Detail
// =============================================================================

describe("Milestone 4: Version History in Detail (US-PCUI-07)", () => {

  // ---------------------------------------------------------------------------
  // Policy with supersedes chain shows version history
  // AC: Version chain traverses supersedes references
  // ---------------------------------------------------------------------------
  it("policy detail includes version chain from supersedes references", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given v1 active, then v2 created from v1 (v1 becomes superseded)
    const user = await createTestUser(baseUrl, "m4-version-chain");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId: v1Id } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Version Chain Policy",
      rego_source: DEFAULT_REGO_SOURCE,
    });
    await activatePolicy(surreal, v1Id, adminId, workspace.workspaceId);

    // Create v2 from v1 (which supersedes v1)
    const { policyId: v2Id } = await createPolicyVersion(
      surreal, v1Id, workspace.workspaceId, adminId,
      'package osabio.policy\ndefault allow = false\ndeny if { input.action_spec.action == "deploy" }',
    );

    // When admin views the v2 detail
    const response = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, v2Id,
    );

    // Then version chain includes both v1 and v2
    expect(response.status).toBe(200);
    const detail = await response.json() as PolicyDetailResponse;
    expect(detail.version_chain.length).toBeGreaterThanOrEqual(2);

    const chainIds = detail.version_chain.map(v => v.id);
    expect(chainIds).toContain(v1Id);
    expect(chainIds).toContain(v2Id);

    // And v1 is superseded, v2 is the latest
    const v1Entry = detail.version_chain.find(v => v.id === v1Id);
    expect(v1Entry?.status).toBe("superseded");
    expect(v1Entry?.version).toBe(1);

    const v2Entry = detail.version_chain.find(v => v.id === v2Id);
    expect(v2Entry?.version).toBe(2);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Single version policy has one-element version chain
  // AC: No supersedes means version chain is just this policy
  // ---------------------------------------------------------------------------
  it("single version policy shows only itself in version chain", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a standalone policy with no supersedes
    const user = await createTestUser(baseUrl, "m4-single-version");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin", "human", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Standalone Policy",
      rego_source: DEFAULT_REGO_SOURCE,
    });

    // When admin views the detail
    const response = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, policyId,
    );

    // Then version chain has exactly one entry
    expect(response.status).toBe(200);
    const detail = await response.json() as PolicyDetailResponse;
    expect(detail.version_chain).toHaveLength(1);
    expect(detail.version_chain[0].id).toBe(policyId);
    expect(detail.version_chain[0].version).toBe(1);
  }, 120_000);
});

/**
 * Milestone 2: Policy Creation + Validation
 *
 * Traces: US-PCUI-02 (Create Policy)
 *
 * Validates that human identities can create draft policies with valid
 * rules, and that creation is rejected for missing title, missing rules,
 * and invalid predicate structure.
 *
 * Driving ports:
 *   POST /api/workspaces/:wsId/policies
 *   GET  /api/workspaces/:wsId/policies/:id
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createTestUser,
  createTestWorkspace,
  createTestIdentity,
  createPolicyViaApi,
  getPolicyDetail,
  buildPolicyBody,
  DEFAULT_REGO_SOURCE,
  type PolicyDetailResponse,
} from "./policy-crud-test-kit";

const getRuntime = setupAcceptanceSuite("policy_crud_m2_creation");

// =============================================================================
// US-PCUI-02: Create Policy
// =============================================================================

describe("Milestone 2: Policy Creation (US-PCUI-02)", () => {

  // ---------------------------------------------------------------------------
  // Walking Skeleton: Admin creates a draft policy with valid rules
  // AC: POST returns 201 with policy_id, policy has draft status and version 1
  // ---------------------------------------------------------------------------
  it("admin creates a draft policy with one deny rule", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an admin in a workspace
    const user = await createTestUser(baseUrl, "m2-create-happy");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin creates a policy with Rego source
    const response = await createPolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      buildPolicyBody({
        title: "Block Production Deployments",
        description: "Prevents agents from deploying to production without human approval",
        rego_source: DEFAULT_REGO_SOURCE,
        human_veto_required: true,
      }),
    );

    // Then the policy is created as a draft
    expect(response.status).toBe(201);
    const body = await response.json() as { policy_id: string };
    expect(body.policy_id).toBeDefined();

    // And the policy detail shows draft status with version 1
    const detailResponse = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, body.policy_id,
    );
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json() as PolicyDetailResponse;
    expect(detail.policy.status).toBe("draft");
    expect(detail.policy.version).toBe(1);
    expect(detail.policy.title).toBe("Block Production Deployments");
    expect(detail.policy.human_veto_required).toBe(true);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Admin creates policy with multiple rules
  // AC: Policy with multiple rules is created and all rules persisted
  // ---------------------------------------------------------------------------
  it("admin creates a policy with multiple rules at different priorities", async () => {
    const { baseUrl } = getRuntime();

    // Given an admin in a workspace
    const user = await createTestUser(baseUrl, "m2-multi-rules");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin creates a policy with Rego source containing multiple rules
    const multiRuleRego = `package osabio.policy
default allow = false
allow { input.action_spec.action == "read" }
deny { input.action_spec.action == "deploy" }`;

    const response = await createPolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      buildPolicyBody({
        title: "Tiered Access Control",
        rego_source: multiRuleRego,
      }),
    );

    // Then the policy is created successfully
    expect(response.status).toBe(201);
    const body = await response.json() as { policy_id: string };

    const detailResponse = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, body.policy_id,
    );
    const detail = await detailResponse.json() as PolicyDetailResponse;
    expect(detail.policy.title).toBe("Tiered Access Control");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Policy with selector is created correctly
  // AC: Selector fields are persisted
  // ---------------------------------------------------------------------------
  it("admin creates a policy with agent role selector", async () => {
    const { baseUrl } = getRuntime();

    // Given an admin in a workspace
    const user = await createTestUser(baseUrl, "m2-selector");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin creates a policy with a selector
    const response = await createPolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      buildPolicyBody({
        title: "Coding Agent Budget Cap",
        selector: { agent_role: "coding" },
        rego_source: DEFAULT_REGO_SOURCE,
      }),
    );

    // Then the selector is preserved on the created policy
    expect(response.status).toBe(201);
    const body = await response.json() as { policy_id: string };

    const detailResponse = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, body.policy_id,
    );
    const detail = await detailResponse.json() as PolicyDetailResponse;
    expect(detail.policy.selector.agent_role).toBe("coding");
  }, 120_000);
});

// =============================================================================
// US-PCUI-02: Validation Errors
// =============================================================================

describe("Milestone 2: Policy Creation Validation (US-PCUI-02)", () => {

  // ---------------------------------------------------------------------------
  // Missing title is rejected
  // AC: POST without title returns 400
  // ---------------------------------------------------------------------------
  it("policy creation is rejected without a title", async () => {
    const { baseUrl } = getRuntime();

    // Given an admin in a workspace
    const user = await createTestUser(baseUrl, "m2-no-title");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin attempts to create a policy without a title
    const response = await createPolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      {
        title: "",
        description: "Missing title test",
        rego_source: DEFAULT_REGO_SOURCE,
      } as any,
    );

    // Then the request is rejected with validation error
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toContain("title");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Missing rego_source is rejected
  // AC: POST without rego_source returns 400
  // ---------------------------------------------------------------------------
  it("policy creation is rejected without rego_source", async () => {
    const { baseUrl } = getRuntime();

    // Given an admin in a workspace
    const user = await createTestUser(baseUrl, "m2-no-rego");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin attempts to create a policy without rego_source
    const response = await createPolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      {
        title: "No Rego Policy",
        description: "Policy with no rego_source for testing",
      } as any,
    );

    // Then the request is rejected with validation error
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toContain("rego_source");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Invalid Rego syntax is rejected
  // AC: POST with malformed Rego source returns 400
  // ---------------------------------------------------------------------------
  it("policy creation is rejected with invalid Rego syntax", async () => {
    const { baseUrl } = getRuntime();

    // Given an admin in a workspace
    const user = await createTestUser(baseUrl, "m2-bad-rego");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin attempts to create a policy with invalid Rego
    const response = await createPolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      {
        title: "Bad Rego Policy",
        description: "Policy with invalid Rego syntax",
        rego_source: "package osabio.policy\nthis is not valid rego {{{}}}",
      } as any,
    );

    // Then the request is rejected with validation error
    expect(response.status).toBe(400);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Missing package declaration is rejected
  // AC: POST with Rego missing required package returns 400
  // ---------------------------------------------------------------------------
  it("policy creation is rejected without required package declaration", async () => {
    const { baseUrl } = getRuntime();

    // Given an admin in a workspace
    const user = await createTestUser(baseUrl, "m2-no-package");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin attempts to create a policy without the required package
    const response = await createPolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      {
        title: "Missing Package Policy",
        description: "Policy without osabio.policy package",
        rego_source: "package wrong.package\ndefault allow = true",
      } as any,
    );

    // Then the request is rejected
    expect(response.status).toBe(400);
  }, 120_000);
});

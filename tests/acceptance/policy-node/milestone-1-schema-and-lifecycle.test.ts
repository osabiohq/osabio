/**
 * Milestone 1: Policy Schema, Lifecycle, and Graph Relations
 *
 * Traces: US-1, US-2, US-3, US-10
 *
 * Validates policy record creation with schema enforcement,
 * lifecycle state transitions (draft -> active -> deprecated),
 * graph edge creation/removal, and version immutability.
 *
 * Driving ports:
 *   Direct DB for policy CRUD and schema enforcement
 *   HTTP routes for validation boundary tests
 *   Graph traversal queries for relation validation
 */
import { describe, expect, it } from "bun:test";
import { RecordId, type Surreal } from "surrealdb";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createTestIdentity,
  createPolicy,
  activatePolicy,
  deprecatePolicy,
  getPolicyRecord,
  createPolicyVersion,
  type TestUser,
} from "./policy-test-kit";

const VALID_REGO = `package osabio.policy
default allow := false
allow if {
  input.action_spec.action == "read"
}`;

const getRuntime = setupOrchestratorSuite("policy_m1_schema_lifecycle");

// ---------------------------------------------------------------------------
// Helper: link a Better Auth session user to a human identity so the policy
// route's resolveIdentityFromSession succeeds
// ---------------------------------------------------------------------------
async function linkUserToHumanIdentity(
  surreal: Surreal,
  user: TestUser,
  workspaceId: string,
): Promise<string> {
  const identityId = crypto.randomUUID();
  const identityRecord = new RecordId("identity", identityId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const personRecord = new RecordId("person", user.personId);

  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: identityRecord,
    content: {
      name: "Test Admin",
      type: "human",
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  await surreal.query(`RELATE $identity->member_of->$workspace SET added_at = time::now();`, {
    identity: identityRecord,
    workspace: workspaceRecord,
  });

  await surreal.query(`RELATE $identity->identity_person->$person SET added_at = time::now();`, {
    identity: identityRecord,
    person: personRecord,
  });

  return identityId;
}

describe("Milestone 1: Policy Schema Enforcement (US-1)", () => {
  // ---------------------------------------------------------------------------
  // US-1: Policy created with all required fields
  // AC-1 happy path
  // ---------------------------------------------------------------------------
  it("creates a policy record with title, rego_source, selector, and flags", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a human admin
    const user = await createTestUser(baseUrl, "m1-create");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);

    // When the admin creates a policy with all fields
    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Finance Small Spend",
      description: "Allow small financial transactions",
      selector: { resource: "banking_api" },
      rego_source: VALID_REGO,
      human_veto_required: false,
      max_ttl: "1h",
    });

    // Then the record is persisted with all fields
    const record = await getPolicyRecord(surreal, policyId);
    expect(record.title).toBe("Finance Small Spend");
    expect(record.version).toBe(1);
    expect(record.status).toBe("draft");
    expect(record.rego_source).toBe(VALID_REGO);
    expect(record.human_veto_required).toBe(false);
    expect(record.created_at).toBeDefined();
  }, 120_000);

  // ---------------------------------------------------------------------------
  // US-1: HTTP route rejects invalid Rego syntax
  // AC-1 validation path — drives policy-validation.ts Rego compilation
  // ---------------------------------------------------------------------------
  it("rejects invalid Rego syntax with HTTP 400 and error details", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an authenticated human user with a session-linked identity
    const user = await createTestUser(baseUrl, "m1-invalid-rego");
    const workspace = await createTestWorkspace(baseUrl, user);
    await linkUserToHumanIdentity(surreal, user, workspace.workspaceId);

    // When a policy is created with invalid Rego syntax
    const response = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/policies`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...user.headers,
        },
        body: JSON.stringify({
          title: "Bad Rego Policy",
          description: "Policy with syntax error",
          rego_source: `package osabio.policy
default allow := !!!`,
        }),
      },
    );

    // Then the route returns 400 with error information
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
    expect(typeof body.error).toBe("string");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // US-1: HTTP route rejects wrong package declaration
  // AC-1 validation path
  // ---------------------------------------------------------------------------
  it("rejects Rego with wrong package declaration with HTTP 400", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an authenticated human user with a session-linked identity
    const user = await createTestUser(baseUrl, "m1-wrong-package");
    const workspace = await createTestWorkspace(baseUrl, user);
    await linkUserToHumanIdentity(surreal, user, workspace.workspaceId);

    // When a policy is created with the wrong package declaration
    const response = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/policies`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...user.headers,
        },
        body: JSON.stringify({
          title: "Wrong Package Policy",
          description: "Policy with wrong package",
          rego_source: `package wrong.package
default allow := false`,
        }),
      },
    );

    // Then the route returns 400
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
    expect(typeof body.error).toBe("string");
    expect((body.error as string).toLowerCase()).toContain("package");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // US-1: HTTP route rejects legacy rules field
  // AC-1 validation path — clean break from predicate-based rules
  // ---------------------------------------------------------------------------
  it("rejects request body with legacy rules field with HTTP 400", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an authenticated human user with a session-linked identity
    const user = await createTestUser(baseUrl, "m1-legacy-rules");
    const workspace = await createTestWorkspace(baseUrl, user);
    await linkUserToHumanIdentity(surreal, user, workspace.workspaceId);

    // When a policy is created with the legacy rules field
    const response = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/policies`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...user.headers,
        },
        body: JSON.stringify({
          title: "Legacy Rules Policy",
          description: "Policy using old predicate format",
          rules: [{
            id: "r1",
            condition: { field: "action", operator: "eq", value: "deploy" },
            effect: "deny",
            priority: 100,
          }],
        }),
      },
    );

    // Then the route returns 400 indicating rules is not supported
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
    expect(typeof body.error).toBe("string");
    expect((body.error as string).toLowerCase()).toContain("rules");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // US-1: Schema rejects invalid status value
  // AC-1 sad path
  // ---------------------------------------------------------------------------
  it("rejects policy creation with invalid status", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, "m1-bad-status");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);

    // When a policy is created with an invalid status
    const policyRecord = new RecordId("policy", `badstatus-${crypto.randomUUID()}`);
    let statusError: Error | undefined;
    try {
      await surreal.query(`CREATE $policy CONTENT $content;`, {
        policy: policyRecord,
        content: {
          title: "Bad Status Policy",
          version: 1,
          status: "invalid_status",
          selector: {},
          rego_source: VALID_REGO,
          human_veto_required: false,
          created_by: new RecordId("identity", adminId),
          workspace: new RecordId("workspace", workspace.workspaceId),
          created_at: new Date(),
        },
      });
    } catch (e) {
      statusError = e as Error;
    }

    // Then the database rejects the invalid status value
    expect(statusError).toBeDefined();
  }, 120_000);
});

describe("Milestone 1: Policy Lifecycle Management (US-2)", () => {
  // ---------------------------------------------------------------------------
  // US-2: Draft -> Active transition with audit event
  // AC-2 happy path
  // ---------------------------------------------------------------------------
  it("activates a draft policy and creates graph edges atomically", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a draft policy
    const user = await createTestUser(baseUrl, "m1-activate");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "API Rate Limit Policy",
      rego_source: VALID_REGO,
    });

    // When the admin activates the policy
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);

    // Then the policy status is active
    const record = await getPolicyRecord(surreal, policyId);
    expect(record.status).toBe("active");
    expect(record.updated_at).toBeDefined();

    // And the governing edge exists (identity -> policy)
    const identityRecord = new RecordId("identity", adminId);
    const governingRows = (await surreal.query(
      `SELECT ->governing->policy AS policies FROM $identity;`,
      { identity: identityRecord },
    )) as Array<Array<{ policies: RecordId[] }>>;
    const governedPolicies = governingRows[0]?.[0]?.policies ?? [];
    const found = governedPolicies.some(p => (p.id as string) === policyId);
    expect(found).toBe(true);

    // And the protects edge exists (policy -> workspace)
    const policyRecord = new RecordId("policy", policyId);
    const protectsRows = (await surreal.query(
      `SELECT ->protects->workspace AS workspaces FROM $policy;`,
      { policy: policyRecord },
    )) as Array<Array<{ workspaces: RecordId[] }>>;
    const protectedWorkspaces = protectsRows[0]?.[0]?.workspaces ?? [];
    expect(protectedWorkspaces.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // US-2: Active -> Deprecated removes edges
  // AC-2 deprecation path
  // ---------------------------------------------------------------------------
  it("deprecating a policy removes all governing and protects edges", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active policy with graph edges
    const user = await createTestUser(baseUrl, "m1-deprecate");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Legacy Auth Policy",
      rego_source: VALID_REGO,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);

    // When the admin deprecates the policy
    await deprecatePolicy(surreal, policyId);

    // Then the policy status is deprecated
    const record = await getPolicyRecord(surreal, policyId);
    expect(record.status).toBe("deprecated");

    // And the governing edges are removed
    const policyRecord = new RecordId("policy", policyId);
    const governingRows = (await surreal.query(
      `SELECT * FROM governing WHERE out = $policy;`,
      { policy: policyRecord },
    )) as Array<Array<unknown>>;
    expect(governingRows[0]).toHaveLength(0);

    // And the protects edges are removed
    const protectsRows = (await surreal.query(
      `SELECT * FROM protects WHERE in = $policy;`,
      { policy: policyRecord },
    )) as Array<Array<unknown>>;
    expect(protectsRows[0]).toHaveLength(0);
  }, 120_000);
});

describe("Milestone 1: Graph Relations (US-3)", () => {
  // ---------------------------------------------------------------------------
  // US-3: Identity-to-policy governing edge with created_at
  // AC-3
  // ---------------------------------------------------------------------------
  it("governing edge links identity to policy with created_at timestamp", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, "m1-governing");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Governing Edge Test",
      rego_source: VALID_REGO,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);

    // When the governing edge is queried
    const policyRecord = new RecordId("policy", policyId);
    const rows = (await surreal.query(
      `SELECT *, created_at FROM governing WHERE out = $policy;`,
      { policy: policyRecord },
    )) as Array<Array<{ created_at: string }>>;

    // Then the edge has a created_at timestamp
    expect(rows[0]).toHaveLength(1);
    expect(rows[0][0].created_at).toBeDefined();
  }, 120_000);

  // ---------------------------------------------------------------------------
  // US-3: Policy-to-workspace protects edge with created_at
  // AC-3
  // ---------------------------------------------------------------------------
  it("protects edge links policy to workspace with created_at timestamp", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, "m1-protects");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Protects Edge Test",
      rego_source: VALID_REGO,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);

    // When the protects edge is queried
    const policyRecord = new RecordId("policy", policyId);
    const rows = (await surreal.query(
      `SELECT *, created_at FROM protects WHERE in = $policy;`,
      { policy: policyRecord },
    )) as Array<Array<{ created_at: string }>>;

    // Then the edge has a created_at timestamp
    expect(rows[0]).toHaveLength(1);
    expect(rows[0][0].created_at).toBeDefined();
  }, 120_000);
});

describe("Milestone 1: Version Immutability (US-10)", () => {
  // ---------------------------------------------------------------------------
  // US-10: New version supersedes old version
  // AC-10
  // ---------------------------------------------------------------------------
  it("updating policy rego_source creates a new version and supersedes the old one", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active policy at version 1
    const user = await createTestUser(baseUrl, "m1-version");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);

    const v1RegoSource = `package osabio.policy
default allow := false
allow if {
  input.budget_limit.amount <= 100
}`;

    const { policyId: v1PolicyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Budget Cap Policy",
      rego_source: v1RegoSource,
      status: "active",
    });

    const v2RegoSource = `package osabio.policy
default allow := false
allow if {
  input.budget_limit.amount <= 500
}`;

    // When the admin updates the budget cap to 500
    const { policyId: v2PolicyId } = await createPolicyVersion(
      surreal,
      v1PolicyId,
      workspace.workspaceId,
      adminId,
      v2RegoSource,
    );

    // Then the old version is superseded
    const v1Record = await getPolicyRecord(surreal, v1PolicyId);
    expect(v1Record.status).toBe("superseded");
    expect(v1Record.version).toBe(1);
    // And the old rego source is unchanged (immutable)
    expect(v1Record.rego_source).toBe(v1RegoSource);

    // And the new version is active with updated rego source
    const v2Record = await getPolicyRecord(surreal, v2PolicyId);
    expect(v2Record.status).toBe("active");
    expect(v2Record.version).toBe(2);
    expect(v2Record.rego_source).toBe(v2RegoSource);

    // And the supersedes chain is preserved
    expect(v2Record.supersedes).toBeDefined();
  }, 120_000);
});

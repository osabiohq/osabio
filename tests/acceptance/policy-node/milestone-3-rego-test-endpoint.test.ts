/**
 * Milestone 3: Rego Test Endpoint and Validate Endpoint
 *
 * Traces: Step 03-01, Step 03-02
 *
 * Validates:
 *   - POST /api/workspaces/:workspaceId/policies/:id/test evaluates Rego against mock input
 *   - POST /api/workspaces/:workspaceId/policies/validate compiles Rego without persisting
 *
 * Driving ports:
 *   HTTP routes for test and validate endpoints
 *   Direct DB for policy setup
 */
import { describe, expect, it } from "bun:test";
import { RecordId, type Surreal } from "surrealdb";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createPolicy,
  type TestUser,
} from "./policy-test-kit";

const getRuntime = setupOrchestratorSuite("policy_m3_test_endpoint");

// ---------------------------------------------------------------------------
// Rego policies for test scenarios
// ---------------------------------------------------------------------------

const DENY_POLICY_REGO = `package osabio.policy
default allow := false
deny contains msg if {
  input.action_spec.action == "deploy"
  msg := "Production deploys require approval"
}`;

const ALLOW_POLICY_REGO = `package osabio.policy
default allow := false
allow if {
  input.action_spec.action == "read"
}`;

const EVIDENCE_REQUIREMENT_REGO = `package osabio.policy
default allow := false
allow if {
  input.action_spec.action == "read"
}
evidence_requirement := {
  "min_count": 2,
  "required_types": ["task", "decision"]
}`;

const INVALID_REGO = `package osabio.policy
default allow := !!!`;

const VALID_REGO_FOR_VALIDATE = `package osabio.policy
default allow := false
allow if {
  input.action_spec.action == "read"
}`;

// ---------------------------------------------------------------------------
// Helper: link a Better Auth session user to a human identity
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

// ---------------------------------------------------------------------------
// Minimal IntentEvaluationContext for test scenarios
// ---------------------------------------------------------------------------

const deployMockInput = {
  action_spec: { action: "deploy", provider: "infra", params: {} },
  behavior_scores: {},
  budget_limit: { amount: 100, currency: "USD" },
};

const readMockInput = {
  action_spec: { action: "read", provider: "infra", params: {} },
  behavior_scores: {},
  budget_limit: { amount: 100, currency: "USD" },
};

// ---------------------------------------------------------------------------
// Milestone 3: POST /policies/:id/test (03-01)
// ---------------------------------------------------------------------------

describe("Milestone 3: Policy Test Endpoint (03-01)", () => {
  it("test policy with mock input that triggers deny", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a deny policy
    const user = await createTestUser(baseUrl, "m3-deny");
    const workspace = await createTestWorkspace(baseUrl, user);
    await linkUserToHumanIdentity(surreal, user, workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, "test-admin", {
      title: "Deploy Block Policy",
      rego_source: DENY_POLICY_REGO,
    });

    // When testing the policy with a deploy action
    const response = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/policies/${policyId}/test`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...user.headers,
        },
        body: JSON.stringify(deployMockInput),
      },
    );

    // Then the response indicates deny with a message
    expect(response.status).toBe(200);
    const body = await response.json() as { decision: string; messages: string[] };
    expect(body.decision).toBe("deny");
    expect(body.messages).toContain("Production deploys require approval");
  }, 120_000);

  it("test policy with mock input that triggers allow", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an allow policy
    const user = await createTestUser(baseUrl, "m3-allow");
    const workspace = await createTestWorkspace(baseUrl, user);
    await linkUserToHumanIdentity(surreal, user, workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, "test-admin", {
      title: "Read Allow Policy",
      rego_source: ALLOW_POLICY_REGO,
    });

    // When testing with a read action
    const response = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/policies/${policyId}/test`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...user.headers,
        },
        body: JSON.stringify(readMockInput),
      },
    );

    // Then the response indicates allow with no messages
    expect(response.status).toBe(200);
    const body = await response.json() as { decision: string; messages: string[] };
    expect(body.decision).toBe("allow");
    expect(body.messages).toEqual([]);
  }, 120_000);

  it("test policy with evidence requirement output", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an evidence_requirement policy
    const user = await createTestUser(baseUrl, "m3-evidence");
    const workspace = await createTestWorkspace(baseUrl, user);
    await linkUserToHumanIdentity(surreal, user, workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, "test-admin", {
      title: "Evidence Required Policy",
      rego_source: EVIDENCE_REQUIREMENT_REGO,
    });

    // When testing with a read action
    const response = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/policies/${policyId}/test`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...user.headers,
        },
        body: JSON.stringify(readMockInput),
      },
    );

    // Then the response includes evidence_requirement
    expect(response.status).toBe(200);
    const body = await response.json() as {
      decision: string;
      messages: string[];
      evidence_requirement?: { min_count: number; required_types?: string[] };
    };
    expect(body.decision).toBe("allow");
    expect(body.evidence_requirement).toBeDefined();
    expect(body.evidence_requirement?.min_count).toBe(2);
    expect(body.evidence_requirement?.required_types).toEqual(["task", "decision"]);
  }, 120_000);

  it("test non-existent policy returns 404", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with no matching policy
    const user = await createTestUser(baseUrl, "m3-404");
    const workspace = await createTestWorkspace(baseUrl, user);
    await linkUserToHumanIdentity(surreal, user, workspace.workspaceId);

    // When testing a non-existent policy ID
    const response = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/policies/nonexistent-policy-id/test`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...user.headers,
        },
        body: JSON.stringify(readMockInput),
      },
    );

    // Then 404 is returned
    expect(response.status).toBe(404);
  }, 120_000);

  it("test with invalid mock input (missing action_spec) returns 400", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a policy
    const user = await createTestUser(baseUrl, "m3-400");
    const workspace = await createTestWorkspace(baseUrl, user);
    await linkUserToHumanIdentity(surreal, user, workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, "test-admin", {
      title: "Allow Read Policy",
      rego_source: ALLOW_POLICY_REGO,
    });

    // When testing with missing required action_spec field
    const response = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/policies/${policyId}/test`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...user.headers,
        },
        body: JSON.stringify({ behavior_scores: {}, budget_limit: { amount: 100, currency: "USD" } }),
      },
    );

    // Then 400 is returned
    expect(response.status).toBe(400);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Milestone 3: POST /policies/validate (03-02)
// ---------------------------------------------------------------------------

describe("Milestone 3: Policy Validate Endpoint (03-02)", () => {
  it("validate endpoint returns compilation errors for invalid Rego", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an authenticated user
    const user = await createTestUser(baseUrl, "m3-validate-invalid");
    const workspace = await createTestWorkspace(baseUrl, user);
    await linkUserToHumanIdentity(surreal, user, workspace.workspaceId);

    // When submitting invalid Rego source
    const response = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/policies/validate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...user.headers,
        },
        body: JSON.stringify({ rego_source: INVALID_REGO }),
      },
    );

    // Then a failure response with errors is returned (no policy created)
    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; errors?: Array<{ line: number; column: number; message: string }> };
    expect(body.success).toBe(false);
    expect(body.errors).toBeDefined();
    expect(body.errors!.length).toBeGreaterThan(0);
  }, 120_000);

  it("validate endpoint returns success for valid Rego", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an authenticated user
    const user = await createTestUser(baseUrl, "m3-validate-valid");
    const workspace = await createTestWorkspace(baseUrl, user);
    await linkUserToHumanIdentity(surreal, user, workspace.workspaceId);

    // When submitting valid Rego source
    const response = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/policies/validate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...user.headers,
        },
        body: JSON.stringify({ rego_source: VALID_REGO_FOR_VALIDATE }),
      },
    );

    // Then success is returned (no policy created)
    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean };
    expect(body.success).toBe(true);
  }, 120_000);
});

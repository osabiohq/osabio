import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import type {
  PolicyRecord,
  IntentEvaluationContext,
  PolicyGateWarning,
} from "../../app/src/server/policy/types";
import {
  deduplicatePolicies,
  buildGateResult,
} from "../../app/src/server/policy/policy-gate";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const DENY_REGO = `package osabio.policy
default allow := false
deny contains msg if {
  input.action_spec.action == "deploy"
  msg := "Production deploys require approval"
}`;

const ALLOW_REGO = `package osabio.policy
default allow := true`;

const makePolicyRecord = (
  id: string,
  rego_source: string,
  overrides?: Partial<PolicyRecord>,
): PolicyRecord => ({
  id: new RecordId("policy", id),
  title: `Policy ${id}`,
  version: 1,
  status: "active",
  selector: {},
  rego_source,
  human_veto_required: false,
  created_by: new RecordId("identity", "creator-1"),
  workspace: new RecordId("workspace", "ws-1"),
  created_at: new Date("2026-01-01"),
  ...overrides,
});

const makeContext = (
  overrides?: Partial<IntentEvaluationContext>,
): IntentEvaluationContext => ({
  goal: "Test goal",
  reasoning: "Test reasoning",
  priority: 50,
  action_spec: { provider: "test", action: "read", params: {} },
  requester_type: "agent",
  ...overrides,
});

// ---------------------------------------------------------------------------
// deduplicatePolicies
// ---------------------------------------------------------------------------

describe("deduplicatePolicies", () => {
  it("removes duplicate policies by ID", () => {
    const policy = makePolicyRecord("p1", ALLOW_REGO);
    const duplicate = makePolicyRecord("p1", ALLOW_REGO);

    const result = deduplicatePolicies([policy, duplicate]);

    expect(result).toHaveLength(1);
    expect((result[0].id.id as string)).toBe("p1");
  });

  it("preserves unique policies", () => {
    const p1 = makePolicyRecord("p1", ALLOW_REGO);
    const p2 = makePolicyRecord("p2", DENY_REGO);

    const result = deduplicatePolicies([p1, p2]);

    expect(result).toHaveLength(2);
  });

  it("handles empty array", () => {
    const result = deduplicatePolicies([]);

    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildGateResult
// ---------------------------------------------------------------------------

describe("buildGateResult", () => {
  it("returns passed=true for empty evaluated policies", () => {
    const result = buildGateResult([], false, []);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.policy_trace).toHaveLength(0);
      expect(result.human_veto_required).toBe(false);
      expect(result.warnings).toHaveLength(0);
    }
  });

  it("returns passed=false with deny_rule_id on deny match", () => {
    const evaluatedPolicies = [
      {
        policyId: "p1",
        policyVersion: 1,
        humanVetoRequired: false,
        denied: true,
        denyMessages: ["Production deploys require approval"],
        evidenceRequirement: undefined,
        warnings: [] as PolicyGateWarning[],
      },
    ];

    const result = buildGateResult(evaluatedPolicies, true, []);

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.deny_rule_id).toBe("p1");
      expect(result.reason).toContain("p1");
    }
  });

  it("sets human_veto_required when any policy requires it", () => {
    const evaluatedPolicies = [
      {
        policyId: "p1",
        policyVersion: 1,
        humanVetoRequired: true,
        denied: false,
        denyMessages: [],
        evidenceRequirement: undefined,
        warnings: [] as PolicyGateWarning[],
      },
    ];

    const result = buildGateResult(evaluatedPolicies, false, []);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.human_veto_required).toBe(true);
    }
  });

  it("builds correct PolicyTraceEntry array (one entry per policy)", () => {
    const evaluatedPolicies = [
      {
        policyId: "p1",
        policyVersion: 2,
        humanVetoRequired: false,
        denied: false,
        denyMessages: [],
        evidenceRequirement: undefined,
        warnings: [] as PolicyGateWarning[],
      },
      {
        policyId: "p2",
        policyVersion: 1,
        humanVetoRequired: false,
        denied: true,
        denyMessages: ["denied"],
        evidenceRequirement: undefined,
        warnings: [] as PolicyGateWarning[],
      },
    ];

    const result = buildGateResult(evaluatedPolicies, true, []);

    expect(result.policy_trace).toHaveLength(2);
    expect(result.policy_trace[0]).toMatchObject({
      policy_id: "p1",
      policy_version: 2,
      rule_id: "p1",
      matched: false,
    });
    expect(result.policy_trace[1]).toMatchObject({
      policy_id: "p2",
      policy_version: 1,
      rule_id: "p2",
      matched: true,
    });
  });
});

// ---------------------------------------------------------------------------
// buildGateResult with evidence requirements
// ---------------------------------------------------------------------------

describe("buildGateResult with evidence requirements", () => {
  it("includes evidence_requirements on passed result", () => {
    const evaluatedPolicies = [
      {
        policyId: "p1",
        policyVersion: 1,
        humanVetoRequired: false,
        denied: false,
        denyMessages: [],
        evidenceRequirement: { min_count: 4, required_types: ["decision", "task"] },
        warnings: [] as PolicyGateWarning[],
      },
    ];

    const evidenceRequirements = { min_count: 4, required_types: ["decision", "task"] };
    const result = buildGateResult(evaluatedPolicies, false, [], evidenceRequirements);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.evidence_requirements).toEqual({
        min_count: 4,
        required_types: ["decision", "task"],
      });
    }
  });

  it("omits evidence_requirements when none matched", () => {
    const result = buildGateResult([], false, []);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.evidence_requirements).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// evaluatePolicyGate integration (mocked IO boundary)
// ---------------------------------------------------------------------------

describe("evaluatePolicyGate integration", () => {
  it("empty policy set returns passed with empty trace", async () => {
    const { evaluatePolicyGate } = await import(
      "../../app/src/server/policy/policy-gate"
    );

    let queryCallCount = 0;
    const queriesReceived: string[] = [];

    const mockSurreal = {
      query: async (sql: string) => {
        queryCallCount++;
        queriesReceived.push(sql);
        // Validate that the query uses expected policy graph relations
        const hasExpectedRelations =
          sql.includes("governing") || sql.includes("protects") || sql.includes("policy");
        if (!hasExpectedRelations) {
          throw new Error(
            `mockSurreal: unexpected query — expected policy relation keywords, got: ${sql}`,
          );
        }
        return [{ policies: [] }];
      },
    } as any;

    const result = await evaluatePolicyGate(
      mockSurreal,
      new RecordId("identity", "test-id"),
      new RecordId("workspace", "test-ws"),
      makeContext(),
    );

    // Verify the mock was actually called (not bypassed)
    expect(queryCallCount).toBeGreaterThan(0);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.policy_trace).toHaveLength(0);
      expect(result.human_veto_required).toBe(false);
      expect(result.warnings).toHaveLength(0);
    }
  });
});

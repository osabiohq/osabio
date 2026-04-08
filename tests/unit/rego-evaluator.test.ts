import { describe, it, expect } from "bun:test";
import {
  compileRego,
  evaluateRegoPolicy,
  createEngineCache,
} from "../../app/src/server/policy/rego-evaluator";
import type { IntentEvaluationContext } from "../../app/src/server/policy/types";

const makeDeployContext = (): IntentEvaluationContext => ({
  goal: "deploy service",
  reasoning: "release is ready",
  priority: 5,
  action_spec: { provider: "github", action: "deploy" },
  requester_type: "agent",
});

const makeEditFileContext = (): IntentEvaluationContext => ({
  goal: "edit source file",
  reasoning: "fix bug",
  priority: 3,
  action_spec: { provider: "filesystem", action: "edit_file" },
  requester_type: "agent",
});

const makeDeployProductionContext = (): IntentEvaluationContext => ({
  goal: "deploy to production",
  reasoning: "hotfix",
  priority: 8,
  action_spec: { provider: "github", action: "deploy_production" },
  requester_type: "agent",
});

const makeNoMatchContext = (): IntentEvaluationContext => ({
  goal: "read logs",
  reasoning: "debugging",
  priority: 1,
  action_spec: { provider: "logging", action: "read_logs" },
  requester_type: "agent",
});

const DENY_DEPLOY_REGO = `package osabio.policy
default allow := false
deny contains msg if {
  input.action_spec.action == "deploy"
  msg := "Production deploys require approval"
}`;

const ALLOW_EDIT_FILE_REGO = `package osabio.policy
default allow := false
allow if {
  input.action_spec.action == "edit_file"
}`;

const EVIDENCE_REQUIREMENT_REGO = `package osabio.policy
default allow := false
allow if { true }
evidence_requirement := {
  "min_count": 2,
  "required_types": ["decision", "task"]
} if {
  input.action_spec.action == "deploy_production"
}`;

const NO_MATCH_REGO = `package osabio.policy
default allow := false`;

describe("compiles and evaluates hardcoded Rego policy", () => {
  it("compiles valid Rego successfully", async () => {
    const source = "package osabio.policy\ndefault allow := false";
    const result = await compileRego(source);

    expect(result.success).toBe(true);
  });

  it("returns errors for invalid Rego with line and column", async () => {
    const source = "package osabio.policy\ndefault allow := !!!invalid!!!";
    const result = await compileRego(source);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
      const firstError = result.errors[0];
      expect(typeof firstError.line).toBe("number");
      expect(typeof firstError.column).toBe("number");
      expect(typeof firstError.message).toBe("string");
      expect(firstError.message.length).toBeGreaterThan(0);
    }
  });
});

describe("evaluateRegoPolicy returns allow, deny with messages, evidence requirement, and fail-closed on no match", () => {
  it("returns deny with messages when deny rule matches", async () => {
    const cache = createEngineCache();
    const result = await evaluateRegoPolicy(
      DENY_DEPLOY_REGO,
      "policy-deny",
      1,
      makeDeployContext(),
      cache,
    );

    expect(result.decision).toBe("deny");
    expect(result.messages).toContain("Production deploys require approval");
  });

  it("returns allow when allow rule matches", async () => {
    const cache = createEngineCache();
    const result = await evaluateRegoPolicy(
      ALLOW_EDIT_FILE_REGO,
      "policy-allow",
      1,
      makeEditFileContext(),
      cache,
    );

    expect(result.decision).toBe("allow");
    expect(result.messages).toHaveLength(0);
  });

  it("returns deny (fail-closed) when no rule matches", async () => {
    const cache = createEngineCache();
    const result = await evaluateRegoPolicy(
      NO_MATCH_REGO,
      "policy-no-match",
      1,
      makeNoMatchContext(),
      cache,
    );

    expect(result.decision).toBe("deny");
    expect(result.messages).toContain("policy produced no decision");
  });

  it("returns evidence_requirement when policy outputs it", async () => {
    const cache = createEngineCache();
    const result = await evaluateRegoPolicy(
      EVIDENCE_REQUIREMENT_REGO,
      "policy-evidence",
      1,
      makeDeployProductionContext(),
      cache,
    );

    expect(result.decision).toBe("allow");
    expect(result.evidence_requirement).toBeDefined();
    expect(result.evidence_requirement?.min_count).toBe(2);
    expect(result.evidence_requirement?.required_types).toEqual([
      "decision",
      "task",
    ]);
  });

  it("reuses cached engine on second call (same engine returned)", async () => {
    const cache = createEngineCache();
    const context = makeEditFileContext();

    await evaluateRegoPolicy(ALLOW_EDIT_FILE_REGO, "policy-cache", 1, context, cache);
    const cacheKey = "policy-cache:1";
    const engineAfterFirst = cache.get(cacheKey);

    await evaluateRegoPolicy(ALLOW_EDIT_FILE_REGO, "policy-cache", 1, context, cache);
    const engineAfterSecond = cache.get(cacheKey);

    expect(engineAfterFirst).toBeDefined();
    expect(engineAfterFirst).toBe(engineAfterSecond);
  });

  it("rejects Rego that does not declare package osabio.policy", async () => {
    const cache = createEngineCache();
    const wrongPackageRego = `package other.policy
default allow := false`;

    await expect(
      evaluateRegoPolicy(wrongPackageRego, "policy-bad-pkg", 1, makeNoMatchContext(), cache),
    ).rejects.toThrow("policy must declare package osabio.policy");
  });
});

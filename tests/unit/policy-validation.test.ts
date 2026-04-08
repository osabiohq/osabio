/**
 * Unit tests for policy creation body validation.
 *
 * Pure function tests -- no DB, no HTTP, no side effects.
 * validatePolicyCreateBody is async because it calls compileRego.
 */
import { describe, expect, it } from "bun:test";
import { validatePolicyCreateBody } from "../../app/src/server/policy/policy-validation";

const VALID_REGO = `package osabio.policy
default allow := false
allow if {
  input.action_spec.action == "read"
}`;

describe("validatePolicyCreateBody", () => {
  // -------------------------------------------------------------------------
  // Title validation
  // -------------------------------------------------------------------------

  it("rejects empty title", async () => {
    const result = await validatePolicyCreateBody({
      title: "",
      description: "Valid description",
      rego_source: VALID_REGO,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("title"))).toBe(true);
    }
  });

  it("rejects missing title (undefined cast)", async () => {
    const result = await validatePolicyCreateBody({
      title: undefined as unknown as string,
      description: "Valid description",
      rego_source: VALID_REGO,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("title"))).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Description validation
  // -------------------------------------------------------------------------

  it("rejects empty description", async () => {
    const result = await validatePolicyCreateBody({
      title: "Valid Title",
      description: "",
      rego_source: VALID_REGO,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("description"))).toBe(true);
    }
  });

  it("rejects missing description (undefined cast)", async () => {
    const result = await validatePolicyCreateBody({
      title: "Valid Title",
      description: undefined as unknown as string,
      rego_source: VALID_REGO,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("description"))).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Legacy rules field rejection
  // -------------------------------------------------------------------------

  it("rejects body with rules field", async () => {
    const result = await validatePolicyCreateBody({
      title: "Valid Title",
      description: "Valid description",
      rego_source: undefined as unknown as string,
      rules: [{ id: "r1", effect: "deny" }],
    } as unknown as { title: unknown; description: unknown; rego_source: unknown });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.toLowerCase().includes("rules"))).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // rego_source validation
  // -------------------------------------------------------------------------

  it("rejects empty rego_source", async () => {
    const result = await validatePolicyCreateBody({
      title: "Valid Title",
      description: "Valid description",
      rego_source: "",
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.toLowerCase().includes("rego_source"))).toBe(true);
    }
  });

  it("rejects missing rego_source", async () => {
    const result = await validatePolicyCreateBody({
      title: "Valid Title",
      description: "Valid description",
      rego_source: undefined as unknown as string,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.toLowerCase().includes("rego_source"))).toBe(true);
    }
  });

  it("rejects invalid Rego syntax with compilation error", async () => {
    const result = await validatePolicyCreateBody({
      title: "Valid Title",
      description: "Valid description",
      rego_source: `package osabio.policy
default allow := !!!`,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      // Must surface compile errors with line/column details
      expect(result.compileErrors).toBeDefined();
      expect(Array.isArray(result.compileErrors)).toBe(true);
      expect(result.compileErrors!.length).toBeGreaterThan(0);
      const firstError = result.compileErrors![0];
      expect(typeof firstError.line).toBe("number");
      expect(typeof firstError.column).toBe("number");
      expect(typeof firstError.message).toBe("string");
    }
  });

  it("rejects Rego with wrong package declaration", async () => {
    const result = await validatePolicyCreateBody({
      title: "Valid Title",
      description: "Valid description",
      rego_source: `package wrong.package
default allow := false`,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.toLowerCase().includes("package"))).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Null body
  // -------------------------------------------------------------------------

  it("rejects null body", async () => {
    const result = await validatePolicyCreateBody(null as unknown as { title: unknown; description: unknown; rego_source: unknown });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("request body is required"))).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Valid inputs
  // -------------------------------------------------------------------------

  it("accepts valid body with title, description, and rego_source", async () => {
    const result = await validatePolicyCreateBody({
      title: "Valid Policy",
      description: "A valid policy description",
      rego_source: VALID_REGO,
    });

    expect(result.valid).toBe(true);
  });

  it("accepts valid Rego with deny rules and evidence_requirement", async () => {
    const result = await validatePolicyCreateBody({
      title: "Complex Policy",
      description: "Policy with multiple rule types",
      rego_source: `package osabio.policy
default allow := false
deny contains msg if {
  input.budget_limit.amount > 10000
  msg := "Budget exceeds maximum threshold"
}
allow if {
  input.action_spec.action == "read"
}`,
    });

    expect(result.valid).toBe(true);
  });
});

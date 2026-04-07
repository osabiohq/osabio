import { describe, it, expect } from "bun:test";
import { compileRego } from "../../app/src/server/policy/rego-evaluator";

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

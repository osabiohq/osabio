/**
 * Pure validation functions for policy creation request bodies.
 *
 * Validates Rego source compilation via Regorus.
 * All domain errors are values — no exceptions thrown.
 */

import { compileRego, POLICY_PACKAGE_NAME, type CompileError } from "./rego-evaluator";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[]; compileErrors?: CompileError[] };

// ---------------------------------------------------------------------------
// Required package declaration
// ---------------------------------------------------------------------------

const REQUIRED_PACKAGE = POLICY_PACKAGE_NAME;

// ---------------------------------------------------------------------------
// Top-level body validation
// ---------------------------------------------------------------------------

type PolicyCreateInput = {
  title: unknown;
  description: unknown;
  rego_source: unknown;
  [key: string]: unknown;
};

const validateTitle = (title: unknown): string | undefined => {
  if (typeof title !== "string" || title.trim() === "") {
    return "title is required and must be a non-empty string";
  }
  return undefined;
};

const validateDescription = (description: unknown): string | undefined => {
  if (typeof description !== "string" || description.trim() === "") {
    return "description is required and must be a non-empty string";
  }
  return undefined;
};

const validateRegoSourcePresent = (regoSource: unknown): string | undefined => {
  if (typeof regoSource !== "string" || regoSource.trim() === "") {
    return "rego_source is required and must be a non-empty string";
  }
  return undefined;
};

const hasRequiredPackage = (regoSource: string): boolean => {
  // Check that the Rego source declares "package osabio.policy"
  // Package declaration appears as: `package osabio.policy`
  // with possible leading whitespace and optional trailing content on the line
  const escapedPackage = REQUIRED_PACKAGE.replace(/\./g, "\\.");
  const packagePattern = new RegExp(`^\\s*package\\s+${escapedPackage}\\s*$`, "m");
  return packagePattern.test(regoSource);
};

// ---------------------------------------------------------------------------
// Intent context validation (for test endpoint)
// ---------------------------------------------------------------------------

/**
 * Validates the IntentEvaluationContext shape submitted to the policy test endpoint.
 *
 * Only action_spec is required — it must be a non-null object containing
 * action (string) and provider (string). All other fields are optional.
 */
export const validateIntentContext = (
  body: unknown,
): ValidationResult => {
  if (body === null || body === undefined || typeof body !== "object") {
    return { valid: false, errors: ["request body must be an object"] };
  }

  const parsed = body as Record<string, unknown>;
  const errors: string[] = [];

  const actionSpec = parsed.action_spec;
  if (actionSpec === null || actionSpec === undefined || typeof actionSpec !== "object") {
    errors.push("action_spec is required and must be an object");
    return { valid: false, errors };
  }

  const spec = actionSpec as Record<string, unknown>;

  if (typeof spec.action !== "string" || spec.action.trim() === "") {
    errors.push("action_spec.action is required and must be a non-empty string");
  }

  if (typeof spec.provider !== "string" || spec.provider.trim() === "") {
    errors.push("action_spec.provider is required and must be a non-empty string");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
};

export async function validatePolicyCreateBody(
  body: PolicyCreateInput,
): Promise<ValidationResult> {
  if (body === null || body === undefined) {
    return { valid: false, errors: ["request body is required"] };
  }

  const errors: string[] = [];

  // Validate title
  const titleError = validateTitle(body.title);
  if (titleError) errors.push(titleError);

  // Validate description
  const descriptionError = validateDescription(body.description);
  if (descriptionError) errors.push(descriptionError);

  // Reject legacy rules field — clean break from predicate-based validation
  if ("rules" in body && body.rules !== undefined) {
    errors.push("rules field is not supported, use rego_source instead");
    return { valid: false, errors };
  }

  // Validate rego_source presence
  const regoSourceError = validateRegoSourcePresent(body.rego_source);
  if (regoSourceError) {
    errors.push(regoSourceError);
    return { valid: false, errors };
  }

  // At this point rego_source is a non-empty string
  const regoSource = body.rego_source as string;

  // Validate package declaration before attempting compilation
  if (!hasRequiredPackage(regoSource)) {
    errors.push(`policy must declare package ${REQUIRED_PACKAGE}`);
    return { valid: false, errors };
  }

  // Return any earlier errors (title/description) without attempting compilation
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Compile Rego source via Regorus WASM
  const compileResult = await compileRego(regoSource);
  if (!compileResult.success) {
    return {
      valid: false,
      errors: ["Invalid Rego syntax"],
      compileErrors: compileResult.errors,
    };
  }

  return { valid: true };
}

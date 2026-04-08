/**
 * Regorus WASM loader and Rego compilation interface.
 *
 * WASM loading strategy:
 * - Synchronous CJS require() via wasm-bindgen nodejs target
 * - Module-level promise for idempotent lazy init (safe for concurrent calls)
 * - Fail-closed: WASM load failure throws; callers catch to return deny
 */

import type { IntentEvaluationContext } from "./types";

export type CompileError = {
  line: number;
  column: number;
  message: string;
};

export type CompileResult =
  | { success: true }
  | { success: false; errors: CompileError[] };

export type RegoEvaluationResult = {
  decision: "allow" | "deny";
  messages: string[];
  evidence_requirement?: { min_count: number; required_types?: string[] };
};

// ---------------------------------------------------------------------------
// WASM module type (subset of Regorus JS bindings)
// ---------------------------------------------------------------------------

type RegorusModule = {
  Engine: new () => RegorusEngine;
};

type RegorusEngine = {
  addPolicy(path: string, rego: string): string;
  setInputJson(input: string): void;
  evalQuery(query: string): string;
  getPackages(): string[];
  free(): void;
};

// ---------------------------------------------------------------------------
// evalQuery result shape
// ---------------------------------------------------------------------------

type EvalQueryResult = {
  result?: Array<{
    expressions: Array<{
      value: unknown;
    }>;
  }>;
};

// ---------------------------------------------------------------------------
// Module-level idempotent WASM init promise
// Prohibited: module-level mutable singletons (AGENTS.md)
// Allowed: module-level promise is idempotent — concurrent calls share the
// same promise and all await the same result.
// ---------------------------------------------------------------------------

const regorusModulePromise: Promise<RegorusModule> = (async () => {
  // require() is synchronous; wrapped in promise for uniform async interface
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../../../../vendor/regorus-wasm/regorusjs") as RegorusModule;
  if (typeof mod.Engine !== "function") {
    throw new Error("Regorus WASM failed to load: Engine class not found");
  }
  return mod;
})();

// ---------------------------------------------------------------------------
// Error parsing
// ---------------------------------------------------------------------------

/**
 * Parse the Regorus error string format into structured CompileError objects.
 *
 * Format example:
 *   \n--> test.rego:2:18\n  |\n2 | default allow := !!!\n  |  ^\nerror: invalid character
 *
 * The location header pattern: `--> <file>:<line>:<column>`
 * The error message follows on the last line: `error: <message>`
 */
const parseRegorusErrorString = (errorString: string): CompileError[] => {
  const lines = errorString.split("\n");
  const errors: CompileError[] = [];

  let currentLine: number | undefined;
  let currentColumn: number | undefined;

  for (const line of lines) {
    const locationMatch = line.match(/^-->\s+\S+:(\d+):(\d+)\s*$/);
    if (locationMatch) {
      currentLine = parseInt(locationMatch[1], 10);
      currentColumn = parseInt(locationMatch[2], 10);
      continue;
    }

    const errorMessageMatch = line.match(/^error:\s+(.+)$/);
    if (errorMessageMatch) {
      errors.push({
        line: currentLine ?? 0,
        column: currentColumn ?? 0,
        message: errorMessageMatch[1].trim(),
      });
      currentLine = undefined;
      currentColumn = undefined;
    }
  }

  if (errors.length === 0 && errorString.trim().length > 0) {
    // Fallback: return the raw error as a single entry without location
    errors.push({ line: 0, column: 0, message: errorString.trim() });
  }

  return errors;
};

// ---------------------------------------------------------------------------
// Package name constant
// ---------------------------------------------------------------------------

/**
 * The Rego package name that all Osabio policies must declare.
 * Used in both compilation validation and runtime package checking.
 */
export const POLICY_PACKAGE_NAME = "osabio.policy";

/** Full data path prefix used when querying Regorus engine results. */
const POLICY_DATA_PATH = `data.${POLICY_PACKAGE_NAME}`;

// ---------------------------------------------------------------------------
// evalQuery helpers
// ---------------------------------------------------------------------------

const extractQueryValue = (queryResultJson: string): unknown => {
  const parsed = JSON.parse(queryResultJson) as EvalQueryResult;
  if (
    !parsed.result ||
    parsed.result.length === 0 ||
    !parsed.result[0].expressions ||
    parsed.result[0].expressions.length === 0
  ) {
    return undefined;
  }
  return parsed.result[0].expressions[0].value;
};

const extractAllowValue = (engine: RegorusEngine): boolean => {
  const raw = engine.evalQuery(`${POLICY_DATA_PATH}.allow`);
  const value = extractQueryValue(raw);
  return value === true;
};

const extractDenyMessages = (engine: RegorusEngine): string[] => {
  const raw = engine.evalQuery(`${POLICY_DATA_PATH}.deny`);
  const value = extractQueryValue(raw);
  // Regorus v1 serializes partial sets as {key: true} objects, not arrays.
  // Arrays are kept for forward-compatibility if Regorus changes this behavior.
  if (Array.isArray(value)) {
    return value.filter((msg): msg is string => typeof msg === "string");
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>);
  }
  return [];
};

const extractEvidenceRequirement = (
  engine: RegorusEngine,
): RegoEvaluationResult["evidence_requirement"] => {
  const raw = engine.evalQuery(`${POLICY_DATA_PATH}.evidence_requirement`);
  const value = extractQueryValue(raw);

  if (value === undefined || value === null || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.min_count !== "number") {
    console.warn(
      "[rego-evaluator] evidence_requirement.min_count is not a number — treating as no requirement",
      candidate,
    );
    return undefined;
  }

  const requiredTypes =
    Array.isArray(candidate.required_types) &&
    candidate.required_types.every((t) => typeof t === "string")
      ? (candidate.required_types as string[])
      : undefined;

  if (
    candidate.required_types !== undefined &&
    requiredTypes === undefined
  ) {
    console.warn(
      "[rego-evaluator] evidence_requirement.required_types contains non-string entries — ignoring field",
      candidate.required_types,
    );
  }

  return { min_count: candidate.min_count, required_types: requiredTypes };
};

// ---------------------------------------------------------------------------
// Decision logic (fail-closed)
// ---------------------------------------------------------------------------

const buildDecision = (
  allowValue: boolean,
  denyMessages: string[],
  evidenceRequirement: RegoEvaluationResult["evidence_requirement"],
): RegoEvaluationResult => {
  if (denyMessages.length > 0) {
    return { decision: "deny", messages: denyMessages };
  }
  if (allowValue) {
    return {
      decision: "allow",
      messages: [],
      evidence_requirement: evidenceRequirement,
    };
  }
  // Fail-closed: neither allow=true nor deny messages
  return { decision: "deny", messages: ["policy produced no decision"] };
};

// ---------------------------------------------------------------------------
// Package validation
// ---------------------------------------------------------------------------

const validatePackage = (engine: RegorusEngine): void => {
  const packages = engine.getPackages();
  if (!packages.includes(POLICY_DATA_PATH)) {
    throw new Error(`policy must declare package ${POLICY_PACKAGE_NAME}`);
  }
};

// ---------------------------------------------------------------------------
// Engine cache factory
// ---------------------------------------------------------------------------

/**
 * Create a new engine cache.
 *
 * The cache is keyed by "${policyId}:${version}" and stores pre-loaded Engine
 * instances. Pass the cache as a parameter to evaluateRegoPolicy — this avoids
 * module-level mutable state (AGENTS.md).
 */
export const createEngineCache = (): Map<string, RegorusEngine> =>
  new Map<string, RegorusEngine>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile a Rego source string using Regorus.
 *
 * Returns { success: true } when the policy parses without errors.
 * Returns { success: false; errors } with structured error locations otherwise.
 *
 * Throws only if the WASM module itself failed to load (fail-closed).
 */
export const compileRego = async (source: string): Promise<CompileResult> => {
  const regorus = await regorusModulePromise;
  const engine = new regorus.Engine();

  try {
    engine.addPolicy("policy.rego", source);
    return { success: true };
  } catch (err: unknown) {
    const errorString = typeof err === "string" ? err : String(err);
    const errors = parseRegorusErrorString(errorString);
    return { success: false, errors };
  } finally {
    engine.free();
  }
};

/**
 * Evaluate a Rego policy against the given intent evaluation context.
 *
 * Queries data.osabio.policy.allow, data.osabio.policy.deny, and
 * data.osabio.policy.evidence_requirement from the compiled engine.
 *
 * Decision logic (fail-closed):
 * - deny set non-empty → decision: "deny", messages from deny set
 * - allow=true, deny empty → decision: "allow"
 * - allow=false, deny empty → decision: "deny", messages: ["policy produced no decision"]
 *
 * The engine is cached by "${policyId}:${version}" — pass the same cache
 * across calls to reuse compiled engines for the same policy version.
 *
 * Throws if:
 * - WASM module failed to load
 * - Rego source does not declare package osabio.policy
 */
export const evaluateRegoPolicy = async (
  regoSource: string,
  policyId: string,
  version: number,
  context: IntentEvaluationContext,
  cache: Map<string, RegorusEngine>,
): Promise<RegoEvaluationResult> => {
  const regorus = await regorusModulePromise;
  const cacheKey = `${policyId}:${version}`;

  let engine = cache.get(cacheKey);

  if (!engine) {
    engine = new regorus.Engine();
    engine.addPolicy("policy.rego", regoSource);
    validatePackage(engine);
    cache.set(cacheKey, engine);
  }

  engine.setInputJson(JSON.stringify(context));

  const allowValue = extractAllowValue(engine);
  const denyMessages = extractDenyMessages(engine);
  const evidenceRequirement = extractEvidenceRequirement(engine);

  return buildDecision(allowValue, denyMessages, evidenceRequirement);
};

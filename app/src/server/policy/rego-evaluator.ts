/**
 * Regorus WASM loader and Rego compilation interface.
 *
 * WASM loading strategy:
 * - Synchronous CJS require() via wasm-bindgen nodejs target
 * - Module-level promise for idempotent lazy init (safe for concurrent calls)
 * - Fail-closed: WASM load failure throws; callers catch to return deny
 */

export type CompileError = {
  line: number;
  column: number;
  message: string;
};

export type CompileResult =
  | { success: true }
  | { success: false; errors: CompileError[] };

// ---------------------------------------------------------------------------
// WASM module type (subset of Regorus JS bindings)
// ---------------------------------------------------------------------------

type RegorusModule = {
  Engine: new () => RegorusEngine;
};

type RegorusEngine = {
  addPolicy(path: string, rego: string): string;
  free(): void;
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

# Component Boundaries: Regorus Policy Evaluation Engine

## New Components

### 1. `policy/rego-evaluator.ts` — Rego Evaluation Engine

**Responsibility**: Load Regorus WASM, compile Rego source, evaluate policies against input documents.

**Public API**:
```
compileRego(source: string) → { success: true } | { success: false, errors: CompileError[] }
evaluateRegoPolicy(regoSource: string, policyId: string, version: number, context: IntentEvaluationContext) → RegoEvaluationResult
```

**WASM Loader Pattern**:
```
// Lazy singleton — initialized on first call, reused thereafter
let wasmEngine: Engine | undefined

const getEngine = (): Engine => {
  if (!wasmEngine) {
    // Option A (preferred): Bun require() with wasm-bindgen glue
    const { Engine } = require("../../vendor/regorus-wasm/regorusjs")
    wasmEngine = new Engine()
    // Option B (fallback if require() fails for .wasm in Bun):
    // const wasmBytes = Bun.file("vendor/regorus-wasm/regorusjs_bg.wasm").arrayBuffer()
    // Initialize via WebAssembly.instantiate(wasmBytes, imports)
  }
  return wasmEngine
}
```

Walking skeleton step 0.1 determines which option works. If WASM fails to load, `getEngine()` throws — the policy gate catches this and returns `{ passed: false, reason: "WASM engine unavailable" }` (fail-closed per NFR-4).

**Engine cache**: `Map<string, Engine>` keyed by `${policyId}:${version}`. Each policy gets a dedicated Engine instance with its Rego source pre-loaded via `addPolicy()`. The cache stores compiled engines, not the WASM module itself.

**Rego output validation**: The evaluator validates `evidence_requirement` output against the expected schema (`{ min_count: number, required_types?: string[] }`). If the Rego output has wrong types (e.g., `min_count` as string), the evaluator treats it as if no evidence requirement was set and logs a structured warning.

**Package validation**: After `Engine.addPolicy(source)`, query `data.osabio.policy` — if the query returns `undefined` (meaning the policy declared a different package), reject with "policy must declare package osabio.policy". This is AST-level validation (Regorus resolves packages by path), not regex.

**Dependencies**: Regorus WASM module (vendored)

### 2. `policy/rego-validation.ts` — Rego Source Validation

**Responsibility**: Validate Rego source on policy create/update. Replaces `policy-validation.ts` predicate validation.

**Public API**:
```
validatePolicyCreateBody(body) → ValidationResult  (replaces current function)
```

**Validation rules**:
- Title and description required (unchanged)
- `rego_source` required, must be non-empty string
- `rego_source` must compile successfully via `compileRego()`
- Must declare `package osabio.policy`
- Reject if `rules` or `condition` fields are present (clean break)

**Dependencies**: `rego-evaluator.ts` (for `compileRego`)

### 3. `app/src/client/components/policy/RegoEditor.tsx` — Rego Code Editor

**Responsibility**: Replace `RuleBuilder.tsx` with a Rego text editor.

**Features**:
- Textarea with syntax highlighting (CSS-based, no heavy editor dependency)
- Field reference panel showing `IntentEvaluationContext` fields
- "Validate" button calling `POST /policies/validate` endpoint
- Inline error display with line numbers

**Dependencies**: None (pure React component)

### 4. `app/src/client/components/policy/PolicyTestPanel.tsx` — Mock Input Test Panel

**Responsibility**: Let admins test a policy against mock input JSON.

**Features**:
- JSON textarea for mock `IntentEvaluationContext`
- "Test" button calling `POST /policies/:id/test` endpoint
- Result display: allow/deny + messages

**Dependencies**: None (pure React component)

## Modified Components

### `policy/policy-gate.ts` — Policy Gate Pipeline

**Change**: Replace per-rule predicate evaluation with per-policy Rego evaluation.

**Before**: Flatten all rules across policies → sort by priority → evaluate each rule's condition → short-circuit on deny.

**After**: Sort policies by priority (derived from policy metadata, not individual rules) → evaluate each policy's `rego_source` → short-circuit on deny.

The pipeline structure stays the same (effect boundary → pure pipeline → result builder). The granularity changes from rule-level to policy-level evaluation.

### `policy/types.ts` — Type Definitions

**Remove**: `RulePredicate`, `RuleCondition`, `PolicyRule` (entire type)
**Add to `PolicyRecord`**: `rego_source: string`
**Remove from `PolicyRecord`**: `rules: PolicyRule[]`
**Keep unchanged**: `PolicyGateResult`, `PolicyTraceEntry`, `PolicyGateWarning`, `PolicyEvidenceRequirements`, `IntentEvaluationContext`, `PolicySelector`, `PolicyStatus`

Note: `PolicyTraceEntry.rule_id` becomes the policy ID (one trace entry per policy, not per rule). The field name stays for backward compatibility with intent trace consumers. Add inline comment: `rule_id: string; // For Rego policies: contains policy ID. Field name kept for trace format compatibility.`

### `policy/policy-route.ts` — HTTP Routes

**Change create handler**: Accept `rego_source` string instead of `rules` array.
**Add endpoint**: `POST /api/workspaces/:workspaceId/policies/:id/test` — evaluate policy against mock input.
**Add endpoint**: `POST /api/workspaces/:workspaceId/policies/validate` — compile Rego source without creating policy.

### `policy/policy-validation.ts` — Request Validation

**Replace entirely**: Predicate validation → Rego compilation validation.

## Deleted Components

| File | Reason |
|---|---|
| `policy/predicate-evaluator.ts` | Replaced by `rego-evaluator.ts` |
| `app/src/client/components/policy/RuleBuilder.tsx` | Replaced by `RegoEditor.tsx` |

## Dependency Graph

```
policy-route.ts
  ├─→ rego-validation.ts (create/update validation)
  │     └─→ rego-evaluator.ts (compileRego)
  ├─→ policy-gate.ts (test endpoint)
  │     └─→ rego-evaluator.ts (evaluateRegoPolicy)
  └─→ policy-queries.ts (CRUD, unchanged)

intent/authorizer.ts
  └─→ policy-gate.ts (evaluatePolicyGate, unchanged signature)
        └─→ rego-evaluator.ts (evaluateRegoPolicy)
              └─→ vendor/regorus-wasm/ (WASM module)
```

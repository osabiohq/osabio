# Requirements: Regorus Policy Evaluation Engine

## Functional Requirements

### FR-1: Regorus WASM Integration
- The system must load the Regorus WASM module and expose a `RegoEvaluator` that compiles Rego source and evaluates it against an input document.
- The WASM module must be loaded once per process and reused across evaluations.
- Compiled Rego modules should be cached by policy ID + version to avoid recompilation on every intent.

### FR-2: Rego Source Storage
- The `policy` table must replace `condition` (predicate rules) with a `rego_source` text field containing inline Rego code.
- The predicate evaluator (`predicate-evaluator.ts`) and its validation are removed entirely.
- Existing predicate-based policies are discarded (no backward compatibility per project convention — see `docs/agents/surrealdb.md`).

### FR-3: Rego Policy Evaluation
- The policy gate must evaluate all policies using Regorus.
- The `IntentEvaluationContext` must be passed as the Rego `input` document. The schema is defined in `policy/types.ts` — required fields: `goal`, `reasoning`, `priority`, `action_spec` (with `provider` and `action`), `requester_type`. Optional fields: `budget_limit`, `authorization_details`, `requester_role`, `behavior_scores`. Rego handles undefined field access gracefully (returns `undefined`, does not error), so optional fields don't need special handling.
- The evaluator must query `data.osabio.policy.allow` (boolean) and `data.osabio.policy.deny` (set of message strings).
- If `deny` is non-empty, the policy gate returns `passed: false` with the deny messages.
- If `allow` is true and `deny` is empty, the policy gate returns `passed: true`.
- If neither `allow` nor `deny` match, default to deny (fail-closed).
- **Evaluation order**: Policies are evaluated in priority order (highest first). First deny short-circuits — once any policy denies, evaluation stops and the intent is rejected.

### FR-4: Policy Trace Compatibility
- Rego policy evaluations must produce `PolicyTraceEntry[]` compatible with existing intent evaluation traces.
- Each Rego policy evaluation produces one trace entry with `policy_id`, `policy_version`, `effect` (allow/deny), `matched`, and `priority`.

### FR-5: Rego Compilation Validation
- Policy creation and update endpoints must compile the `rego_source` using Regorus before accepting the policy.
- Compilation errors must be returned with line number, column, and error message.
- Invalid Rego must be rejected with HTTP 400.

### FR-6: Rego Editor UI
- The policy creation dialog must replace the `RuleBuilder` component with a Rego text editor.
- The editor must provide syntax highlighting for Rego.
- A "Validate" button must call the backend to compile the Rego source and display inline errors.
- A field reference panel must show available `IntentEvaluationContext` fields.

### FR-7: Policy Test Endpoint
- A `POST /api/workspaces/:workspaceId/policies/:id/test` endpoint must accept a mock `IntentEvaluationContext` and return the Rego evaluation result (allow/deny + messages).
- The test panel in the policy detail UI must let admins enter mock input JSON and see evaluation results.

## Non-Functional Requirements

### NFR-1: Evaluation Latency
- Rego policy evaluation must complete in under 5ms per policy (p99) for typical governance rules.
- WASM module loading must complete in under 500ms (cold start, once per process).

### NFR-2: Memory
- Cached compiled Rego modules must not exceed 50MB total per process.
- The WASM module itself is ~2MB.

### NFR-3: Security
- Rego policies execute in the WASM sandbox -- no access to filesystem, network, or process state.
- The `input` document is the only data available to Rego policies (no `data` document beyond what the evaluator explicitly provides).

### NFR-4: Reliability
- If the Regorus WASM module fails to load (cold start failure), the policy gate returns deny (fail-closed) with an error message indicating WASM unavailability.

## Constraints

- **Inline storage only**: Rego source is stored as text in the `policy` record. No `.rego` file management.
- **No base policies**: Built-in Rego packages are deferred to a future iteration.
- **No policy bundles**: Package/import composition across policies is deferred.
- **`human_veto_required` stays as metadata**: It is not a Rego output field.
- **Fail-closed default**: If Rego evaluation produces neither allow nor deny, the intent is denied.
- **No backward compatibility**: Existing predicate-based policies are discarded. Breaking schema change.

## Open Design Questions (for DESIGN wave)

- How to structure the Rego `data` document if behavior scores or workspace context need to be pre-loaded beyond `IntentEvaluationContext`?
- Should compiled Rego modules be cached in a global Map or a per-workspace LRU cache?
- What Rego package convention to enforce (e.g., `package osabio.policy` required)?

# Shared Artifacts Registry

## Artifacts

| ID | Type | Description | Produced By | Consumed By |
|----|------|-------------|-------------|-------------|
| `rego_source` | `string` | Rego policy source code stored inline in policy record | Admin (Rego editor) | Regorus compiler, policy gate evaluator, test panel, version diff view |
| `policy_meta` | `object` | Title, description, selector, `human_veto_required`, `max_ttl` | Admin (create/edit dialog) | Policy CRUD route, SurrealDB policy record |
| `compile_result` | `object` | Regorus compilation output: success or `{ errors: [{ line, column, message }] }` | Regorus WASM engine | Rego editor (inline diagnostics), create/update validation |
| `test_result` | `object` | `{ decision: "allow" \| "deny", messages: string[], trace: object }` | Regorus evaluation against mock input | Test panel UI |
| `policy_record` | `RecordId<"policy">` | SurrealDB policy row with `rego_source` field | Policy CRUD route | Policy gate, policy detail page, version chain |
| `governing_edge` | `relation` | `identity -> governing -> policy` | Policy activation route | Policy loading (active policies for identity) |
| `protects_edge` | `relation` | `policy -> protects -> workspace` | Policy activation route | Policy loading (active policies for workspace) |
| `policy_trace` | `PolicyTraceEntry[]` | Evaluation trace recorded on `intent.evaluation.policy_trace` | Policy gate (Regorus evaluation) | Intent detail view, feed cards, audit queries |
| `intent_context` | `IntentEvaluationContext` | Input document assembled from intent + behavior scores | Intent authorization pipeline | Regorus evaluation as `input` document |
| `wasm_engine` | `RegorusEngine` | Loaded Regorus WASM instance (cached per-process) | WASM initialization on first use | All policy evaluations |

## Source-of-Truth Rules

- `rego_source` is stored **inline** in the `policy` table as a text field. No separate `.rego` files.
- `human_veto_required` remains a **metadata field** on the policy record, not a Rego output.
- `compile_result` is transient (validation-time only), not persisted.
- `test_result` is transient (test-time only), not persisted.
- `wasm_engine` is a process-level singleton, not per-request.

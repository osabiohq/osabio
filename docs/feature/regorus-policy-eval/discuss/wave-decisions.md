# DISCUSS Decisions -- regorus-policy-eval

## Key Decisions
- [D1] Store Rego source inline in policy records: simpler than file-based management, no sync needed, version control via existing policy versioning (see: requirements.md FR-2)
- [D2] Expose Rego authoring in the Policy Management UI: workspace admins need self-service policy creation, not developer-gated CLI workflows (see: user-stories.md US-2.1)
- [D3] Keep `human_veto_required` as metadata on policy record: it's a governance control about the policy, not a policy evaluation outcome -- mixing it into Rego output conflates policy logic with enforcement strategy (see: shared-artifacts-registry.md)
- [D4] No base/built-in Rego packages in initial scope: keep scope tight, add composable packages in a future iteration (see: story-map.md "Deferred")
- [D5] Fail-closed default: if Rego evaluation produces neither allow nor deny, the intent is denied (see: requirements.md FR-3)
- [D6] No backward compatibility: predicate evaluator is removed entirely, existing predicate-based policies discarded. Breaking schema change per project convention (see: docs/agents/surrealdb.md)
- [D7] `condition` field replaced by `rego_source`: clean cut, no dual-path evaluation (see: requirements.md FR-2)

## Alternatives Considered
- **A: Enhance predicate evaluator** -- add set operations (`any_of`, `all_of`), aggregation operators, cross-field comparisons. Rejected: leads to operator explosion (each new capability = new operator + validation + UI control). The predicate evaluator becomes a poorly-designed DSL that still can't match Rego's expressiveness (comprehensions, custom functions, nested logic).
- **B: CEL (Common Expression Language)** -- Google's expression language, used in Kubernetes admission policies. Lighter than Rego but less expressive (no built-in policy composition, no test framework). Would still need a WASM/native binding.
- **C: Rego via Regorus WASM (chosen)** -- industry standard for policy-as-code, 150+ builtins, composable packages, built-in test framework, VS Code extension. Microsoft-maintained Rust implementation compiles to WASM for in-process evaluation. Sub-millisecond latency. Full ecosystem of tooling.
- **D: OPA sidecar** -- run OPA as a separate process. Rejected: adds network hop latency, operational complexity (deploy + manage OPA alongside Osabio), and failure mode (OPA unavailable = all intents blocked or bypassed).

## Requirements Summary
- Primary need: replace limited 9-operator predicate evaluator with Rego for complex governance rules (set operations, aggregations, cross-field comparisons)
- Walking skeleton scope: load WASM, store Rego, evaluate during intent auth, acceptance test
- Feature type: cross-cutting (backend engine, schema, UI, authorization pipeline)

## Constraints Established
- Inline Rego storage only (no `.rego` file management)
- `human_veto_required` is record metadata, not Rego output
- No policy bundles or package imports in this iteration
- No base/built-in Rego packages
- `PolicyGateResult` and `PolicyTraceEntry` types must not change
- No backward compatibility -- clean replacement of predicate evaluator

## Upstream Changes
- No DISCOVER wave artifacts to contradict. All decisions grounded in GitHub issue #194 and current codebase analysis.

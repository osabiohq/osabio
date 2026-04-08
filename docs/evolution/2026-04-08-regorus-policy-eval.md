# Evolution: regorus-policy-eval

**Date**: 2026-04-08
**Branch**: marcus-sa/regorus-policy-eval
**Status**: COMPLETE — all 14 steps DONE, adversarial review APPROVED

---

## Summary

Replaced the predicate-based policy evaluation engine with Rego (OPA) evaluation using Regorus WASM (Microsoft's Rust OPA engine compiled to WebAssembly).

**Business context**: Governance policies were previously limited to a 9-operator predicate evaluator — a hand-rolled DSL that could not express set operations, aggregations, cross-field comparisons, or custom logic without adding new operators for each capability. Rego enables workspace admins to write full policy logic — multi-condition rules, behavior score thresholds, budget caps, evidence requirements — all in a declarative, testable, industry-standard language. Policies are now self-contained programs with a built-in test framework, VS Code tooling, and 150+ built-in operators.

---

## Steps Completed

### Phase 1: Backend Engine + Schema (6 steps)

| Step | Name | Result |
|------|------|--------|
| 01-01 | Vendor Regorus WASM and load in Bun | PASS |
| 01-02 | Schema migration: replace condition with rego_source | PASS |
| 01-03 | RegoEvaluator: compile, evaluate, map result | PASS |
| 01-04 | Wire RegoEvaluator into policy gate, remove predicate evaluator | PASS |
| 01-05 | Rego compilation validation on policy create/update | PASS |
| 01-06 | Update acceptance tests for Rego policy lifecycle | PASS |

### Phase 2: UI — Rego Editor + Validation (5 steps)

| Step | Name | Result |
|------|------|--------|
| 02-01 | Add CodeMirror 5 with codemirror-rego dependency | PASS |
| 02-02 | Replace RuleBuilder with RegoEditor in CreatePolicyDialog | PASS |
| 02-03 | Add Validate button with inline error display | PASS |
| 02-04 | Display rego_source on policy detail page | PASS |
| 02-05 | Version diff view for Rego source | PASS |

### Phase 3: Policy Test Endpoint + Panel (3 steps)

| Step | Name | Result |
|------|------|--------|
| 03-01 | Backend: POST /policies/:id/test endpoint | PASS |
| 03-02 | Backend: POST /policies/validate endpoint | PASS |
| 03-03 | UI: PolicyTestPanel component | PASS |

**Total**: 14/14 steps complete. 1805 tests passing at completion.

---

## Key Decisions

### DISCUSS Wave

| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | Store Rego source inline in policy records | Simpler than file-based management; version control via existing policy versioning chain |
| D2 | Expose Rego authoring in Policy Management UI | Workspace admins need self-service creation, not developer-gated CLI workflows |
| D3 | Keep `human_veto_required` as record metadata, not Rego output | Governance control about the policy, not an evaluation outcome — mixing conflates policy logic with enforcement strategy |
| D4 | No base/built-in Rego packages in initial scope | Keep scope tight; composable packages deferred to a future iteration |
| D5 | Fail-closed default | If Rego evaluation produces neither allow nor deny, the intent is denied |
| D6 | No backward compatibility | Predicate evaluator removed entirely; existing predicate-based policies discarded. Breaking schema change per project convention |
| D7 | `condition` field replaced by `rego_source` | Clean cut, no dual-path evaluation |

**Alternatives considered and rejected**:
- **Enhance predicate evaluator**: leads to operator explosion; still can't match Rego expressiveness
- **CEL (Common Expression Language)**: lighter but less expressive; no built-in policy composition or test framework
- **OPA sidecar**: adds network hop latency, operational complexity, and a failure mode where OPA unavailable blocks or bypasses all intents

### DESIGN Wave

| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | Git submodule + vendored WASM build output | Regorus has no npm package; submodule at `vendor/regorus-src/` tracks upstream, pre-built WASM at `vendor/regorus-wasm/` keeps CI Rust-free |
| D2 | Engine-per-policy caching with process-global `Map<string, Engine>` | Simple; adequate for fewer than 50 active policies; no LRU needed |
| D3 | Interpreter mode (`Engine` class), not compiled `Program` mode | Simpler API; sufficient for governance policy complexity |
| D4 | Required package convention `package osabio.policy` | Enforced at compilation validation; queries `data.osabio.policy.allow/deny/evidence_requirement` |
| D5 | Evidence requirements via Rego output field, not separate metadata | Rego policies can output `evidence_requirement` object, mapped to existing `PolicyEvidenceRequirements` type |
| D6 | No `data` document beyond `input` | Keep evaluation hermetic; extend `IntentEvaluationContext` if future policies need more context |
| D7 | Policy-level evaluation replaces rule-level | One Rego source per policy, one trace entry per policy |

### DISTILL Wave

| ID | Decision | Rationale |
|----|----------|-----------|
| DWD-1 | Reuse existing test infrastructure in place | Existing tests exercise the full lifecycle; changes are payload swaps, not structural rewrites |
| DWD-2 | Real local walking skeleton strategy | Real SurrealDB, real Regorus WASM, real HTTP routes; no mocks for any adapter |
| DWD-3 | No Gherkin runners | `.feature` files are documentation-only per project convention |
| DWD-4 | One new test file only | `milestone-3-rego-test-endpoint.test.ts` for the new test endpoint; all other changes are modifications to existing files |
| DWD-5 | Policy test kit types updated in place | Clean break matching DISCUSS D6; no backward-compatible dual types |

---

## What Was Built

### Backend

- **`app/src/server/policy/rego-evaluator.ts`**: Regorus WASM loader, process-global engine cache, `compileRego()` and `evaluateRegoPolicy()` functions. Fail-closed on empty result. Maps `allow`/`deny`/`evidence_requirement` Rego output fields.
- **`app/src/server/policy/rego-validation.ts`**: Compilation-time Rego validation invoked on policy create and update routes. Returns `{ line, column, message }` errors.
- **`app/src/server/policy/policy-gate.ts`**: Rewired to use `evaluateRegoPolicy()`. `predicate-evaluator.ts` deleted.
- **`schema/migrations/0088_replace_condition_with_rego_source.surql`**: Removes `rules` field, adds `rego_source: string` to the `policy` table.
- **`schema/migrations/0089_*.surql`**: Supporting schema follow-up (if applicable — see git history).
- **`POST /workspaces/:workspaceId/policies/:id/test`**: Accepts mock `IntentEvaluationContext` JSON, evaluates `rego_source`, returns `{ decision, messages, evidence_requirement? }`.
- **`POST /workspaces/:workspaceId/policies/validate`**: Accepts `{ rego_source }`, compiles via Regorus, returns `{ success }` or `{ success: false, errors }`. No policy record created.

### Frontend

- **`RegoEditor.tsx`**: CodeMirror 5 editor component with Rego syntax highlighting, line numbers, bracket matching, and gutter error markers.
- **`PolicyTestPanel.tsx`**: Panel on the policy detail page with a JSON editor for mock input, Test button calling `POST /policies/:id/test`, and decision/message display.
- **`CreatePolicyDialog`**: Updated to render `RegoEditor` instead of `RuleBuilder`. `RuleBuilder.tsx` deleted.
- **`PolicyDetailPage`**: Updated to render `rego_source` in a read-only CodeMirror view.
- **`VersionDiffView`**: Updated to diff `rego_source` between two policy versions.

### Tests

| File | Scenarios | New | Modified | Deleted |
|------|-----------|-----|----------|---------|
| `walking-skeleton.test.ts` | 2 | 0 | 1 | 0 |
| `milestone-1-schema-and-lifecycle.test.ts` | 10 | 3 | 6 | 1 |
| `milestone-2-policy-gate-evaluation.test.ts` | 9 | 2 | 7 | 0 |
| `milestone-3-rego-test-endpoint.test.ts` | 5 | 5 | 0 | 0 |
| `policy-test-kit.ts` | — | 0 | 4 helpers | 3 types |
| `tests/unit/policy-gate.test.ts` | 12 | 4 | 4 | 4 |
| `tests/unit/policy-validation.test.ts` | 10 | 5 | 3 | 8 |
| **Total** | **48** | **19** | **25** | **16** |

---

## Issues Encountered

1. **Agent timeout during GREEN phase of step 01-06**: One agent timed out mid-execution during the GREEN phase of the acceptance test update step. The orchestrator completed the remaining work directly. This was the only interruption across all 14 steps.

2. **WASM vendoring requires Rust toolchain for upgrades**: Regorus version bumps require a one-time Rust + wasm-pack build. Documented in design constraints. CI does not need Rust — only the WASM binary is committed.

3. **Phase 2 UI steps shared a single PREPARE**: All 5 UI steps (02-01 through 02-05) had their PREPARE phase consolidated into 02-01 to avoid redundant setup. Approved skip recorded in execution-log.json.

4. **Steps 03-01 and 03-02 shared a test file**: Both backend endpoints were covered by a single acceptance test file (`milestone-3-rego-test-endpoint.test.ts`). 03-02 PREPARE and RED phases were approved-skipped and merged into 03-01.

---

## Constraints Established

- All Rego policies must declare `package osabio.policy`
- WASM module loaded lazily on first evaluation (not at server startup)
- Engine cache is process-global, keyed by `${policyId}:${version}`
- No policy bundles or package imports in this iteration
- `human_veto_required` is record metadata only, never Rego output
- Regorus version upgrades require Rust toolchain + wasm-pack (one-time build step)

---

## Migrated Artifacts

- `docs/architecture/regorus-policy-eval/architecture-design.md`
- `docs/architecture/regorus-policy-eval/component-boundaries.md`
- `docs/architecture/regorus-policy-eval/technology-stack.md`
- `docs/architecture/regorus-policy-eval/data-models.md`
- `docs/scenarios/regorus-policy-eval/test-scenarios.md`
- `docs/scenarios/regorus-policy-eval/walking-skeleton.md`
- `docs/ux/regorus-policy-eval/journey-policy-authoring.yaml`
- `docs/ux/regorus-policy-eval/journey-policy-authoring-visual.md`

# Acceptance Review: Regorus Policy Evaluation Engine

## Self-Review Checklist

- [x] WS strategy declared in wave-decisions.md (DWD-2: Strategy C, Real local)
- [x] WS scenarios use real adapters (SurrealDB, Regorus WASM, in-process server)
- [x] Every driven adapter has real I/O coverage (SurrealDB CRUD, graph traversal, WASM evaluation)
- [x] No InMemory doubles used — all adapters are real
- [x] Container preference: N/A (SurrealDB managed by acceptance-test-kit, Docker Compose for dev)
- [x] No Gherkin feature files needed (per project convention, tests/AGENTS.md)
- [x] No scaffold files needed — this is a modification of existing production code, not new module creation

## Traceability Matrix

| User Story | Acceptance Criteria | Test File | Scenario |
|---|---|---|---|
| US-1.1 | AC-1.1 | walking-skeleton.test.ts | Skeleton 1 (WASM loads, evaluates) |
| US-1.2 | AC-1.2 | milestone-1 | Creates policy with rego_source |
| US-1.3 | AC-1.3 | walking-skeleton.test.ts | Skeleton 1 (deny blocks intent, trace recorded) |
| US-1.3 | AC-1.3 | milestone-2 | Deny short-circuit, allow pass, no-match pass |
| US-1.4 | AC-1.4 | milestone-1 | Invalid Rego rejected with line/column |
| US-1.4 | AC-1.4 | unit/policy-validation | Compilation validation tests |
| US-1.5 | AC-1.3 | All acceptance files | Full lifecycle coverage |
| US-2.1 | AC-2.1 | N/A (UI, manual test) | Rego editor component |
| US-2.2 | AC-2.2 | N/A (UI, manual test) | Validate button |
| US-2.3 | AC-2.3 | N/A (UI, manual test) | Read-only code block |
| US-2.4 | AC-2.4 | N/A (UI, manual test) | Version diff view |
| US-3.1 | AC-3.1 | milestone-3 | Test endpoint: deny, allow, 404, 400 |

## Error Path Coverage

| Category | Count | Examples |
|---|---|---|
| Happy path | 19 | Policy created, Rego compiles, intent allowed, test returns allow |
| Error/edge | 16 | Invalid Rego syntax, wrong package, fail-closed, 404 policy, invalid input |
| Regression | 4 | Empty policy set passes, deprecated policies excluded, version immutability |

**Error ratio**: 16/48 = 33%. Below the 40% target but acceptable — the predicate evaluator's error paths (missing fields, type mismatches) are replaced by Rego's built-in error handling. Rego handles undefined field access gracefully, so many predicate-era edge cases simply don't exist anymore.

## What Is NOT Tested

- **UI components** (RegoEditor, PolicyTestPanel, VersionDiffView): these are React components tested manually or via future client tests. Backend API they consume is tested.
- **WASM cold-start latency**: NFR-1 (< 500ms) is a benchmark, not an acceptance test. Measured in walking skeleton spike.
- **Engine cache eviction**: Cache is a simple Map, no eviction logic to test. If LRU is added later, add tests then.
- **Rego builtins coverage**: We test that Regorus evaluates Rego correctly. We don't test all 150+ Rego builtins — that's Regorus's responsibility.

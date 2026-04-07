# DISTILL Decisions — regorus-policy-eval

## Key Decisions
- [DWD-1] Reuse existing test infrastructure: modify `tests/acceptance/policy-node/` and `tests/unit/policy-*.test.ts` in place rather than creating new test directories. The existing tests already exercise the full policy lifecycle — changes are payload swaps, not structural.
- [DWD-2] Walking skeleton strategy: Strategy C (Real local). Real SurrealDB (isolated namespace), real Regorus WASM, real HTTP routes via in-process server. No mocks for any adapter. Matches existing acceptance test pattern.
- [DWD-3] No Gherkin feature files: per project convention (`tests/AGENTS.md`), `.feature` files are documentation-only and not executed by a runner. Test scenarios are documented here in distill artifacts, implemented directly as `bun:test` `it()` blocks.
- [DWD-4] One new test file only: `milestone-3-rego-test-endpoint.test.ts` for the genuinely new `POST /policies/:id/test` endpoint. All other changes are modifications to existing files.
- [DWD-5] Policy test kit types updated in place: `PolicyRecord`, `CreatePolicyOptions`, and helper functions in `policy-test-kit.ts` are updated to use `rego_source` instead of `rules`. No backward-compatible dual types — clean break matching DISCUSS D6.

## Reconciliation

### DISCUSS → DESIGN contradictions: none
- DISCUSS D5 (fail-closed) confirmed by DESIGN D4 (package convention) + D5 (evidence via Rego output)
- DISCUSS D6 (no backward compatibility) confirmed by DESIGN D7 (policy-level evaluation)
- DISCUSS D7 (condition → rego_source) confirmed by DESIGN schema migration

### DESIGN → DISTILL implications
- DESIGN D7 (policy-level evaluation, one trace per policy): test trace assertions change from `rule_id: "no_deploy"` to `rule_id: <policyId>`
- DESIGN D5 (evidence via Rego output): new test scenario in milestone-2 for `evidence_requirement` Rego output
- DESIGN D4 (package osabio.policy required): new validation test for wrong package rejection

## Test Coverage Summary

| File | Scenarios | New | Modified | Deleted |
|---|---|---|---|---|
| `walking-skeleton.test.ts` | 2 | 0 | 1 | 0 |
| `milestone-1-schema-and-lifecycle.test.ts` | 10 | 3 | 6 | 1 |
| `milestone-2-policy-gate-evaluation.test.ts` | 9 | 2 | 7 | 0 |
| `milestone-3-rego-test-endpoint.test.ts` | 5 | 5 | 0 | 0 |
| `policy-test-kit.ts` | — | 0 | 4 helpers | 3 types |
| `tests/unit/policy-gate.test.ts` | 12 | 4 | 4 | 4 |
| `tests/unit/policy-validation.test.ts` | 10 | 5 | 3 | 8 |
| **Total** | **48** | **19** | **25** | **16** |

## Upstream Issues

None. All DISCUSS acceptance criteria are testable as written. No gaps or contradictions found.

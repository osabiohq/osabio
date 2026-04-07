# Story Map: Regorus Policy Evaluation Engine

## Backbone (User Activities)

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   Integrate  │   │   Evaluate   │   │   Author     │   │   Validate   │
│   Regorus    │   │   Rego       │   │   Rego UI    │   │   & Test     │
│   WASM       │   │   Policies   │   │              │   │              │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
```

## Walking Skeleton (Slice 0 -- end-to-end with minimal scope)

The thinnest possible slice that proves Regorus evaluates a Rego policy inline during intent authorization:

| # | Story | Layer |
|---|-------|-------|
| 0.1 | Load Regorus WASM, compile a hardcoded Rego string, query it | Backend |
| 0.2 | Replace `condition` with `rego_source` in policy schema | Backend + Schema |
| 0.3 | Build `RegoEvaluator` that takes `rego_source` + `IntentEvaluationContext` and returns allow/deny | Backend |
| 0.4 | Wire `RegoEvaluator` into `evaluatePolicyGate`, remove predicate evaluator | Backend |
| 0.5 | Acceptance test: create policy with Rego, create intent, verify deny/allow | Test |

## Release Slice 1: Backend Engine + Schema

| # | Story | Est. | Depends On |
|---|-------|------|------------|
| 1.1 | Add Regorus WASM npm dependency and initialization wrapper | 1d | -- |
| 1.2 | Schema migration: replace `condition` with `rego_source` text field on `policy` table | 1d | -- |
| 1.3 | `RegoEvaluator`: compile Rego source, build input document, query allow/deny, map to `PolicyGateResult` | 2d | 1.1 |
| 1.4 | Wire `RegoEvaluator` into `evaluatePolicyGate`, remove `predicate-evaluator.ts` and predicate validation | 1d | 1.2, 1.3 |
| 1.5 | Rego compilation validation on policy create/update (reject invalid Rego with line/column errors) | 1d | 1.1 |
| 1.6 | Acceptance tests: Rego policy lifecycle (create draft, activate, evaluate intent, check trace) | 1d | 1.4 |

## Release Slice 2: UI -- Rego Editor + Validation

| # | Story | Est. | Depends On |
|---|-------|------|------------|
| 2.1 | Replace `RuleBuilder` with Rego editor (textarea with syntax highlighting + field reference panel) | 2d | Slice 1 |
| 2.2 | Add "Validate" button that calls backend compile endpoint, shows inline errors | 1d | 1.5 |
| 2.3 | Policy detail page: display `rego_source` in read-only code block | 0.5d | 2.1 |
| 2.4 | Version diff view: show Rego source diff between policy versions | 1d | 2.3 |

## Release Slice 3: Test Panel

| # | Story | Est. | Depends On |
|---|-------|------|------------|
| 3.1 | Backend + UI: `/policies/:id/test` endpoint + test panel with JSON editor | 2d | Slice 1 |

## Deferred (Not in Scope)

- Base/built-in Rego packages (common deny rules, default-deny)
- Policy bundles / package imports across policies
- `.rego` file sync to DB (decided: inline storage only)
- Partial evaluation optimization

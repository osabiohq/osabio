# Test Scenarios: Regorus Policy Evaluation Engine

## Strategy

Reuse existing policy test infrastructure. The acceptance tests in `tests/acceptance/policy-node/` and unit tests in `tests/unit/policy-*.test.ts` already exercise the full policy lifecycle. Changes are mechanical: swap predicate `rules`/`condition` payloads for `rego_source` strings.

No new test directories. No new walking skeleton files. One new milestone file for the genuinely new test endpoint.

## Modified Test Files

### `tests/acceptance/policy-node/policy-test-kit.ts`

**Types**: Replace `PolicyRule`, `RuleCondition`, `RulePredicate` with `rego_source: string` on `PolicyRecord`. Update `CreatePolicyOptions` to accept `rego_source: string` instead of `rules: PolicyRule[]`.

**Helpers**: Update `createPolicy()`, `createPolicyVersion()` to pass `rego_source` content. Remove predicate-specific types.

### `tests/acceptance/policy-node/walking-skeleton.test.ts`

| Scenario | Change |
|---|---|
| Skeleton 1: deny policy blocks deploy intent | Replace predicate `rules` with Rego: `package osabio.policy; deny contains msg if { input.action_spec.action == "deploy"; msg := "deploy blocked" }` |
| Skeleton 2: empty policy set passes through | No change (no rules/rego involved) |

Trace assertions: `rule_id` becomes the policy ID (one trace entry per policy).

### `tests/acceptance/policy-node/milestone-1-schema-and-lifecycle.test.ts`

| Scenario | Change |
|---|---|
| Creates policy with all required fields | `rego_source` instead of `rules` array. Assert `rego_source` persisted. |
| Rejects invalid effect value | Replace with: rejects invalid Rego syntax (compilation error). |
| Rejects invalid status | No change (status validation is SurrealDB-level). |
| Activates draft policy with graph edges | `rego_source` in `createPolicy()`. Rest unchanged. |
| Deprecating policy removes edges | `rego_source` in `createPolicy()`. Rest unchanged. |
| Governing/protects edge timestamps | `rego_source` in `createPolicy()`. Rest unchanged. |
| Version supersedes old version | `createPolicyVersion()` takes `newRegoSource` instead of `newRules`. Assert `rego_source` on both versions. |

**New scenarios** (added to milestone-1):

| Scenario | Driving Port | What it tests |
|---|---|---|
| Rejects policy with invalid Rego syntax | `createPolicy()` via DB | Rego compilation check returns line/column errors |
| Rejects policy with wrong package declaration | `createPolicy()` via DB | `package other.pkg` rejected, must be `package osabio.policy` |
| Rejects policy that includes legacy `rules` field | `POST /policies` route | Clean break: `rules` field presence = HTTP 400 |

### `tests/acceptance/policy-node/milestone-2-policy-gate-evaluation.test.ts`

| Scenario | Change |
|---|---|
| Loads policies from identity and workspace edges | `rego_source` in both policies. |
| Excludes deprecated policies | `rego_source` in `createPolicy()`. |
| Deny at higher priority short-circuits | Rego deny policy replaces predicate deny rule. Trace: `rule_id` = policy ID. |
| Allow rules pass when no deny matches | Rego allow policy. |
| No rule matches = pass | Rego deny-deploy policy, agent submits non-deploy intent. Rego `deny` set is empty → pass. |
| Human veto forces veto window | `rego_source` in `createPolicy()`. `human_veto_required` stays as record metadata. |
| Empty policy set passes gate | No change. |

**New scenarios** (added to milestone-2):

| Scenario | Driving Port | What it tests |
|---|---|---|
| Fail-closed: Rego produces neither allow nor deny | `evaluatePolicyGate()` | Rego with no matching rules and `default allow := false` → denied |
| Evidence requirement via Rego output | `evaluatePolicyGate()` | Rego outputs `evidence_requirement` object → mapped to `PolicyEvidenceRequirements` |

### `tests/unit/policy-gate.test.ts`

| Section | Change |
|---|---|
| `deduplicatePolicies` | `rego_source` on `makePolicyRecord`. Tests unchanged. |
| `collectAndSortRules` | **Delete** — rule-level sorting is gone. |
| `evaluateRulesAgainstContext` | **Delete** — predicate evaluation is gone. |
| `buildGateResult` | `rego_source` on policy records. Keep all tests. |
| `extractEvidenceRequirements` | **Rewrite** — evidence comes from Rego output, not rule effect type. |
| `evaluatePolicyGate` integration | Update mock surreal to return `rego_source` policies. |

**New unit test sections**:

| Section | What it tests |
|---|---|
| `compileRego` | Valid Rego compiles. Invalid Rego returns errors with line/column. Wrong package rejected. |
| `evaluateRegoPolicy` | Allow result. Deny result with messages. Fail-closed (no match). Evidence requirement output. Missing optional input fields handled gracefully. |

### `tests/unit/policy-validation.test.ts`

**Replace entirely**. All predicate validation tests become Rego compilation validation tests:

| Scenario | What it tests |
|---|---|
| Rejects empty `rego_source` | Non-empty string required |
| Rejects missing `rego_source` | Field required |
| Rejects invalid Rego syntax | Compilation error with line/column |
| Rejects wrong package | Must be `package osabio.policy` |
| Rejects body with `rules` field | Clean break, legacy field rejected |
| Accepts valid Rego | Happy path |
| Accepts valid body with title + description + rego_source | Full valid payload |
| Rejects empty title | Unchanged |
| Rejects empty description | Unchanged |
| Rejects null body | Unchanged |

## New Test File

### `tests/acceptance/policy-node/milestone-3-rego-test-endpoint.test.ts`

New functionality — `POST /api/workspaces/:workspaceId/policies/:id/test` endpoint.

| Scenario | Driving Port | What it tests |
|---|---|---|
| Test policy with mock input that triggers deny | `POST /policies/:id/test` | Returns `{ decision: "deny", messages: [...] }` |
| Test policy with mock input that triggers allow | `POST /policies/:id/test` | Returns `{ decision: "allow", messages: [] }` |
| Test policy with evidence requirement output | `POST /policies/:id/test` | Returns `{ decision: "allow", evidence_requirement: { min_count, required_types } }` |
| Test non-existent policy returns 404 | `POST /policies/:id/test` | HTTP 404 |
| Test with invalid mock input returns 400 | `POST /policies/:id/test` | HTTP 400 with validation error |

## Rego Snippets for Tests

Standard Rego policies used across test files:

**Deny deploy:**
```rego
package osabio.policy
default allow := false
deny contains msg if {
  input.action_spec.action == "deploy"
  msg := "Production deploys require approval"
}
```

**Allow file edits:**
```rego
package osabio.policy
default allow := false
allow if {
  input.action_spec.action == "edit_file"
}
```

**Behavior score threshold:**
```rego
package osabio.policy
default allow := false
allow if {
  input.behavior_scores.Security_First >= 0.7
}
deny contains msg if {
  input.behavior_scores.Security_First < 0.7
  msg := "Security score too low"
}
```

**Evidence requirement:**
```rego
package osabio.policy
default allow := false
allow if { true }
evidence_requirement := {
  "min_count": 2,
  "required_types": ["decision", "task"]
} if {
  input.action_spec.action == "deploy_production"
}
```

**Budget cap:**
```rego
package osabio.policy
default allow := false
allow if {
  input.budget_limit.amount <= 500
}
deny contains msg if {
  input.budget_limit.amount > 500
  msg := sprintf("Budget %.2f exceeds cap of 500", [input.budget_limit.amount])
}
```

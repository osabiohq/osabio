# User Stories: Regorus Policy Evaluation Engine

## Slice 1: Backend Engine + Schema

### US-1.1: Load Regorus WASM Engine
**As a** system operator
**I want** the Regorus WASM module to load on server startup
**So that** Rego policies can be evaluated without a sidecar process

**Estimate**: 1 day (WASM loading, initialization wrapper, unit test)
**Acceptance Criteria**: See AC-1.1

---

### US-1.2: Store Rego Source on Policy Record
**As a** workspace admin
**I want** to provide Rego source code when creating a policy
**So that** I can express complex governance rules beyond simple predicates

**Estimate**: 1 day (schema migration, route update, validation)
**Acceptance Criteria**: See AC-1.2

---

### US-1.3: Evaluate Rego Policy During Intent Authorization
**As a** workspace admin
**I want** my Rego policies to be evaluated when agents create intents
**So that** governance rules written in Rego are enforced automatically

**Estimate**: 2 days (RegoEvaluator implementation, output mapping, pipeline wiring, remove predicate evaluator)
**Acceptance Criteria**: See AC-1.3

---

### US-1.4: Validate Rego on Policy Create/Update
**As a** workspace admin
**I want** Rego syntax errors caught before my policy is saved
**So that** I don't activate a broken policy that fails at evaluation time

**Estimate**: 1 day (compile check on create/update, error formatting, unit tests)
**Acceptance Criteria**: See AC-1.4

---

### US-1.5: Acceptance Tests for Rego Policy Lifecycle
**As a** maintainer
**I want** acceptance tests covering Rego policy creation, activation, and intent evaluation
**So that** regressions are caught automatically

**Estimate**: 1 day
**Acceptance Criteria**: See AC-1.3 (end-to-end)

---

## Slice 2: UI -- Rego Editor + Validation

### US-2.1: Author Rego in Policy Creation Dialog
**As a** workspace admin
**I want** to write Rego policy body using a code editor
**So that** I can author policies using the full Rego language

**Estimate**: 2 days (replace RuleBuilder with Rego editor, syntax highlighting, field reference panel)
**Acceptance Criteria**: See AC-2.1

---

### US-2.2: Validate Rego Before Submitting
**As a** workspace admin
**I want** to click "Validate" and see compilation errors inline
**So that** I can fix Rego syntax before saving the policy

**Estimate**: 1 day (validate button, backend call, inline error display)
**Acceptance Criteria**: See AC-2.2

---

### US-2.3: View Rego Source on Policy Detail
**As a** workspace admin
**I want** to see the Rego source code on the policy detail page
**So that** I can review what a policy does without editing it

**Estimate**: 0.5 day (read-only code block)
**Acceptance Criteria**: See AC-2.3

---

### US-2.4: Diff Rego Source Between Versions
**As a** workspace admin
**I want** to see what changed in the Rego source between policy versions
**So that** I can review version changes before activating

**Estimate**: 1 day (diff component for Rego source text)
**Acceptance Criteria**: See AC-2.4

---

## Slice 3: Test Panel

### US-3.1: Test Policy Against Mock Input
**As a** workspace admin
**I want** to test my Rego policy against a mock intent context
**So that** I can verify it produces the expected allow/deny result before activating

**Estimate**: 2 days (backend test endpoint, UI test panel with JSON editor, result display)
**Acceptance Criteria**: See AC-3.1

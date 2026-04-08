# Data Models: Regorus Policy Evaluation Engine

## Schema Migration

### Remove from `policy` table

```sql
REMOVE FIELD rules ON policy;
-- This cascades removal of all rules[*].* nested fields
```

### Add to `policy` table

```sql
DEFINE FIELD rego_source ON policy TYPE string;
```

### Full migration script (schema/migrations/0088_rego_policy_engine.surql)

```sql
BEGIN TRANSACTION;

-- Remove predicate-based rule fields
REMOVE FIELD rules ON policy;

-- Add Rego source field
DEFINE FIELD OVERWRITE rego_source ON policy TYPE string;

COMMIT TRANSACTION;
```

Note: Per project convention (`docs/agents/surrealdb.md`), no data migration — existing predicate-based policies are discarded. This is a breaking schema change.

## Updated TypeScript Types

### `PolicyRecord` (after)

```typescript
type PolicyRecord = {
  id: RecordId<"policy">;
  title: string;
  description?: string;
  version: number;
  status: PolicyStatus;
  selector: PolicySelector;
  rego_source: string;                    // NEW: replaces rules
  human_veto_required: boolean;
  max_ttl?: string;
  created_by: RecordId<"identity">;
  workspace: RecordId<"workspace">;
  supersedes?: RecordId<"policy">;
  created_at: Date;
  updated_at?: Date;
};
```

### Removed types

- `RulePredicate` — no longer needed
- `RuleCondition` — no longer needed
- `PolicyRule` — no longer needed (policies are single Rego source, not arrays of rules)

### New types

```typescript
type CompileError = {
  line: number;
  column: number;
  message: string;
};

type CompileResult =
  | { success: true }
  | { success: false; errors: CompileError[] };

type RegoEvaluationResult = {
  allow: boolean;
  deny: string[];                          // deny messages (empty if allowed)
  evidence_requirement?: PolicyEvidenceRequirements;
};
```

### Unchanged types

- `PolicyGateResult` — same discriminated union (passed: true | passed: false)
- `PolicyTraceEntry` — same structure. `rule_id` becomes the policy ID (one trace per policy)
- `PolicyGateWarning` — kept for future use (Rego field reference warnings)
- `PolicyEvidenceRequirements` — same structure, now populated from Rego output
- `IntentEvaluationContext` — unchanged, passed as Rego `input` document
- `PolicySelector` — unchanged
- `PolicyStatus` — unchanged

## Rego Input Document Structure

The `IntentEvaluationContext` is serialized as JSON and set as the Rego `input` document:

```json
{
  "goal": "Deploy rate-limiting middleware to production",
  "reasoning": "Rate limiting protects upstream services from traffic spikes",
  "priority": 3,
  "action_spec": {
    "provider": "github",
    "action": "create_pull_request",
    "params": { "branch": "feature/rate-limit" }
  },
  "budget_limit": { "amount": 50, "currency": "USD" },
  "requester_type": "agent",
  "requester_role": "coding_agent",
  "behavior_scores": {
    "Security_First": 0.85,
    "TDD_Adherence": 0.72,
    "Code_Quality": 0.91
  }
}
```

Accessed in Rego as `input.goal`, `input.action_spec.action`, `input.behavior_scores.TDD_Adherence`, etc.

## Rego Output Contract

Policies must declare `package osabio.policy` and may define:

| Output | Type | Default | Description |
|---|---|---|---|
| `allow` | boolean | `false` | Whether the intent is permitted |
| `deny` | set of strings | `{}` | Deny reasons (non-empty = denied) |
| `evidence_requirement` | object | none | Optional evidence threshold |

Example policy:

```rego
package osabio.policy

default allow := false

allow if {
  input.behavior_scores.TDD_Adherence >= 0.5
  input.behavior_scores.Security_First >= 0.7
}

deny contains msg if {
  input.behavior_scores.TDD_Adherence < 0.5
  msg := sprintf("TDD score %.2f below 0.5 threshold", [input.behavior_scores.TDD_Adherence])
}

deny contains msg if {
  input.behavior_scores.Security_First < 0.7
  msg := sprintf("Security score %.2f below 0.7 threshold", [input.behavior_scores.Security_First])
}

evidence_requirement := {
  "min_count": 2,
  "required_types": ["decision", "task"]
} if {
  input.action_spec.action == "deploy_production"
}
```

## API Request/Response Changes

### Create Policy (POST /policies)

**Before:**
```json
{
  "title": "Deny low TDD",
  "description": "Block agents with low TDD score",
  "rules": [
    {
      "id": "deny-low-tdd",
      "condition": { "field": "behavior_scores.TDD_Adherence", "operator": "lt", "value": 0.5 },
      "effect": "deny",
      "priority": 100
    }
  ]
}
```

**After:**
```json
{
  "title": "Deny low TDD",
  "description": "Block agents with low TDD score",
  "rego_source": "package osabio.policy\n\ndefault allow := false\n\nallow if {\n  input.behavior_scores.TDD_Adherence >= 0.5\n}\n\ndeny contains msg if {\n  input.behavior_scores.TDD_Adherence < 0.5\n  msg := \"TDD score too low\"\n}"
}
```

### Test Policy (POST /policies/:id/test) — NEW

**Request:**
```json
{
  "input": {
    "behavior_scores": { "TDD_Adherence": 0.3 },
    "action_spec": { "provider": "github", "action": "push" },
    "requester_type": "agent"
  }
}
```

**Response:**
```json
{
  "decision": "deny",
  "messages": ["TDD score too low"],
  "evidence_requirement": null
}
```

### Validate Rego (POST /policies/validate) — NEW

**Request:**
```json
{
  "rego_source": "package osabio.policy\nallow if { input.x >"
}
```

**Response (400):**
```json
{
  "errors": [
    { "line": 2, "column": 32, "message": "unexpected end of input" }
  ]
}
```

# Walking Skeleton: Regorus Policy Evaluation Engine

## Strategy

No new walking skeleton test file. The existing `walking-skeleton.test.ts` IS the walking skeleton — it already exercises the end-to-end path: create policy → activate → create intent → evaluate policy gate → check trace.

The change is the payload: `rules` array → `rego_source` string.

## Existing Skeletons (modified in place)

### Skeleton 1: Active deny policy blocks deploy intent

**Before** (predicate):
```typescript
createPolicy(surreal, workspaceId, adminId, {
  title: "Block Production Deploys",
  rules: [{
    id: "no_deploy",
    condition: { field: "action_spec.action", operator: "eq", value: "deploy" },
    effect: "deny",
    priority: 100,
  }],
});
```

**After** (Rego):
```typescript
createPolicy(surreal, workspaceId, adminId, {
  title: "Block Production Deploys",
  rego_source: `package osabio.policy
default allow := false
deny contains msg if {
  input.action_spec.action == "deploy"
  msg := "Production deploys require approval"
}`,
});
```

**Trace assertion change**: `rule_id` becomes policy ID (one trace entry per policy, not per rule).

### Skeleton 2: Empty policy set passes through

No change. This skeleton tests the empty-policy path — no `rules` or `rego_source` involved.

## Walking Skeleton Adapter Coverage

| Adapter | Real I/O in WS? | Covered by |
|---|---|---|
| SurrealDB (policy CRUD) | YES | Skeleton 1: creates, activates policy in real DB |
| SurrealDB (graph traversal) | YES | Skeleton 1: `loadActivePoliciesForIdentity` queries governing/protects edges |
| Regorus WASM (Rego evaluation) | YES | Skeleton 1: `evaluatePolicyGate` calls `evaluateRegoPolicy` with real WASM |
| SurrealDB (intent CRUD) | YES | Skeleton 1: creates intent, updates evaluation |
| HTTP routes | NO | Acceptance tests use direct DB (existing pattern). HTTP routes tested in milestone-3. |

## What the Walking Skeleton Proves After Migration

1. Regorus WASM loads successfully in Bun
2. Rego source is stored and retrieved from SurrealDB
3. Policy gate evaluates Rego policies via Regorus
4. Deny short-circuit works (intent rejected before LLM tier)
5. Policy trace is recorded with correct structure
6. Empty policy set still passes through (no regression)

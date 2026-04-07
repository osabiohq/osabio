# Outcome KPIs: Regorus Policy Evaluation Engine

## Primary Outcomes

### KPI-1: Policy Expressiveness
**Metric**: Number of governance rules that require custom code workarounds
**Baseline**: Current predicate evaluator cannot express set operations, aggregations, cross-field comparisons, or temporal conditions -- workspace admins must request developer involvement for complex rules
**Target**: Zero custom code workarounds needed for governance rules expressible in Rego
**Measurement**: Track governance feature requests that cannot be implemented as Rego policies

### KPI-2: Policy Evaluation Latency
**Metric**: p99 latency of `evaluatePolicyGate()` for Rego policies
**Baseline**: Current predicate evaluator p99 < 1ms (simple operator comparisons)
**Target**: Rego evaluation p99 < 5ms per policy
**Measurement**: OpenTelemetry span `osabio.policy.evaluate` with `evaluator_type` attribute

### KPI-3: Policy Authoring Success Rate
**Metric**: Percentage of policy create attempts that succeed on first submit
**Baseline**: ~95% (predicate builder has structural validation but limited expressiveness)
**Target**: >= 80% first-submit success (Rego is more powerful but has a learning curve)
**Measurement**: Track `POST /policies` response codes

## Secondary Outcomes

### KPI-4: Policy Test Coverage
**Metric**: Percentage of active Rego policies that have been tested via the test endpoint
**Target**: >= 50% of active policies tested at least once before activation
**Measurement**: Track `POST /policies/:id/test` calls per policy, correlate with activation events

## Instrumentation Plan

| KPI | Span/Event | Attributes |
|-----|-----------|------------|
| KPI-2 | `osabio.policy.evaluate` | `policy_count`, `duration_ms` |
| KPI-3 | `osabio.http.request` (POST /policies) | `http.status_code` |
| KPI-4 | `osabio.http.request` (POST /policies/:id/test) | `policy_id`, `test_result: "allow" \| "deny"` |

# Journey: Policy Authoring with Rego

**Persona**: Platform lead at a 3-person ops team. Manages 5-10 active policies governing sandbox agents. Comfortable with JSON/YAML but new to Rego. Pain: predicate builder can't express set operations, aggregations, or temporal conditions.
**Goal**: Create, validate, and activate a governance policy using Rego syntax

---

## Journey Map

```
Phase        | Discovery        | Authoring        | Validation       | Activation       | Monitoring
-------------|------------------|------------------|------------------|------------------|------------------
Action        Find policy page   Write Rego body    Compile check      Activate policy    Check intent traces
              Open create dialog Type/paste Rego     Review errors      Verify in feed     Adjust if needed
              Set metadata       Use field hints     Test against mock
                                                     input
-------------|------------------|------------------|------------------|------------------|-----------------
Touchpoint    Policy Mgmt UI     Rego editor        Inline diagnostics Policy detail pg   Intent trace view
              Create btn         Field suggestions   Test panel         Activate btn       Policy trace
                                 Syntax highlight                      Version chain      Feed cards
-------------|------------------|------------------|------------------|------------------|-----------------
Artifact      --                 ${rego_source}     ${compile_result}  ${policy_record}   ${policy_trace}
                                 ${policy_meta}     ${test_result}     ${governing_edge}  ${intent_eval}
                                                                       ${protects_edge}
-------------|------------------|------------------|------------------|------------------|-----------------
Emotion       Neutral            Focused/curious    Anxious->relieved  Confident          Trusting
              "Where do I        "Is this right?"   "Does it work?"    "It's live"        "It's working
              start?"                                                                      as expected"
-------------|------------------|------------------|------------------|------------------|-----------------
Risk          Can't find         Syntax errors      Compile fails      Accidental deny    Silent misconfig
              create flow        Wrong field paths   with no context    on wrong scope     (rule never fires)
              Confused by Rego   Unclear semantics                     Version conflict
```

## Happy Path

1. **Navigate** to Policy Management page
2. **Click** "Create Policy" -- opens dialog with metadata fields + Rego editor
3. **Fill** title, description, optional selector (agent role, resource)
4. **Write** Rego policy body in editor (syntax-highlighted, with field suggestions from `IntentEvaluationContext`)
5. **Click** "Validate" -- Regorus compiles the Rego source, shows inline errors or success
6. **Optionally** test against a mock input document to see allow/deny result
7. **Submit** -- creates policy in `draft` status
8. **Review** on policy detail page, then **Activate**
9. **Monitor** via intent traces showing policy evaluation results

## Error Paths

| Error | Trigger | Recovery |
|-------|---------|----------|
| Rego syntax error | Invalid Rego on submit/validate | Inline error with line/column, user fixes |
| Unknown field | Rego references field not in `input` | Field suggestion dropdown, documentation link |
| Compile timeout | Extremely complex policy | Error message, suggest simplification |
| Version conflict | Another admin created version simultaneously | Reload, merge manually |
| Overly broad deny | Policy denies all intents | Test panel shows deny on sample input, user narrows condition |

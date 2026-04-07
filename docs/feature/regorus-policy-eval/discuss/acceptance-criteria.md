# Acceptance Criteria: Regorus Policy Evaluation Engine

## AC-1.1: Load Regorus WASM Engine
```gherkin
Given the server starts
When the first Rego policy evaluation is requested
Then the Regorus WASM module loads successfully
And subsequent evaluations reuse the loaded module
```

## AC-1.2: Store Rego Source on Policy Record
```gherkin
Given an authenticated workspace admin
When the admin creates a policy with rego_source:
  """
  package osabio.policy

  default allow := false

  allow if { input.requester_type == "human" }
  """
Then a policy record is created with the rego_source field populated
And the policy status is draft
And the rego_source is retrievable on GET /policies/:id
```

## AC-1.3: Evaluate Rego Policy During Intent Authorization
```gherkin
Given an active Rego policy:
  """
  package osabio.policy

  default allow := false

  allow if { input.behavior_scores.Security_First >= 0.7 }

  deny contains msg if {
    input.behavior_scores.Security_First < 0.7
    msg := "Security score too low"
  }
  """
And an agent with Security_First behavior score of 0.5

When the agent creates an intent
Then the policy gate evaluates the Rego policy via Regorus
And the intent is rejected
And the policy_trace contains an entry with:
  | field          | value          |
  | effect         | deny           |
  | matched        | true           |
And the rejection reason includes "Security score too low"

Given the same policy and an agent with Security_First score of 0.9
When the agent creates an intent
Then the intent passes the policy gate
And the policy_trace contains an entry with:
  | field          | value          |
  | effect         | allow          |
  | matched        | true           |
```

## AC-1.4: Validate Rego on Policy Create/Update
```gherkin
Given an admin submits a policy with invalid Rego:
  """
  package osabio.policy
  allow if {
    input.score >=
  }
  """
Then the request is rejected with HTTP 400
And the error body contains:
  | field   | type   |
  | line    | number |
  | column  | number |
  | message | string |

Given an admin submits a policy with valid Rego
Then the policy is created successfully
```

## AC-2.1: Author Rego in Policy Creation Dialog
```gherkin
Given the admin opens the Create Policy dialog
Then a Rego code editor is displayed for writing the policy body
And a field reference panel shows IntentEvaluationContext fields
And the editor provides syntax highlighting
```

## AC-2.2: Validate Rego Before Submitting
```gherkin
Given the admin has entered Rego source in the editor
When the admin clicks "Validate"
Then the backend compiles the Rego source
And on success, a green checkmark is shown
And on failure, errors with line numbers are shown inline
```

## AC-2.3: View Rego Source on Policy Detail
```gherkin
Given an existing Rego policy
When the admin views the policy detail page
Then the rego_source is displayed in a read-only code block with syntax highlighting
```

## AC-2.4: Diff Rego Source Between Versions
```gherkin
Given a Rego policy with versions 1 and 2
When the admin views the version diff
Then a side-by-side or unified diff of rego_source is displayed
```

## AC-3.1: Test Policy Against Mock Input
```gherkin
Given an existing Rego policy
When the admin calls POST /policies/:id/test with body:
  """
  {
    "input": {
      "behavior_scores": { "TDD_Adherence": 0.3 },
      "action_spec": { "provider": "github", "action": "push" },
      "requester_type": "agent"
    }
  }
  """
Then the response contains:
  | field    | value                                  |
  | decision | deny                                   |
  | messages | ["TDD adherence 0.30 below threshold"] |

When tested with TDD_Adherence of 0.8
Then the response contains:
  | field    | value |
  | decision | allow |
```

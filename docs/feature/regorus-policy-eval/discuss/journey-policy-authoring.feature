Feature: Policy Authoring with Rego
  As a workspace admin
  I want to create governance policies using Rego syntax
  So that I can express complex authorization rules that the predicate evaluator cannot handle

  Background:
    Given an authenticated workspace admin
    And an active workspace with at least one agent

  # ------------------------------------------------------------------
  # Happy Path: Create and activate a Rego policy
  # ------------------------------------------------------------------

  Scenario: Create a Rego policy via the UI
    Given the admin is on the Policy Management page
    When the admin clicks "Create Policy"
    And fills in the title "Deny low TDD adherence"
    And fills in the description "Block intents from agents with TDD score below 0.5"
    And writes the following Rego source:
      """
      package osabio.policy

      default allow := false

      allow if {
        input.behavior_scores.TDD_Adherence >= 0.5
      }

      deny contains msg if {
        input.behavior_scores.TDD_Adherence < 0.5
        msg := sprintf("TDD adherence %.2f below threshold 0.5", [input.behavior_scores.TDD_Adherence])
      }
      """
    And clicks "Validate"
    Then the Rego source compiles successfully
    And the validation indicator shows success

  Scenario: Submit and activate a validated Rego policy
    Given the admin has a validated Rego policy in the create dialog
    When the admin submits the policy
    Then a policy record is created in draft status
    And the admin is navigated to the policy detail page
    When the admin clicks "Activate"
    Then the policy status changes to active
    And a governing edge links the admin's identity to the policy
    And a protects edge links the policy to the workspace

  # ------------------------------------------------------------------
  # Validation: Rego compilation errors
  # ------------------------------------------------------------------

  Scenario: Rego syntax error shows inline diagnostic
    Given the admin is writing a Rego policy
    When the admin enters invalid Rego syntax:
      """
      package osabio.policy
      allow if {
        input.behavior_scores.TDD_Adherence >=
      }
      """
    And clicks "Validate"
    Then an error is displayed with line number and column
    And the error message describes the syntax issue

  Scenario: Rego references unknown input field
    Given the admin writes a Rego policy referencing "input.nonexistent_field"
    When the admin clicks "Validate"
    Then the compilation succeeds (Rego allows undefined field access)
    But a warning suggests the field is not in IntentEvaluationContext

  # ------------------------------------------------------------------
  # Testing: Mock input evaluation
  # ------------------------------------------------------------------

  Scenario: Test policy against mock input
    Given the admin has a validated Rego policy
    When the admin opens the test panel
    And provides a mock IntentEvaluationContext:
      """
      {
        "behavior_scores": { "TDD_Adherence": 0.3 },
        "action_spec": { "provider": "github", "action": "create_pull_request" },
        "requester_type": "agent"
      }
      """
    And clicks "Test"
    Then the result shows "deny" with the message "TDD adherence 0.30 below threshold 0.5"

  Scenario: Test policy shows allow result
    Given the admin has a validated Rego policy for TDD adherence
    When the admin tests with mock input where TDD_Adherence is 0.8
    Then the result shows "allow"

  # ------------------------------------------------------------------
  # Policy evaluation during intent authorization
  # ------------------------------------------------------------------

  Scenario: Rego policy denies an intent
    Given an active Rego policy that denies when TDD_Adherence < 0.5
    And an agent with TDD_Adherence score of 0.3
    When the agent creates an intent
    Then the policy gate evaluates the Rego policy
    And the intent is rejected with policy trace showing the deny rule

  Scenario: Rego policy allows an intent
    Given an active Rego policy that denies when TDD_Adherence < 0.5
    And an agent with TDD_Adherence score of 0.8
    When the agent creates an intent
    Then the policy gate evaluates the Rego policy
    And the intent proceeds through the authorization pipeline
    And the policy trace shows the allow result

  # ------------------------------------------------------------------
  # Versioning: Update policy with new Rego source
  # ------------------------------------------------------------------

  Scenario: Create new version of a Rego policy
    Given an active Rego policy version 1
    When the admin creates a new version with updated Rego source
    Then a new policy record is created with version 2
    And the new version supersedes version 1
    When the admin activates version 2
    Then version 1 is marked as superseded
    And new intent evaluations use version 2

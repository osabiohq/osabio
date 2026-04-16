# Peer Review: claude-agent-sdk-provider Requirements

```yaml
review_id: "req_rev_20260416_001"
reviewer: "product-owner (review mode)"
artifact: "docs/feature/claude-agent-sdk-provider/discuss/user-stories.md"
iteration: 1

strengths:
  - "Job statement grounded in four forces (push/pull/anxiety/habit) — surfaces the real friction without a prior DIVERGE wave"
  - "System Constraints section correctly prohibits null, process.env reads, and secrets-via-flags at the top of the document"
  - "US-02 error paths are explicit and actionable — missing CLI and unauthenticated CLI each get their own scenario with real remediation commands"
  - "Walking skeleton is correctly identified as the thinnest end-to-end slice across all four activities"
  - "Dynamic import pattern for optional provider is called out explicitly, consistent with the existing sandbox-agent pattern"
  - "Smoke test (US-03) validates the riskiest assumption (provider package compatibility) before documentation ships"
  - "All AC are observable user outcomes — no implementation details leaked into requirements"

issues_identified:
  confirmation_bias:
    - issue: "Happy path bias in US-02 — budget exhaustion during a live session is documented as a failure mode but has no UAT scenario. If CLAUDE_CODE_MAX_BUDGET_USD is reached mid-conversation, the behavior (error surfaced in stream vs server crash vs silent truncation) is unspecified."
      severity: "high"
      location: "US-02 failure_modes, UAT Scenarios"
      recommendation: "Add a UAT scenario: 'Given CLAUDE_CODE_MAX_BUDGET_USD is set to 0.01 (effectively zero) When an agent inference call is made Then the error is surfaced in the chat stream as a readable message And the server continues running (not crashed)'"

  completeness_gaps:
    - issue: "Missing NFR: the provider must not break CI for users who do NOT have Claude Code installed. Package must be optional — if it is a hard dependency, bun install fails for OpenRouter/Ollama users. The dependency classification (optional vs dev vs peer) is deferred to DESIGN but the requirement must be stated here."
      severity: "critical"
      location: "System Constraints"
      recommendation: "Add to System Constraints: 'The ai-sdk-provider-claude-code package must not be a hard runtime dependency — developers using OpenRouter or Ollama must not be required to have it installed. The feature must degrade gracefully (clear error) if the package is absent when INFERENCE_PROVIDER=claude-code is set.'"

    - issue: "Missing stakeholder perspective: CI/CD operators running Osabio in headless environments (Docker, Kubernetes) where Claude Code cannot authenticate interactively. The current error handling covers 'developer on laptop' but not 'operator in a container'."
      severity: "high"
      location: "US-02, US-04"
      recommendation: "Add a domain example and AC for the headless case: when INFERENCE_PROVIDER=claude-code is set in a Docker environment where Claude Code cannot authenticate, the startup error must be clear and the documentation must note that claude-code provider requires an interactive host where Claude Code is authenticated."

  clarity_issues:
    - issue: "US-02 AC item 'Each returned model is compatible with Vercel AI SDK streamText() and generateObject() interfaces' is not independently testable at requirements time — it is a property of the provider package. The AC should focus on the observable behavior: the smoke test passes."
      severity: "medium"
      location: "US-02 Acceptance Criteria item 3"
      recommendation: "Rewrite as: 'streamText() completes without error when called with the chatAgentModel returned by the factory (verified by US-03 smoke test)'"

  testability_concerns: []

  priority_validation:
    q1_largest_bottleneck: "YES — confirmed by issue author; existing providers require new accounts that many developers do not have"
    q2_simple_alternatives: "ADEQUATE — issue author explicitly considered and rejected mixed-provider routing (out of scope). Simpler alternative (document OpenRouter free tier) was implicitly considered but does not solve the 'use existing subscription' job."
    q3_constraint_prioritization: "CORRECT — riskiest assumption (provider package compatibility) validated first via smoke test before documentation ships"
    q4_data_justified: "JUSTIFIED — extension point in dependencies.ts and config.ts is verified against actual source code; factory pattern is identical to existing Ollama factory"
    verdict: "PASS"

approval_status: "conditionally_approved"
critical_issues_count: 1
high_issues_count: 2
medium_issues_count: 1
```

---

## Required Remediations Before DESIGN Handoff

### Critical (must fix)

**C1 — Optional dependency NFR missing from System Constraints**

Add to `user-stories.md` System Constraints section:

> `ai-sdk-provider-claude-code` must be installable as an optional dependency — developers using `INFERENCE_PROVIDER=openrouter` or `INFERENCE_PROVIDER=ollama` must not be required to have it installed. When `INFERENCE_PROVIDER=claude-code` is set and the package is absent, the server must fail with a clear error naming the missing package and the install command.

---

### High (should fix before handoff)

**H1 — Budget exhaustion mid-session has no scenario**

Add to US-02 UAT Scenarios:

```gherkin
Scenario: Budget exhaustion surfaces as a readable message in the chat stream
  Given CLAUDE_CODE_MAX_BUDGET_USD is set to 0.01
  And the server has started successfully
  When an agent inference call is made that exceeds the budget
  Then the error appears in the chat stream as a human-readable message
  And the server continues accepting new requests (not crashed)
```

Add to US-02 Acceptance Criteria:
- [ ] When `CLAUDE_CODE_MAX_BUDGET_USD` is exceeded during an inference call, the error is surfaced in the chat stream and the server continues running

**H2 — Headless/CI environment not covered**

Add to US-04 Domain Examples:
> **3b: Constraint — CI/CD operator deploys Osabio in Docker**
> A DevOps engineer at a logistics company wants to run Osabio with `INFERENCE_PROVIDER=claude-code` in a Docker container. The README's prerequisites section notes that the claude-code provider requires an interactive host where Claude Code is installed and authenticated — it is not suitable for fully headless deployments. The engineer chooses `INFERENCE_PROVIDER=openrouter` for their container deployment.

Add to US-04 Acceptance Criteria:
- [ ] README notes that the claude-code provider requires an interactive host with Claude Code authenticated; it is not suitable for headless container deployments

---

## Iteration 1 Result

The requirements are conditionally approved pending the three remediations above. Once applied, the feature is ready for DESIGN wave handoff. No Iteration 2 required if remediations are applied as specified.

# Outcome KPIs: claude-agent-sdk-provider

## Feature: claude-agent-sdk-provider

### Objective
By the end of Q2 2026, a developer with an existing Claude subscription can get Osabio agents running in under 10 minutes — without creating a new provider account.

---

### Outcome KPIs

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|-----|-----------|-------------|----------|-------------|------|
| 1 | Developer with Claude subscription | Completes Osabio setup using existing Claude credentials | 100% of attempts succeed when prerequisites are met | Currently 0% (option does not exist) | Smoke test pass rate in CI | Leading |
| 2 | Developer encountering startup errors | Self-recovers from missing/unauthenticated Claude Code using error message alone | 0 "why won't the server start?" issues filed post-release | Unknown — no baseline (feature does not exist) | GitHub issues with label `inference-provider` within 30 days | Leading |
| 3 | Developer discovering claude-code provider in README | Completes setup without asking a question | 0 "how do I set up claude-code?" issues or community questions within 30 days | Unknown — no baseline | GitHub issues + community channel queries | Leading |
| 4 | All existing Osabio users (OpenRouter/Ollama) | Experience no regression in existing provider behavior | 0 incidents caused by provider dispatch change | 0 incidents today | CI acceptance test suite | Guardrail |

---

### Metric Hierarchy

- **North Star**: Developer completes first claude-code provider setup in under 10 minutes with zero support touchpoints.
- **Leading Indicators**:
  - Smoke test for `streamText()` and `generateObject()` passes in CI (validates integration works)
  - Zero new GitHub issues with `inference-provider` + `question` label within 30 days of release (validates documentation quality)
- **Guardrail Metrics**:
  - Existing acceptance test suite passes without regressions (no provider dispatch change breaks OpenRouter/Ollama)
  - TypeScript compilation passes (no type errors from `InferenceProvider` extension)

---

### Measurement Plan

| KPI | Data Source | Collection Method | Frequency | Owner |
|-----|------------|-------------------|-----------|-------|
| 1 — Smoke test pass rate | CI pipeline (GitHub Actions) | Automated test result | Per PR + main merge | Engineer running CI |
| 2 — Startup error self-recovery | GitHub Issues | Manual issue triage with label | Monthly review for 2 months post-release | Maintainer |
| 3 — Documentation self-service | GitHub Issues + Discord/Slack | Manual triage + community channel scan | Monthly review for 2 months post-release | Maintainer |
| 4 — No regressions | CI acceptance test suite | Automated | Per PR + main merge | Engineer running CI |

---

### Hypothesis

We believe that adding `INFERENCE_PROVIDER=claude-code` support to Osabio for developers with Claude subscriptions will achieve: developer completes setup with zero new accounts created, in under 10 minutes.

We will know this is true when:
- Smoke tests pass in CI (integration works)
- Zero "how do I set this up?" issues are filed within 30 days (documentation is sufficient)
- Zero regressions in existing provider behavior (guardrail holds)

---

### Story-Level KPI Traceability

| Story | Targets KPI | Outcome |
|-------|-------------|---------|
| US-01: Config Extension | KPI-1, KPI-4 | `INFERENCE_PROVIDER=claude-code` accepted; existing providers unaffected |
| US-02: Provider Factory | KPI-1, KPI-2 | Agents run through Claude Code; errors are actionable |
| US-03: Smoke Test | KPI-1, KPI-4 | Integration verified automatically; guardrail confirmed |
| US-04: Documentation | KPI-3 | Developers self-serve without support touchpoints |

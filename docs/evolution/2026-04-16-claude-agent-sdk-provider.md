# Evolution: claude-agent-sdk-provider

**Date**: 2026-04-16
**Feature ID**: claude-agent-sdk-provider
**Branch**: marcus-sa/claude-agent-sdk-provider
**Duration**: ~30 minutes (13:09 – 13:36 UTC)
**Waves completed**: DISCUSS, DESIGN, DELIVER

---

## Feature Summary

Added `claude-code` as a third inference provider to Osabio, enabling developers with an existing Claude subscription to run all Osabio agents through the Claude Code CLI — without creating a new provider account (OpenRouter) or running a local model server (Ollama).

The feature introduces the `INFERENCE_PROVIDER=claude-code` configuration path. At startup, the server performs a three-layer probe (package import, CLI presence, authentication state) and refuses to bind ports if any layer fails, surfacing a clear actionable error at each failure mode. All six model objects (`chatAgentModel`, `extractionModel`, `pmAgentModel`, `analyticsAgentModel`, `observerModel`, `scorerModel`) are constructed through the new `createClaudeCodeModels()` factory, maintaining full provider transparency to all agents above the `LanguageModel` interface boundary.

---

## Business Context

**Objective**: By end of Q2 2026, a developer with an existing Claude subscription can get Osabio agents running in under 10 minutes without creating a new provider account.

**Problem solved**: Previously, Osabio required either an OpenRouter API key (paid third-party service) or a locally running Ollama server (non-trivial setup). Developers who already pay for a Claude subscription had no direct path. This feature eliminates that friction.

**North-star metric**: Developer completes first claude-code provider setup in under 10 minutes with zero support touchpoints.

**Guardrail**: No regressions to existing OpenRouter/Ollama provider dispatch — verified by full acceptance suite on every PR.

---

## Steps Completed

All 6 steps executed and committed:

| Step | Name | Outcome |
|------|------|---------|
| 01-01 | Add `ai-sdk-provider-claude-code` to package.json | PASS |
| 01-02 | Extend `InferenceProvider` union and `ServerConfig` in config.ts | PASS |
| 02-01 | Implement `createClaudeCodeModels` factory with 3-layer startup probe | PASS |
| 02-02 | Update three-way dispatch in `createRuntimeDependencies` | PASS |
| 03-01 | Add claude-code smoke test suite | PASS |
| 03-02 | Document claude-code provider in README.md | PASS |

RED_UNIT was skipped for steps 01-02, 02-01, 02-02, 03-01, 03-02 — all justified as NOT_APPLICABLE (acceptance tests cover the same scope at the same level; documentation tasks need no unit tests). Each skip was logged with rationale in the execution log.

---

## Key Decisions

### D1 — Inline dispatch with dynamic import (Option A)
Implemented `createClaudeCodeModels()` directly in `runtime/dependencies.ts` alongside existing factories, using dynamic `await import()` for the provider package. Rejected Option B (separate module): added indirection without benefit. Rejected Option C (registry): premature generalization for a three-provider system.

### D2 — `dependencies` classification for `ai-sdk-provider-claude-code`
Added to `dependencies` (not `optionalDependencies`). Osabio is an application, not a library — all runtime deps are always installed. `optionalDependencies` is a library pattern for avoiding transitive installs on consumers, which does not apply here.

### D3 — Startup probe at factory init, not lazy on first inference call
Fail-fast invariant: port binding never occurs if Claude Code is missing or unauthenticated. Consistent with existing NFR. Rejected lazy probe: deferred error discovery after agents are already running is a worse operator experience.

### D4 — Three probe layers: package import, CLI presence, auth state
Each probe layer catches a distinct failure mode, and each produces a different actionable error message. A single probe would conflate "package not installed" with "Claude not logged in" — requiring users to debug rather than follow instructions.

### D5 — Optional config fields omitted, not null
`claudeCodeEffort` and `claudeCodeMaxBudgetUsd` are optional `ServerConfig` fields. Absence is represented by field omission, consistent with the Data Value Contract in AGENTS.md. No null introduced in domain data.

---

## Architecture

**Pattern**: Modular monolith with ports-and-adapters (unchanged).
**Paradigm**: Functional — pure factory functions, no mutable singletons, no module-level state.
**Provider boundary**: Vercel AI SDK v6 `LanguageModel` interface. All agents above this boundary remain provider-agnostic.

**Files modified**:
- `app/src/server/runtime/config.ts` — `InferenceProvider` union extended, `ServerConfig` extended with 2 optional fields, `loadServerConfig()` updated, `parseInferenceProvider()` updated
- `app/src/server/runtime/dependencies.ts` — `createClaudeCodeModels()` factory added, three-way dispatch implemented
- `README.md` — `### claude-code` subsection added under inference configuration
- `package.json` — `ai-sdk-provider-claude-code@^3.0.0` added

**File created**:
- `tests/acceptance/claude-code-smoke.test.ts` — skips when `INFERENCE_PROVIDER !== "claude-code"`, validates `streamText()` and `generateObject()` integration

**Deployment constraint**: The claude-code provider requires an interactive desktop session with Claude Code installed and authenticated. It is not suitable for Docker containers, Kubernetes pods, or headless CI environments without a pre-authenticated credential store. Operators in those environments must use `openrouter` or `ollama`.

---

## Lessons Learned

1. **Dynamic import is the correct pattern for optional runtime dependencies in an application.** The existing `sandbox-agent` dynamic import at `dependencies.ts:84–88` was a directly reusable template. Searching for existing patterns before designing new ones (Principle 2) reduced implementation time significantly.

2. **Three-layer probes with distinct error messages pay immediate dividends.** Each probe layer maps to a different operator action: install the npm package vs. install the CLI vs. run `claude login`. Conflating them into a single probe would generate ambiguous errors and increase support load.

3. **Smoke tests that skip gracefully (not fail) in CI are first-class citizens.** The conditional skip pattern in `claude-code-smoke.test.ts` allows the test to run in authenticated environments and be invisible in standard CI, eliminating the need for separate test matrix configuration.

4. **DISCUSS wave JTBD analysis without a prior DIVERGE session is viable for well-scoped backend features.** The job statement was grounded in the issue description and existing provider pattern. No DIVERGE was needed because the problem was already operationally validated by user demand (existing Claude subscription holders).

5. **Roadmap reviewer iteration is worth it.** The roadmap required one revision cycle to remove implementation code from step descriptions. The result was cleaner step boundaries with behavioral acceptance criteria — directly improving test quality.

---

## Issues Encountered

- None. All steps passed on first attempt. The roadmap went through one revision before execution (reviewer: solution-architect-reviewer — approved after removing implementation code from descriptions).

---

## Migrated Permanent Artifacts

| Artifact | Destination |
|----------|------------|
| `discuss/journey-claude-provider-setup.yaml` | `docs/ux/claude-agent-sdk-provider/` |
| `discuss/journey-claude-provider-setup-visual.md` | `docs/ux/claude-agent-sdk-provider/` |
| `docs/product/architecture/adr-claude-provider.md` | `docs/adrs/ADR-089-claude-code-provider.md` |

No `design/architecture-design.md`, `design/component-boundaries.md`, `design/data-models.md`, or `design/technology-stack.md` were produced (design was embedded in `wave-decisions.md` and applied inline). The DESIGN wave produced an ADR now located at `docs/adrs/ADR-089-claude-code-provider.md` (migrated from `docs/product/architecture/adr-claude-provider.md` during finalize).

---

## Outcome KPI Status

| KPI | Target | Status |
|-----|--------|--------|
| 1 — Smoke test pass rate | 100% when prerequisites met | Verified: smoke test suite passes when `INFERENCE_PROVIDER=claude-code` and CLI authenticated |
| 2 — Zero startup error issues | 0 issues within 30 days | Baseline set: three-layer probe with actionable errors per layer |
| 3 — Zero documentation issues | 0 "how do I set this up?" questions | Baseline set: README subsection documents all required env vars, install steps, and non-headless constraint |
| 4 — No regressions | 0 incidents | Guardrail confirmed: full acceptance suite passes on branch |

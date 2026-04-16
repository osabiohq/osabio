# Wave Decisions: claude-agent-sdk-provider (DESIGN)

**Prepared by**: Morgan (Solution Architect, DESIGN wave)
**Date**: 2026-04-16
**ADR**: `docs/product/architecture/adr-claude-provider.md`
**Architecture document**: `docs/product/architecture/brief.md` — `## Application Architecture`

---

## Architecture Summary

**Pattern**: Modular monolith with ports-and-adapters (existing). No new architectural pattern introduced.

**Paradigm**: Functional — pure factory functions, no mutable singletons, no module-level state.

**Approach**: Inline factory extension. Add `createClaudeCodeModels()` to `runtime/dependencies.ts` alongside the existing `createOpenRouterModels()` and `createOllamaModels()` factories. Lazy-load `ai-sdk-provider-claude-code` via dynamic import. The provider boundary is the `LanguageModel` interface from Vercel AI SDK v6 — all agents above this boundary remain provider-agnostic.

---

## Key Decisions

| # | Decision | Rationale | Alternatives Rejected |
|---|----------|-----------|----------------------|
| D1 | Option A: inline dispatch with dynamic import | Minimal blast radius (2 files), consistent with existing factory pattern, zero new abstractions | Option B (separate module): added indirection without benefit; Option C (registry): premature generalization |
| D2 | `dependencies` classification for `ai-sdk-provider-claude-code` | This is an app, not a library — all runtime deps are always installed; `optionalDependencies` is a library concern (avoiding transitive installs on consumers) that does not apply here | `devDependencies`: breaks production installs; `peerDependencies`: requires explicit user install; `optionalDependencies`: library pattern, not app pattern |
| D3 | Startup probe at factory init, not lazy on first inference call | Fail-fast invariant: port binding never occurs if Claude Code is missing or unauthenticated. Consistent with NFR "startup fail-fast" | Lazy probe: deferred error discovery after agents are already running |
| D4 | Three probe layers: package import, CLI presence, auth state | Each layer catches a distinct failure mode; all are recoverable with documented commands | Single probe: misses auth-vs-missing distinction |
| D5 | `claudeCodeEffort` and `claudeCodeMaxBudgetUsd` as optional `ServerConfig` fields (omitted, not null) | Consistent with existing optional field convention; no null in domain data | null sentinel values: violates Data Value Contract from AGENTS.md |

---

## Reuse Analysis

| Existing Component | File | Overlap | Decision | Justification |
|-------------------|------|---------|----------|---------------|
| `createOpenRouterModels()` | `runtime/dependencies.ts:116` | Factory function returning 6 model objects | EXTEND PATTERN | New factory follows identical interface contract |
| `createOllamaModels()` | `runtime/dependencies.ts:138` | Factory with dynamic config | EXTEND PATTERN | Proves pattern viability; claude-code adds dynamic import |
| `loadServerConfig()` | `runtime/config.ts:50` | Provider-conditional config parsing | EXTEND | Add `claude-code` branch to existing conditional logic |
| `parseInferenceProvider()` | `runtime/config.ts:187` | Provider type parsing | EXTEND | Add third enum member, update error message |
| `InferenceProvider` type | `runtime/config.ts:10` | Union type | EXTEND | Add `"claude-code"` to union |
| `ServerConfig` type | `runtime/config.ts:12` | Config shape | EXTEND | Add 2 optional fields |
| Dynamic import pattern | `runtime/dependencies.ts:84–88` | `await import("sandbox-agent")` | REUSE | Exact pattern for lazy-loading optional package |
| Acceptance test kit | `tests/acceptance/acceptance-test-kit.ts` | `configOverrides` pattern | REUSE | Smoke test uses existing override mechanism |

**Zero CREATE NEW decisions** — no new files beyond the smoke test suite.

---

## Technology Stack Rationale

| Technology | Version | License | Decision |
|-----------|---------|---------|----------|
| `ai-sdk-provider-claude-code` | ^3.0.0 | MIT | Only OSS AI SDK v6-compatible adapter for Claude Code CLI. External package risk mitigated by smoke test in CI. |
| Vercel AI SDK (`ai`) | ^6.0.101 | Apache-2.0 | Already in use; provider package conforms to its `LanguageModel` interface. No change. |
| Bun | >=1.3 | MIT | Already in use; `await import()` dynamic loading works identically to Node.js. No change. |
| TypeScript | ^5.9 | Apache-2.0 | Already in use; `InferenceProvider` union provides compile-time exhaustiveness enforcement. No change. |

---

## Component Boundaries Established

### Modified Files (2)

1. `app/src/server/runtime/config.ts`
   - `InferenceProvider` union: add `"claude-code"`
   - `ServerConfig` type: add `claudeCodeEffort?: "low" | "normal" | "high"` and `claudeCodeMaxBudgetUsd?: number`
   - `loadServerConfig()`: skip `OPENROUTER_API_KEY` requirement for claude-code path; parse optional fields
   - `parseInferenceProvider()`: add claude-code branch; update error message to list all three values

2. `app/src/server/runtime/dependencies.ts`
   - Add `createClaudeCodeModels(config: ServerConfig, wrap: (model: any) => any)` factory
   - Update provider dispatch ternary (line 62–65) to three-way conditional
   - Factory uses dynamic import, startup probe (3 stages), config option forwarding
   - Model IDs supplied via existing `ServerConfig` fields (`chatAgentModelId`, `extractionModelId`, etc.) — no new env vars introduced. Factory calls `claudeCode(config.chatAgentModelId)` etc.
   - Budget exhaustion errors propagate through `streamText()` / `generateObject()` as provider-thrown errors — the AI SDK surfaces them in the chat stream. Smoke test must validate this behavior.

### New File (1)

3. `tests/acceptance/claude-code-smoke.test.ts` (or equivalent name)
   - `streamText()` validation via claude-code provider
   - `generateObject()` validation via extraction schema
   - Skip (not fail) when `INFERENCE_PROVIDER !== "claude-code"`

### Documentation (1)

4. `README.md` — add claude-code provider subsection under inference configuration (US-04, no code changes)

---

## Constraints Established

| Constraint | Source | Enforcement |
|-----------|--------|-------------|
| No `process.env` in factory code | AGENTS.md | TypeScript — all config arrives via `ServerConfig` parameter |
| No module-level mutable singletons | AGENTS.md | Pure factory function — no file-scope `let` state |
| No null in config values | AGENTS.md | Optional fields omitted via spread (`...(value ? { field: value } : {})`) |
| Port binding requires probe success | NFR (handoff-design.md) | Factory throws before returning on probe failure |
| Provider transparency | NFR (handoff-design.md) | No claude-code conditional logic above `dependencies.ts` boundary |
| Not suitable for headless deployments | US-04 | Documentation requirement; no runtime enforcement |

---

## Upstream Changes to DISCUSS Assumptions

None. All assumptions from the DISCUSS wave hold:

- Extension point confirmed: `dependencies.ts` lines 62–65 dispatch and factory pattern are exactly as documented
- Config conditional for `OPENROUTER_API_KEY` is already provider-conditional (line 53–55 in config.ts) — the claude-code extension is straightforward
- Dynamic import pattern already exists in the codebase (`sandbox-agent` at lines 84–88) — no new Bun/TS behavior needed
- `configOverrides` acceptance test pattern confirmed present and working

One clarification added by DESIGN wave: the `DISCUSS` wave left package classification as an open question. DESIGN resolves it as `optionalDependencies` (see ADR D2).

---

## Handoff to Acceptance Designer (DISTILL wave)

### AC Guidance

All acceptance criteria in US-01 through US-03 are behavioral and observable. No AC references internal implementation. The following test surface map supports the acceptance designer:

| Test surface | File | What to assert |
|-------------|------|---------------|
| Config parsing | Unit test of `loadServerConfig()` with mocked `Bun.env` | Provider union accepts `claude-code`; optional fields parse correctly; invalid values throw with correct messages |
| Factory dispatch | Unit test or acceptance test with `configOverrides` | When `inferenceProvider: "claude-code"`, `createRuntimeDependencies` returns 6 defined model objects |
| Startup probe — missing package | Unit test with mocked dynamic import failure | Error message contains package name and install command |
| Startup probe — missing CLI | Unit test with mocked CLI detection failure | Error message contains `npm install -g @anthropic-ai/claude-code` |
| Startup probe — unauthenticated | Unit test with mocked auth state failure | Error message contains `claude login` |
| streamText integration | Smoke test (`tests/acceptance/`) | At least one text delta received; stream completes |
| generateObject integration | Smoke test (`tests/acceptance/`) | Valid extraction schema output; at least one entity |
| Skip behavior | Smoke test | Tests skip (not fail) when provider is not `claude-code` |
| Existing provider regression | Existing acceptance suite (no changes) | OpenRouter and Ollama paths unaffected |

### Journey reference

`docs/feature/claude-agent-sdk-provider/discuss/journey-claude-provider-setup.yaml` contains embedded Gherkin per step. Integration points at steps 2→3→4 (config parsing → factory dispatch → stream output) are the primary test surface.

---

## Handoff to Platform Architect (DEVOPS wave)

**Architecture pattern**: modular monolith, ports-and-adapters (unchanged from existing deployment)

**Development paradigm**: functional (pure functions, immutable config, no module-level state)

**External integration**: `ai-sdk-provider-claude-code` (npm, ben-vargas/ai-sdk-provider-claude-code, MIT license). This is a third-party package wrapping the Claude Code CLI. No network calls from Osabio to an external API — the provider communicates with the Claude Code CLI process locally.

**Contract test note**: Pact-style consumer-driven contracts are not applicable (the contract is the TypeScript `LanguageModel` interface, enforced at compile time). The smoke test in CI serves as the integration validation gate. Recommend: run smoke test as a non-blocking CI step gated on `INFERENCE_PROVIDER=claude-code` environment availability.

**Deployment constraint**: the claude-code provider requires an interactive host machine with Claude Code installed and authenticated. It is not deployable in Docker containers, Kubernetes pods, or any headless CI environment that does not have Claude Code authenticated. Operators in those environments must use `openrouter` or `ollama`.

**No new infrastructure required**: this feature is a code change only. No new services, databases, queues, or deployment targets.

---

## Quality Gates — All Passed

- [x] Requirements traced to components (US-01→config.ts, US-02→dependencies.ts, US-03→smoke test, US-04→README)
- [x] Component boundaries with clear responsibilities (2 modified files, 1 new test, 1 doc update)
- [x] Technology choices in ADR with alternatives (adr-claude-provider.md — 3 alternatives evaluated)
- [x] Quality attributes addressed (maintainability, reliability, testability, portability documented)
- [x] Dependency-inversion compliance (all agents consume LanguageModel interface; provider impl below boundary)
- [x] C4 diagrams (L1 System Context + L2 Container in Mermaid, in brief.md)
- [x] Integration patterns specified (startup sequence, probe contract, dispatch conditional)
- [x] OSS preference validated (ai-sdk-provider-claude-code is MIT; no proprietary dependencies added)
- [x] AC behavioral, not implementation-coupled (all ACs describe observable behavior)
- [x] External integrations annotated (ai-sdk-provider-claude-code noted; Pact inapplicable, smoke test is the gate)
- [x] Architectural enforcement tooling recommended (TypeScript union exhaustiveness)
- [x] Functional paradigm respected (pure factories, no mutable singletons, no module-level state)

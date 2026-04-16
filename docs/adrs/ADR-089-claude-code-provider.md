# ADR: claude-code Provider Integration

**ID**: ADR-089
**Status**: Accepted
**Date**: 2026-04-16
**Deciders**: Morgan (Solution Architect, DESIGN wave)
**Feature**: claude-agent-sdk-provider

---

## Context

Osabio currently supports two inference providers: OpenRouter (cloud, requires API key) and Ollama (local, requires model installation). Both providers are wired in `runtime/dependencies.ts` as inline factory functions (`createOpenRouterModels`, `createOllamaModels`) that return six Vercel AI SDK `LanguageModel` objects.

A third provider is needed: `ai-sdk-provider-claude-code`, a third-party npm package that wraps the Claude Code CLI as a Vercel AI SDK v6-compatible provider. This allows developers with an existing Claude Pro subscription and Claude Code installed to run all Osabio agents without creating additional provider accounts.

Key constraints from the DISCUSS wave:
- The package must be optional — existing OpenRouter/Ollama users must not be required to install it
- The factory must be lazy-loaded — the package import must not execute on `openrouter` or `ollama` startup paths
- The provider must produce structurally identical output to the existing providers (same 6 model fields)
- Probe failures (missing CLI, unauthenticated) must prevent server startup with actionable error messages
- Functional paradigm applies: pure functions, no mutable singletons, no module-level state

---

## Decision

Extend `runtime/dependencies.ts` with a new `createClaudeCodeModels(config, wrap)` factory function following the existing factory pattern. Add `"claude-code"` as a third branch in the provider dispatch conditional. Use a dynamic `import()` call inside the factory body to lazy-load `ai-sdk-provider-claude-code` — identical to the existing `sandbox-agent` dynamic import pattern at lines 84–88.

Classify `ai-sdk-provider-claude-code` as a `dependencies` entry in `package.json`.

Extend `runtime/config.ts` to add `"claude-code"` to the `InferenceProvider` union and parse two optional env vars: `CLAUDE_CODE_EFFORT` and `CLAUDE_CODE_MAX_BUDGET_USD`.

---

## Alternatives Considered

### Alternative 1: Separate provider module (`runtime/providers/claude-code.ts`)

Extract the new factory into a dedicated file, dynamically import the module from `dependencies.ts` when the provider is `claude-code`.

**Evaluation**:
- Adds one more file and one more indirection level for a ~40-line addition
- The existing `createOpenRouterModels` and `createOllamaModels` are inline in `dependencies.ts` — consistency favors inline
- Does not improve testability (the module still needs to be called with `config`)
- Justification for extraction only exists if the factory were >200 lines or had its own test file — neither applies here

**Rejected**: added indirection without commensurate benefit. Violates simplest-solution-first principle.

### Alternative 2: Provider registry map

Introduce a `Map<InferenceProvider, ProviderFactory>` or similar registry pattern where factories are registered by key and looked up at runtime.

**Evaluation**:
- Useful when: provider count is large (>5), providers are added at runtime, or providers come from plugins
- Current state: three providers, all known at compile time, added via code changes
- Adds an abstraction layer that new maintainers must understand before making any provider change
- YAGNI: the registry adds no capability that a three-way conditional doesn't provide

**Rejected**: premature generalization. Three providers do not justify a registry.

### Alternative 3: `devDependencies` classification for `ai-sdk-provider-claude-code`

Classify the package as a development dependency.

**Evaluation**:
- `bun install --production` skips dev dependencies — the server would fail at runtime when `INFERENCE_PROVIDER=claude-code` is set in a production-adjacent environment
- Dev deps signal "only needed for testing/building" — this package is a runtime dependency for the claude-code path
- Would require custom install instructions ("if you want claude-code, also run X")

**Rejected**: semantically incorrect and breaks production-mode installs.

---

## Consequences

### Positive
- Blast radius is minimal: 2 existing files changed, 1 test file added
- Pattern is immediately recognizable to any contributor familiar with the existing provider factories
- TypeScript type system enforces provider union completeness at compile time
- Lazy loading via dynamic import ensures zero performance cost for OpenRouter/Ollama users
- `dependencies` classification is correct for an application — all runtime dependencies are always installed
- Startup probe prevents silent runtime failures — all failure modes produce actionable error messages

### Negative
- `dependencies.ts` grows by ~40 lines. At current scale this is acceptable; at >300 lines of factory code, extraction to separate modules would be warranted
- `ai-sdk-provider-claude-code` is a third-party package from an individual maintainer (ben-vargas). It is not an Anthropic official package. Package abandonment is a risk; the smoke test provides continuous validation that the package remains AI SDK v6-compatible

### Quality Attribute Impact

| Attribute | Impact | Direction |
|-----------|--------|-----------|
| Maintainability | Low change; consistent with existing pattern | Positive |
| Reliability | Startup probe prevents silent failures | Positive |
| Portability | New provider is dev-machine-only; headless deployments unchanged | Neutral |
| Performance | Dynamic import adds ~5ms to startup on claude-code path only | Negligible |
| Testability | Pure factory function; configOverrides test pattern; no env mutation | Positive |
| Security | No new secrets; Claude Code manages own auth state | Positive |

---

## Package Dependency Classification: `dependencies`

This is an application, not a library. Runtime dependencies belong in `dependencies` and are always installed.

| Classification | Bun/npm behavior | Production install | Notes |
|---------------|-----------------|-------------------|-------|
| `dependencies` ✓ | Always installed | Always installed | Correct for app runtime deps |
| `devDependencies` | Installed in dev | Skipped | Wrong — breaks production installs |
| `optionalDependencies` | Install attempted; skip on failure | Install attempted; skip on failure | For libraries avoiding transitive installs — not applicable here |
| `peerDependencies` | Not auto-installed | Not auto-installed | Wrong — places install burden on user |

`dependencies` is correct: this is an application, so all runtime packages are unconditionally installed. The `optionalDependencies` classification is a library concern (avoiding forcing transitive installs on library consumers) and does not apply here.

---

## References

- `app/src/server/runtime/dependencies.ts` — existing provider factory pattern (lines 116–149)
- `app/src/server/runtime/config.ts` — existing `InferenceProvider` union and `parseInferenceProvider()` (lines 10, 187–192)
- `docs/feature/claude-agent-sdk-provider/discuss/handoff-design.md` — DISCUSS wave extension points
- `docs/feature/claude-agent-sdk-provider/discuss/user-stories.md` — US-01 through US-04

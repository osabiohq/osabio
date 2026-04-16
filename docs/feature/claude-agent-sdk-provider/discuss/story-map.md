# Story Map: Claude Code Provider Setup

## User
Priya Kapoor — developer deploying Osabio, has Claude Pro subscription and Claude Code installed, no OpenRouter account.

## Goal
Run Osabio agents through an existing Claude subscription with zero new API keys, in a single configuration session.

---

## Backbone

| Configure Provider | Wire Provider Factory | Validate Agents Work | Document Setup |
|--------------------|----------------------|---------------------|----------------|
| Add `claude-code` to `InferenceProvider` type | Create `createClaudeCodeModels()` factory | `streamText()` works via claude-code | Write README prerequisites section |
| Parse `INFERENCE_PROVIDER=claude-code` in config | Dispatch to factory in `createRuntimeDependencies()` | `generateObject()` works via claude-code | Document env var reference |
| Parse optional `CLAUDE_CODE_EFFORT` | Pass effort/budget options to factory | Smoke test covers both interfaces | |
| Parse optional `CLAUDE_CODE_MAX_BUDGET_USD` | Surface missing/unauth CLI as clear startup error | | |
| Skip `OPENROUTER_API_KEY` requirement for claude-code | Add `ai-sdk-provider-claude-code` to package.json | | |

---

### Walking Skeleton

Minimum end-to-end slice that proves the flow works:

1. **Configure**: `InferenceProvider` type includes `claude-code`; `loadServerConfig()` accepts it without requiring `OPENROUTER_API_KEY`
2. **Wire Factory**: `createClaudeCodeModels()` returns model objects; `createRuntimeDependencies()` dispatches to it
3. **Validate**: `streamText()` returns a valid response through the provider (smoke test passes)
4. **Document**: One-paragraph prerequisite note added to README

This is the thinnest slice that connects all four activities. Each story in the walking skeleton can be built in under a day.

---

### Release 1: Zero-Config Working Setup
**Outcome targeted**: Developer runs `bun run dev` with `INFERENCE_PROVIDER=claude-code` and agents respond — 0 additional provider accounts needed.

Tasks included:
- Add `claude-code` to `InferenceProvider` type (config)
- Parse provider in `loadServerConfig()` without requiring OpenRouter key
- Parse optional `CLAUDE_CODE_EFFORT` and `CLAUDE_CODE_MAX_BUDGET_USD`
- Add `ai-sdk-provider-claude-code` to `package.json`
- Create `createClaudeCodeModels()` factory with effort/budget options
- Dispatch to factory in `createRuntimeDependencies()`
- Surface actionable startup error when Claude Code CLI missing or unauthenticated
- Smoke test: `streamText()` and `generateObject()` work

**KPI targeted**: Developer completes provider setup without opening a browser or creating an account

---

### Release 2: Developer Confidence — Documentation and Error Quality
**Outcome targeted**: Developer self-serves the setup without contacting maintainers — discovery and error recovery are friction-free.

Tasks included:
- README prerequisites section (Claude Code install + authenticate)
- Env var reference table (`CLAUDE_CODE_EFFORT`, `CLAUDE_CODE_MAX_BUDGET_USD`)
- Error message when invalid `CLAUDE_CODE_EFFORT` value supplied
- Error message when `CLAUDE_CODE_MAX_BUDGET_USD` is non-numeric

**KPI targeted**: Zero "how do I set up claude-code provider?" issues filed after first release

---

## Scope Assessment: PASS

4 user stories, 2 bounded contexts (config + inference), estimated 3–4 days total, single verifiable outcome per story.

No oversized signals present.

---

## Priority Rationale

| Priority | Story | Rationale |
|----------|-------|-----------|
| 1 | US-01: Config type + parsing | Foundation — nothing else can be built without this. Blocks all other stories. |
| 2 | US-02: Provider factory | Core behavior — once config compiles, factory is the second gate. |
| 3 | US-03: Smoke test | Validates the integration works end-to-end before documentation. |
| 4 | US-04: Documentation | Reduces friction after the feature works; not a blocker for functionality. |

Dependency chain: US-01 → US-02 → US-03 → US-04 (linear, no parallel paths needed given small scope).

Riskiest assumption: `ai-sdk-provider-claude-code` v3.x produces AI SDK v6-compatible objects that work with `streamText()` and `generateObject()` without special casing. US-03 validates this assumption before US-04 ships any documentation.

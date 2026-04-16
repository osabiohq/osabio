# Wave Decisions: claude-agent-sdk-provider

## Feature
Add `ai-sdk-provider-claude-code` as a third inference provider factory alongside OpenRouter and Ollama.

## Pre-selected Decisions (from issue #201)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Feature Type | Backend — provider factory, config wiring | No UI surface; developer-facing configuration only |
| Walking Skeleton | Not needed as separate phase | Feature is well-scoped; existing provider pattern is the skeleton |
| UX Research Depth | Lightweight — developer experience (DX) focus | Backend infrastructure feature; focus on setup journey and error messages |
| JTBD Analysis | Yes | Properly frames the "developer job" and surfaces forces that shape requirements |

## Risks

### DIVERGE Wave Artifacts Missing
No `docs/feature/claude-agent-sdk-provider/diverge/recommendation.md` or `job-analysis.md` found.
This wave runs without validated JTBD from a prior DIVERGE session. JTBD analysis is performed inline (Phase 1) using the issue context as the primary input.
**Mitigation**: Job analysis is grounded in the issue description and the existing provider pattern in `dependencies.ts`. Treat job statement as `provisional` — validate with maintainers before DESIGN wave.

### External Package Dependency
`ai-sdk-provider-claude-code` v3.x is a third-party package (`ben-vargas/ai-sdk-provider-claude-code`). It is not yet in the project's `package.json`.
**Mitigation**: US-04 (Smoke Test) validates the package works correctly before any downstream agent relies on it.

### Claude Code Authentication
The provider requires a locally installed and authenticated Claude Code CLI. This is a prerequisite outside Osabio's control.
**Mitigation**: Documentation requirement is explicit in scope (US-03). Failure path when Claude Code is absent must surface a clear, actionable error (US-02).

## Extension Point Confirmed
`app/src/server/runtime/dependencies.ts` lines 62–65 show the current dispatch:
```typescript
config.inferenceProvider === "ollama"
  ? createOllamaModels(config, wrap)
  : createOpenRouterModels(config, wrap);
```
Adding `claude-code` follows the exact same factory function pattern.

`app/src/server/runtime/config.ts` line 10 shows:
```typescript
export type InferenceProvider = "openrouter" | "ollama";
```
`claude-code` must be added as a third union member.

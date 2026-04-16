# DESIGN Wave Handoff: claude-agent-sdk-provider

**Prepared by**: Luna (nw-product-owner, DISCUSS wave)
**Handoff to**: solution-architect (DESIGN wave)
**Date**: 2026-04-16
**Peer review**: Approved (iteration 1 — all critical/high remediations applied)

---

## Feature Summary

Add `ai-sdk-provider-claude-code` as a third inference provider, allowing developers to run all Osabio agents through their existing Claude subscription via a locally installed Claude Code CLI — no new API keys or accounts required.

**Job statement**: When I want to run Osabio agents on my own infrastructure and I already have Claude Code installed and authenticated, I want to configure `INFERENCE_PROVIDER=claude-code` and have agents work transparently, so I can get a working Osabio instance without creating new provider accounts.

---

## Artifact Index

| Artifact | Path |
|----------|------|
| Wave decisions | `docs/feature/claude-agent-sdk-provider/discuss/wave-decisions.md` |
| Journey visual | `docs/feature/claude-agent-sdk-provider/discuss/journey-claude-provider-setup-visual.md` |
| Journey YAML schema | `docs/feature/claude-agent-sdk-provider/discuss/journey-claude-provider-setup.yaml` |
| Story map | `docs/feature/claude-agent-sdk-provider/discuss/story-map.md` |
| Shared artifacts registry | `docs/feature/claude-agent-sdk-provider/discuss/shared-artifacts-registry.md` |
| User stories | `docs/feature/claude-agent-sdk-provider/discuss/user-stories.md` |
| Outcome KPIs | `docs/feature/claude-agent-sdk-provider/discuss/outcome-kpis.md` |
| DoR validation | `docs/feature/claude-agent-sdk-provider/discuss/dor-validation.md` |
| Peer review | `docs/feature/claude-agent-sdk-provider/discuss/peer-review.md` |

---

## Stories Ready for DESIGN

| Story | Title | Estimate | Priority | Dependencies |
|-------|-------|----------|----------|--------------|
| US-01 | Config Type and Parsing for claude-code Provider | 0.5 days | P1 | None |
| US-02 | Provider Factory for claude-code | 1 day | P2 | US-01 |
| US-03 | Smoke Test — Verify Provider Integration End-to-End | 0.5 days | P3 | US-02 |
| US-04 | Developer Setup Documentation | 0.5 days | P4 | US-02 |

**Total estimated effort**: 2.5 days

---

## Key Extension Points (for DESIGN wave)

### `app/src/server/runtime/config.ts`
- `InferenceProvider` type: add `"claude-code"` union member (line 10)
- `ServerConfig` type: add `claudeCodeEffort?: "low" | "normal" | "high"` and `claudeCodeMaxBudgetUsd?: number`
- `loadServerConfig()`: remove `OPENROUTER_API_KEY` requirement when provider is `claude-code`; add optional parsing for `CLAUDE_CODE_EFFORT` and `CLAUDE_CODE_MAX_BUDGET_USD`
- `parseInferenceProvider()`: add `"claude-code"` case (line 187–192)

### `app/src/server/runtime/dependencies.ts`
- New function: `createClaudeCodeModels(config: ServerConfig, wrap: (model: any) => any)` — dynamic import of `ai-sdk-provider-claude-code`, returns all six model fields
- Update dispatch ternary (line 62–65) to include `claude-code` case
- Error detection at factory init time for missing/unauthenticated Claude Code CLI

### `package.json`
- Add `ai-sdk-provider-claude-code@^3.0.0` — DESIGN wave decides classification: `optional`, `peerDependency`, or `devDependency`. The requirement is that OpenRouter/Ollama users must NOT be required to install it.

---

## Non-Functional Requirements

| NFR | Requirement |
|-----|-------------|
| Optional package | `ai-sdk-provider-claude-code` must not be a hard runtime dependency. OpenRouter/Ollama users must not require it. Missing package with `INFERENCE_PROVIDER=claude-code` must produce clear startup error with install command. |
| Headless environments | claude-code provider requires interactive host with Claude Code authenticated. Not suitable for Docker/Kubernetes. Documentation must state this. |
| Provider transparency | All consumers above `dependencies.ts` (chat agent, extraction pipeline, PM agent, etc.) must work identically regardless of which provider is active. No special-casing in consumers. |
| Startup fail-fast | Missing or unauthenticated Claude Code must be detected at startup (before binding port), not lazily on first inference call. |
| Budget exhaustion handling | When `CLAUDE_CODE_MAX_BUDGET_USD` is exceeded, the error must surface in the chat stream as a human-readable message. Server must continue running. |

---

## Risks for DESIGN Wave Attention

| Risk | Probability | Impact | Suggested Mitigation |
|------|-------------|--------|----------------------|
| `ai-sdk-provider-claude-code` v3.x produces non-standard stream events incompatible with AI SDK v6 consumers | Medium | High | Validate with smoke test (US-03) before marking feature complete. |
| Package dependency classification causes install side-effects for existing users | Low | Low | `dependencies` classification resolved by DESIGN wave — this is an app, not a library; always installed. |
| Claude Code CLI detection at startup is platform-specific (path resolution on macOS vs Linux vs Windows) | Medium | Medium | Test on all target platforms in CI. |
| `CLAUDE_CODE_MAX_BUDGET_USD` mid-session failure mode is provider-specific — behavior may differ from what the requirement specifies | Medium | Medium | Validate behavior in smoke test. If provider does not support budget caps at this granularity, remove the config option and note in documentation. |

---

## Out of Scope (deferred)

The following items were explicitly excluded from this feature per issue #201. They should be tracked as GitHub issues to prevent silent loss:

1. **Mixed-provider routing** — routing different agents to different providers (e.g., claude-code for chat, OpenRouter for extraction)
2. **Session persistence mapping** — mapping Claude Code sessions to Osabio `agent_session` graph records
3. **MCP server passthrough** — forwarding Osabio's tool registry to Claude Agent SDK's MCP support

Each of these should be created as a GitHub issue with label `deferred` referencing issue #201.

---

## Acceptance Designer (DISTILL wave) Notes

- Journey YAML at `journey-claude-provider-setup.yaml` contains embedded Gherkin per step — use as source for acceptance test scenarios
- Integration points at steps 2→3→4 are the primary test surface: config parsing → factory dispatch → stream output
- Shared artifact `stream_response_shape` has CRITICAL integration risk — acceptance tests must assert structural identity of provider output with existing provider expectations

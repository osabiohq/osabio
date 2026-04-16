# Shared Artifacts Registry: claude-agent-sdk-provider

## Purpose
Every `${variable}` appearing across journey steps and TUI mockups has a documented single source of truth and list of consumers. Untracked artifacts are the primary cause of horizontal integration failures.

---

## Artifact Registry

```yaml
shared_artifacts:

  inference_provider_value:
    source_of_truth: "INFERENCE_PROVIDER environment variable → config.ts InferenceProvider type"
    consumers:
      - "config.ts parseInferenceProvider() — parses and validates"
      - "config.ts loadServerConfig() — stored as inferenceProvider field"
      - "dependencies.ts createRuntimeDependencies() — dispatch condition"
      - "server startup log line [runtime] Inference provider: ..."
    owner: "US-01 (Config Extension)"
    integration_risk: "HIGH — if InferenceProvider type does not include 'claude-code', TypeScript compilation fails; if dispatch condition omits it, factory is never called"
    validation: "Compile-time: TypeScript type check. Runtime: parseInferenceProvider() throws on unknown value. Smoke test: server starts with INFERENCE_PROVIDER=claude-code"

  chat_model_id:
    source_of_truth: "CHAT_AGENT_MODEL environment variable → config.chatAgentModelId"
    consumers:
      - "config.ts loadServerConfig() — unchanged, required"
      - "createClaudeCodeModels() — passed as model identifier"
      - "server startup log"
      - "smoke test env setup"
    owner: "US-01 / US-02 (existing field, no change)"
    integration_risk: "LOW — field is unchanged; risk is only that claude-code provider may not recognize model IDs that OpenRouter uses"
    validation: "Smoke test: model ID accepted by ai-sdk-provider-claude-code without error"

  claude_code_effort:
    source_of_truth: "CLAUDE_CODE_EFFORT environment variable → config.claudeCodeEffort (optional)"
    consumers:
      - "config.ts loadServerConfig() — new optional field"
      - "createClaudeCodeModels() — passed as provider option if present"
    owner: "US-01 / US-02"
    integration_risk: "LOW — optional field; absence means provider default behavior"
    validation: "Config test: valid values (low|normal|high) accepted; invalid value throws at startup"

  claude_code_budget:
    source_of_truth: "CLAUDE_CODE_MAX_BUDGET_USD environment variable → config.claudeCodeMaxBudgetUsd (optional)"
    consumers:
      - "config.ts loadServerConfig() — new optional numeric field"
      - "createClaudeCodeModels() — passed as provider option if present"
    owner: "US-01 / US-02"
    integration_risk: "LOW — optional field; absence means no budget cap"
    validation: "Config test: numeric value parsed correctly; non-numeric throws at startup"

  provider_package_version:
    source_of_truth: "package.json dependency: ai-sdk-provider-claude-code"
    consumers:
      - "bun.lock"
      - "README prerequisites section"
      - "smoke test import"
    owner: "US-02 (Provider Factory)"
    integration_risk: "HIGH — version must be AI SDK v6 compatible (^3.0.0); wrong major version causes incompatible model object shapes"
    validation: "Install test: bun add succeeds. Import test: claudeCode() produces LanguageModel object accepted by streamText()"

  stream_response_shape:
    source_of_truth: "Vercel AI SDK streamText() / generateObject() output contract (ai package)"
    consumers:
      - "chat/handler.ts runChatAgent() — consumes streamText() output"
      - "extraction pipeline — consumes generateObject() output"
      - "frontend chat UI — consumes SSE stream format"
      - "smoke test assertions"
    owner: "US-03 (Smoke Test)"
    integration_risk: "CRITICAL — if claude-code provider produces non-standard stream events, chat UI and extraction pipeline break silently"
    validation: "Smoke test: response from streamText() contains text deltas in expected format; generateObject() produces typed object matching schema"

  startup_provider_confirmation:
    source_of_truth: "Runtime log output from createRuntimeDependencies()"
    consumers:
      - "Developer reading terminal"
      - "Smoke test: asserts log contains provider name"
    owner: "US-02 (Provider Factory)"
    integration_risk: "LOW — informational only; absence confuses developers but does not break functionality"
    validation: "Smoke test: startup log contains '[runtime] Inference provider: claude-code'"
```

---

## Integration Validation Checkpoints

| Checkpoint | Artifact | Test |
|------------|---------|------|
| `InferenceProvider` type includes `'claude-code'` | `inference_provider_value` | TypeScript compilation passes |
| `loadServerConfig()` does not require `OPENROUTER_API_KEY` when provider is `claude-code` | `inference_provider_value` | Unit test: config loads without OpenRouter key |
| `createRuntimeDependencies()` calls `createClaudeCodeModels()` when provider is `claude-code` | `inference_provider_value` | Unit test: correct factory called |
| `ai-sdk-provider-claude-code` model objects accepted by `streamText()` | `stream_response_shape`, `provider_package_version` | Smoke test: streamText() completes without type error |
| `generateObject()` produces typed extraction output | `stream_response_shape` | Smoke test: extraction result matches schema |
| Startup confirms provider identity in log | `startup_provider_confirmation` | Smoke test: log assertion |

---

## Undocumented Artifact Risk

The following values appear in TUI mockups but do not have new configuration requirements — they are consumed from existing artifacts:

| Mockup variable | Existing source | Risk |
|-----------------|-----------------|------|
| `${PORT}` | `PORT` env var → `config.port` | None — unchanged |
| `${EXTRACTION_MODEL_ID}` | `EXTRACTION_MODEL` env var | None — unchanged, used for 5 of 6 models |
| `${SDK_VERSION}` | `@anthropic/claude-agent-sdk` peer dep | Low — peer dep installed automatically with provider package |

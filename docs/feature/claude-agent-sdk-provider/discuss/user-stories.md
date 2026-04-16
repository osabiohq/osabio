<!-- markdownlint-disable MD024 -->

# User Stories: claude-agent-sdk-provider

## Job Statement (JTBD — Provisional, no prior DIVERGE wave)

**Job**: When I want to run Osabio agents on my own infrastructure, I want to use my existing Claude subscription without creating a new provider account, so I can get agents running in a single configuration session with credentials I already have.

### Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | Needing to sign up for OpenRouter or configure Ollama is friction; Priya already pays for Claude Pro and has Claude Code installed and working |
| **Pull** | One env var change (`INFERENCE_PROVIDER=claude-code`) and existing credentials work; time to first agent response under 10 minutes |
| **Anxiety** | "Will the claude-code provider behave differently? Will my agents return different quality responses? What if Claude Code breaks mid-session?" |
| **Habit** | Developers are used to `.env` files and `bun install`; the setup pattern should feel identical to switching from OpenRouter to Ollama |

### Job Story
When I am setting up Osabio and I already have Claude Code installed and authenticated on my machine, I want to configure `INFERENCE_PROVIDER=claude-code` and have all agents work transparently, so I can get a working Osabio instance without creating new provider accounts.

---

## System Constraints

- All new configuration fields follow the existing `config.ts` pattern: parsed once in `loadServerConfig()`, typed in `ServerConfig`, injected through dependency chain — no `process.env` in application code.
- `ai-sdk-provider-claude-code` is a regular `dependencies` entry — this is an app, not a library, so all runtime dependencies are always installed. DESIGN wave resolved the classification as `dependencies`.
- Provider factory output must be structurally identical to OpenRouter and Ollama factory output: the same `chatAgentModel`, `extractionModel`, `pmAgentModel`, `analyticsAgentModel`, `observerModel`, `scorerModel` fields, all Vercel AI SDK `LanguageModel` compatible.
- No `null` in configuration values — absent optional fields are omitted (`field?: Type`).
- Secrets must never be accepted via CLI flags — credentials come from Claude Code's own authentication state, not environment variables.
- The claude-code provider requires an interactive host where Claude Code is installed and authenticated. It is not suitable for fully headless deployments (Docker containers, Kubernetes pods). Operators deploying Osabio in headless environments should use `INFERENCE_PROVIDER=openrouter` or `INFERENCE_PROVIDER=ollama`.

---

## US-01: Config Type and Parsing for claude-code Provider

### Problem
Priya is a developer deploying Osabio who already has a Claude Pro subscription and Claude Code installed. She finds it impossible to run Osabio because `INFERENCE_PROVIDER` only accepts `openrouter` and `ollama`, and the config crashes at startup demanding `OPENROUTER_API_KEY` even when she has no OpenRouter account.

### Who
- Developer setting up Osabio for the first time | Has Claude subscription | Does not have OpenRouter API key

### Solution
Extend `InferenceProvider` type to include `"claude-code"` and update `loadServerConfig()` to accept and parse it — including optional `CLAUDE_CODE_EFFORT` and `CLAUDE_CODE_MAX_BUDGET_USD` — without requiring `OPENROUTER_API_KEY`.

### Domain Examples

#### 1: Happy Path — Priya configures claude-code
Priya sets `INFERENCE_PROVIDER=claude-code` in her `.env` file. She does not set `OPENROUTER_API_KEY`. She runs `bun run dev`. `loadServerConfig()` parses the provider as `"claude-code"`, does not require an OpenRouter key, and returns a valid `ServerConfig` with `inferenceProvider: "claude-code"`.

#### 2: Optional Controls — Reza sets effort and budget limits
Reza is a developer on a shared team instance. He sets `CLAUDE_CODE_EFFORT=high` and `CLAUDE_CODE_MAX_BUDGET_USD=5.00`. Config parses `claudeCodeEffort: "high"` and `claudeCodeMaxBudgetUsd: 5.00` into `ServerConfig`. Both are optional — his colleague's instance omits them and still boots cleanly.

#### 3: Error Case — Invalid provider value rejected at startup
Priya makes a typo: `INFERENCE_PROVIDER=claudecode` (missing hyphen). `parseInferenceProvider()` throws: "INFERENCE_PROVIDER must be one of: openrouter, ollama, claude-code". Server does not start. Error message is the full list of valid values.

### UAT Scenarios (BDD)

#### Scenario: Osabio starts without an OpenRouter key when using claude-code
Given Priya has set `INFERENCE_PROVIDER=claude-code` in her environment
And `OPENROUTER_API_KEY` is not set
When `loadServerConfig()` is called
Then configuration loads successfully
And `inferenceProvider` equals `"claude-code"`
And `openRouterApiKey` is `undefined`

#### Scenario: Optional effort and budget controls are parsed into config
Given Priya has set `CLAUDE_CODE_EFFORT=normal` and `CLAUDE_CODE_MAX_BUDGET_USD=2.50`
When `loadServerConfig()` is called
Then `claudeCodeEffort` equals `"normal"`
And `claudeCodeMaxBudgetUsd` equals `2.50`

#### Scenario: Provider config boots cleanly when optional fields are absent
Given Priya has not set `CLAUDE_CODE_EFFORT` or `CLAUDE_CODE_MAX_BUDGET_USD`
When `loadServerConfig()` is called with `INFERENCE_PROVIDER=claude-code`
Then configuration loads without error
And `claudeCodeEffort` is absent from the config object
And `claudeCodeMaxBudgetUsd` is absent from the config object

#### Scenario: Invalid INFERENCE_PROVIDER value is rejected with helpful message
Given Priya has set `INFERENCE_PROVIDER=claudecode` (typo, missing hyphen)
When `loadServerConfig()` is called
Then an error is thrown
And the error message lists all valid values: "openrouter", "ollama", "claude-code"

#### Scenario: Invalid effort value is rejected at startup
Given Priya has set `CLAUDE_CODE_EFFORT=maximum` (not a valid value)
When `loadServerConfig()` is called
Then an error is thrown
And the error message lists valid values: "low", "normal", "high"

### Acceptance Criteria
- [ ] `InferenceProvider` type union includes `"claude-code"`
- [ ] `loadServerConfig()` does not throw when `INFERENCE_PROVIDER=claude-code` and `OPENROUTER_API_KEY` is unset
- [ ] `CLAUDE_CODE_EFFORT` is parsed as optional; valid values: `low`, `normal`, `high`; invalid value throws at startup with list of valid values
- [ ] `CLAUDE_CODE_MAX_BUDGET_USD` is parsed as optional positive number; non-numeric throws at startup
- [ ] Invalid `INFERENCE_PROVIDER` value throws with error listing all three valid values

### Outcome KPIs
- **Who**: Developer deploying Osabio with Claude subscription
- **Does what**: Completes configuration without creating a new provider account
- **By how much**: Config step takes under 2 minutes (3 env vars vs 5+ for OpenRouter)
- **Measured by**: Developer self-report in onboarding survey (post-release)
- **Baseline**: Currently impossible — config crashes on missing OPENROUTER_API_KEY

### Technical Notes
- `InferenceProvider` union: `"openrouter" | "ollama" | "claude-code"` (config.ts line 10)
- `OPENROUTER_API_KEY` is only `requireEnv` when `inferenceProvider === "openrouter"` (already conditional, line 53)
- `claudeCodeEffort` and `claudeCodeMaxBudgetUsd` added as optional fields to `ServerConfig` type
- No null values — optional fields omitted when not set

---

## US-02: Provider Factory for claude-code

### Problem
Priya is a developer who has configured `INFERENCE_PROVIDER=claude-code` in her `.env` file. She finds it impossible to run the server because `createRuntimeDependencies()` only knows about OpenRouter and Ollama — there is no factory to create model objects for the claude-code provider. Her agents never start.

### Who
- Developer who has completed US-01 config setup | Claude Code installed and authenticated

### Solution
Create `createClaudeCodeModels()` factory function and wire it into `createRuntimeDependencies()` dispatch. Factory dynamically imports `ai-sdk-provider-claude-code`, passes effort/budget options from config, and returns the standard six model object fields. Surfaces a clear, actionable startup error when Claude Code CLI is absent or unauthenticated.

### Domain Examples

#### 1: Happy Path — Priya's factory initializes all six models
Priya starts the server with `INFERENCE_PROVIDER=claude-code`. `createRuntimeDependencies()` dispatches to `createClaudeCodeModels()`. The factory imports `ai-sdk-provider-claude-code`, calls `claudeCode('claude-sonnet-4-5')` for the chat model and `claudeCode('claude-haiku-4-5')` for the remaining five models. All six model objects are returned as Vercel AI SDK `LanguageModel` instances. Server starts successfully and logs provider identity.

#### 2: Optional Controls — Reza's factory respects effort config
Reza's config has `claudeCodeEffort: "high"` and `claudeCodeMaxBudgetUsd: 5.00`. `createClaudeCodeModels()` passes these as provider-level options to every model created through the factory. Inference calls made by agents use high-effort mode with a $5 budget cap.

#### 3: Error Path — Claude Code not authenticated at server start
Priya installed Claude Code but forgot to run `claude login`. At startup, the factory detects the unauthenticated state and throws a startup error: "Claude Code is not authenticated. Run: claude login". The server does not start. Priya runs `claude login` and restarts — server boots cleanly.

### UAT Scenarios (BDD)

#### Scenario: Provider factory produces all six model objects when Claude Code is available
Given `INFERENCE_PROVIDER=claude-code` and Claude Code is installed and authenticated
When `createRuntimeDependencies()` is called during server startup
Then `chatAgentModel`, `extractionModel`, `pmAgentModel`, `analyticsAgentModel`, `observerModel`, and `scorerModel` are all defined
And each model is a valid Vercel AI SDK LanguageModel instance
And the server logs confirm provider identity as "claude-code"

#### Scenario: Effort and budget options are forwarded to the provider
Given `claudeCodeEffort: "high"` and `claudeCodeMaxBudgetUsd: 2.00` are in the server config
When `createClaudeCodeModels()` is called
Then the created models carry the effort and budget options
And inference calls use high effort mode

#### Scenario: Missing Claude Code CLI produces an actionable error at startup
Given `INFERENCE_PROVIDER=claude-code` and the Claude Code CLI is not installed
When the server starts
Then startup fails before binding to any port
And the error message states "Claude Code CLI not found"
And the error message includes the install command: `npm install -g @anthropic-ai/claude-code`
And the error message includes the authentication command: `claude login`

#### Scenario: Unauthenticated Claude Code produces an actionable error at startup
Given `INFERENCE_PROVIDER=claude-code` and Claude Code is installed but not authenticated
When the server starts
Then startup fails before binding to any port
And the error message states "Claude Code is not authenticated"
And the error message includes: `claude login`

#### Scenario: Budget exhaustion surfaces as a readable message in the chat stream
Given `CLAUDE_CODE_MAX_BUDGET_USD` is set to `0.01` (effectively zero)
And the server has started successfully
When an agent inference call is made that exceeds the budget
Then the error appears in the chat stream as a human-readable message
And the server continues accepting new requests

### Acceptance Criteria
- [ ] `createClaudeCodeModels()` factory function exists and is called when `inferenceProvider === "claude-code"`
- [ ] Factory returns all six model fields: `chatAgentModel`, `extractionModel`, `pmAgentModel`, `analyticsAgentModel`, `observerModel`, `scorerModel`
- [ ] `streamText()` completes without error when called with the `chatAgentModel` returned by the factory (verified by US-03 smoke test)
- [ ] `claudeCodeEffort` and `claudeCodeMaxBudgetUsd` from config are forwarded to the provider when present
- [ ] Startup produces actionable error (with remediation commands) if Claude Code CLI is absent
- [ ] Startup produces actionable error (with `claude login` command) if Claude Code is not authenticated
- [ ] Server logs `[runtime] Inference provider: claude-code` and lists configured model IDs on successful startup
- [ ] When `CLAUDE_CODE_MAX_BUDGET_USD` is exceeded during an inference call, the error is surfaced in the chat stream and the server continues running

### Outcome KPIs
- **Who**: Developer setting up Osabio with claude-code provider
- **Does what**: Receives clear error message with specific remediation steps when Claude Code is not ready
- **By how much**: Zero "why won't the server start?" support issues related to missing Claude Code setup
- **Measured by**: GitHub issues filed with tag `inference-provider` after release
- **Baseline**: No current mechanism — `claude-code` is not a valid provider today

### Technical Notes
- `ai-sdk-provider-claude-code` is a dynamic import (not bundled) — `import()` inside the factory, consistent with `sandbox-agent` dynamic import pattern at lines 84–88 of `dependencies.ts`
- `createRuntimeDependencies()` dispatch: ternary extended to: `config.inferenceProvider === "claude-code" ? createClaudeCodeModels(config, wrap) : config.inferenceProvider === "ollama" ? createOllamaModels(config, wrap) : createOpenRouterModels(config, wrap)`
- Error detection (missing CLI / unauthenticated) must be attempted at factory init time, not lazily on first inference call
- `ai-sdk-provider-claude-code` is a `dependencies` entry in `package.json` — this is an app, not a library; all runtime dependencies are always installed (DESIGN wave decision)

---

## US-03: Smoke Test — Verify Provider Integration End-to-End

### Problem
Priya is a developer who has wired up the claude-code provider factory. She finds it stressful to ship the feature without automated verification that `streamText()` and `generateObject()` actually work through `ai-sdk-provider-claude-code` — the riskiest assumption is that the third-party provider package produces AI SDK v6-compatible output.

### Who
- Developer shipping the claude-code provider feature | Wants confidence the integration holds before documenting it

### Solution
A smoke test that starts the Osabio server with `INFERENCE_PROVIDER=claude-code`, sends a minimal `streamText()` call and a minimal `generateObject()` call through the provider, and asserts both return valid results in the expected format.

### Domain Examples

#### 1: Happy Path — Smoke test confirms streamText works
The smoke test sets `INFERENCE_PROVIDER=claude-code` in its config overrides. It sends a one-sentence chat message ("What tasks are open in the compliance audit project?") and asserts the response stream contains at least one text delta, the stream completes without error, and the response is a non-empty string.

#### 2: Happy Path — Smoke test confirms generateObject works
The smoke test calls the extraction pipeline with a message containing a clear entity reference ("The compliance audit deadline is Q3 2026"). It asserts `generateObject()` produces a structured extraction result that matches the extraction schema (non-empty `entities` array, valid `entity_type` fields).

#### 3: Error Path — Smoke test fails descriptively when provider not configured
When a CI run omits `INFERENCE_PROVIDER=claude-code` (defaulting to openrouter), the smoke test is skipped with a clear skip message: "Skipping claude-code smoke test: INFERENCE_PROVIDER is not claude-code". It does not fail — it skips.

### UAT Scenarios (BDD)

#### Scenario: streamText produces a valid response through claude-code
Given the server is started with `INFERENCE_PROVIDER=claude-code`
And Claude Code is installed and authenticated in the test environment
When the smoke test sends a chat message to the chat agent
Then the response stream begins within 5 seconds
And at least one text delta is received
And the stream completes without error

#### Scenario: generateObject produces valid structured output through claude-code
Given the server is started with `INFERENCE_PROVIDER=claude-code`
When the smoke test triggers the extraction pipeline with a message containing entity references
Then `generateObject()` completes without error
And the result matches the extraction output schema
And at least one entity is extracted

#### Scenario: Smoke test is skipped cleanly when claude-code is not the active provider
Given `INFERENCE_PROVIDER` is set to `openrouter` in the test environment
When the claude-code smoke test suite is run
Then all tests in the suite are skipped (not failed)
And the skip reason is logged: "INFERENCE_PROVIDER is not claude-code"

### Acceptance Criteria
- [ ] Smoke test file exists at `tests/acceptance/` covering `streamText()` and `generateObject()` via claude-code provider
- [ ] Both tests pass when `INFERENCE_PROVIDER=claude-code` and Claude Code is authenticated
- [ ] Tests skip (not fail) when `INFERENCE_PROVIDER` is not `claude-code`
- [ ] Smoke test runs in under 30 seconds in a single test run

### Outcome KPIs
- **Who**: Developer shipping the claude-code provider
- **Does what**: Has automated evidence the integration works before writing documentation
- **By how much**: 100% of provider integration assumptions validated by automated test (0 manual verification steps)
- **Measured by**: CI green/pass on the smoke test suite
- **Baseline**: No automated test currently validates any provider integration end-to-end

### Technical Notes
- Uses `AcceptanceSuiteOptions.configOverrides` pattern from `tests/acceptance/acceptance-test-kit.ts` for `INFERENCE_PROVIDER=claude-code` override
- Must use a real Claude Code authentication — not mocked — to validate the actual provider package
- Runs as a separate suite (not mixed with standard acceptance tests) since it requires real Claude Code credentials
- Consistent with the no-`process.env` rule: config override is via `configOverrides` not env mutation

---

## US-04: Developer Setup Documentation

### Problem
Priya is a developer who found the `claude-code` provider option in the README but could not complete setup because there was no documentation about prerequisites (Claude Code install + authentication) or the meaning of `CLAUDE_CODE_EFFORT` and `CLAUDE_CODE_MAX_BUDGET_USD`. She filed a GitHub issue asking "how do I set up the claude-code provider?".

### Who
- Developer discovering Osabio for the first time | Has Claude subscription | Looking for a quickstart path

### Solution
Add a prerequisites section and env var reference for the claude-code provider to the README. Document `INFERENCE_PROVIDER=claude-code`, required Claude Code install and authentication steps, and both optional controls.

### Domain Examples

#### 1: Happy Path — Priya follows README and sets up in under 5 minutes
Priya reads the "Claude Code provider" section of the README. It lists two prerequisite commands (`npm install -g @anthropic-ai/claude-code` and `claude login`), the env vars to set, and a "verify it works" step. She completes setup in 4 minutes and agents are running.

#### 2: Edge Case — Reza reads the env var reference for optional controls
Reza wants to limit spend on a shared team instance. He reads the env var reference table in the README and finds `CLAUDE_CODE_MAX_BUDGET_USD` with a description and example value. He sets it to `10.00` and restarts. No support question needed.

#### 3: Constraint — CI/CD operator deploys Osabio in Docker
A DevOps engineer at a logistics company wants to run Osabio with `INFERENCE_PROVIDER=claude-code` in a Docker container. The README's prerequisites section notes that the claude-code provider requires an interactive host where Claude Code is installed and authenticated — it is not suitable for fully headless deployments. The engineer chooses `INFERENCE_PROVIDER=openrouter` for their container deployment instead.

### UAT Scenarios (BDD)

#### Scenario: README contains claude-code provider prerequisites
Given Priya is reading the Osabio README
When she finds the inference provider configuration section
Then she sees a "Claude Code" subsection listing:
  - prerequisite install command for Claude Code CLI
  - prerequisite authentication command (`claude login`)
  - the env var `INFERENCE_PROVIDER=claude-code`
  - the six model ID env vars with example values

#### Scenario: README documents optional controls with descriptions
Given Priya is reading the env var reference in the README
When she looks up `CLAUDE_CODE_EFFORT`
Then she finds a description of valid values (low, normal, high) and the default behavior
And she finds `CLAUDE_CODE_MAX_BUDGET_USD` with a description of what it controls

#### Scenario: Quickstart profile covers claude-code provider
Given Priya is reading the Quickstart section of the README
When she looks at inference provider configuration
Then the claude-code provider appears as a named option alongside OpenRouter and Ollama

### Acceptance Criteria
- [ ] README includes a "Claude Code provider" subsection under inference provider configuration
- [ ] Subsection lists: Claude Code CLI install command, `claude login` command, `INFERENCE_PROVIDER=claude-code`, six model ID env vars with example values
- [ ] `CLAUDE_CODE_EFFORT` and `CLAUDE_CODE_MAX_BUDGET_USD` are documented in the env var reference table with descriptions and example values
- [ ] Quickstart section lists `claude-code` as a valid `INFERENCE_PROVIDER` option
- [ ] README notes that the claude-code provider requires an interactive host with Claude Code authenticated and is not suitable for headless container deployments

### Outcome KPIs
- **Who**: Developers discovering the claude-code provider
- **Does what**: Complete setup without filing a GitHub issue or asking in community channels
- **By how much**: Zero "how do I set up claude-code provider?" issues filed within 30 days of release
- **Measured by**: GitHub issues with label `inference-provider` and `question` within 30 days
- **Baseline**: No documentation exists today

### Technical Notes
- README lives at the project root (`README.md`) — update the "Quickstart → 4. Configure environment" section and the env var reference tables in the "OpenRouter profile" / "Ollama profile" blocks
- This story has no code changes — documentation only
- Depends on US-02 shipping so that documented error messages and env var names are confirmed correct

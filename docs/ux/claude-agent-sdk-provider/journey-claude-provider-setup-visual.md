# Journey Visual: Claude Code Provider Setup

**Persona**: Priya Kapoor — developer running Osabio for the first time (or switching providers).
She has a Claude Pro subscription, Claude Code installed and authenticated, but no OpenRouter account.

**Goal**: Get Osabio agents running through her existing Claude subscription with zero new API keys.

**Emotional Arc**: Anxious (will this work?) → Focused (following clear steps) → Confident (agents responding)

---

## Journey Flow

```
[Trigger]          [Step 1]            [Step 2]              [Step 3]            [Step 4]
Priya discovers    Install package     Set env vars          Start server        Validate
Osabio needs a     dependency          INFERENCE_PROVIDER    bun run dev         agents work
provider                               =claude-code                              
                                                                                  
Feels:             Feels:              Feels:                Feels:              Feels:
Frustrated         Focused             Methodical            Hopeful             Confident
(has Claude,       (clear deps)        (simple config)       (no errors)         (it works!)
needs API key)     
```

---

## Step-by-Step Walkthrough

### Step 1: Install Dependency

**Trigger**: Developer reads README or encounters `INFERENCE_PROVIDER` config docs.

```
+-- Terminal: Install ai-sdk-provider-claude-code -----+
|                                                       |
|  $ bun add ai-sdk-provider-claude-code               |
|                                                       |
|  bun add v1.x                                         |
|  installed ai-sdk-provider-claude-code@3.x.x          |
|  installed @anthropic/claude-agent-sdk@x.x.x          |
|                                                       |
|  [Emotional state: Focused — clear next step]        |
+-------------------------------------------------------+
```

**Shared artifacts produced**: `package.json` dependency entry for `ai-sdk-provider-claude-code@^3.0.0`

---

### Step 2: Configure Environment

**Trigger**: Developer sets `.env` file (or shell env).

```
+-- .env file: claude-code provider config ------------+
|                                                       |
|  # Provider selection                                 |
|  INFERENCE_PROVIDER=claude-code                       |
|                                                       |
|  # Model IDs (use claude-code model identifiers)     |
|  CHAT_AGENT_MODEL=claude-sonnet-4-5                   |
|  EXTRACTION_MODEL=claude-haiku-4-5                    |
|  PM_AGENT_MODEL=claude-haiku-4-5                      |
|  ANALYTICS_MODEL=claude-haiku-4-5                     |
|  OBSERVER_MODEL=claude-haiku-4-5                      |
|  SCORER_MODEL=claude-haiku-4-5                        |
|                                                       |
|  # Optional: effort + cost controls                   |
|  CLAUDE_CODE_EFFORT=normal          # low|normal|high |
|  CLAUDE_CODE_MAX_BUDGET_USD=5.00   # optional cap    |
|                                                       |
|  # All other Surreal, auth, port config unchanged    |
|                                                       |
|  [Emotional state: Methodical — familiar .env pattern]|
+-------------------------------------------------------+
```

**Shared artifacts consumed**: `InferenceProvider` type (from `config.ts`), model ID env vars (unchanged)

---

### Step 3: Server Startup

**Trigger**: Developer runs `bun run dev`.

**Happy path** — Claude Code is installed and authenticated:

```
+-- Terminal: Server startup output -------------------+
|                                                       |
|  $ bun run dev                                        |
|                                                       |
|  [runtime] Inference provider: claude-code            |
|  [runtime] Claude Code: authenticated ✓               |
|  [runtime] Models: sonnet-4-5 (chat), haiku-4-5 (x5) |
|  [runtime] Listening on http://localhost:3000          |
|                                                       |
|  [Emotional state: Hopeful — no errors on startup]   |
+-------------------------------------------------------+
```

**Error path A** — Claude Code CLI not installed:

```
+-- Terminal: Error — missing prerequisite -------------+
|                                                       |
|  Error: Claude Code CLI not found.                    |
|                                                       |
|  The claude-code inference provider requires           |
|  Claude Code to be installed and authenticated.       |
|                                                       |
|  To install:                                          |
|    npm install -g @anthropic-ai/claude-code           |
|  To authenticate:                                     |
|    claude login                                       |
|                                                       |
|  After installing, run: bun run dev                   |
|                                                       |
|  [Emotional state: Guided — knows exactly what to do] |
+-------------------------------------------------------+
```

**Error path B** — Claude Code not authenticated:

```
+-- Terminal: Error — not authenticated ---------------+
|                                                       |
|  Error: Claude Code is not authenticated.             |
|                                                       |
|  Run the following command to authenticate:           |
|    claude login                                       |
|                                                       |
|  Then restart the server: bun run dev                 |
|                                                       |
+------------------------------------------------------+
```

---

### Step 4: Validate Agents Work

**Trigger**: Developer sends a test message via the Osabio web UI or API.

```
+-- Browser / curl: First agent interaction -----------+
|                                                       |
|  POST /api/chat/messages                              |
|  { "message": "What tasks are open?" }               |
|                                                       |
|  → Chat agent streams response via Claude Code ✓     |
|  → PM agent invoked, completes ✓                     |
|  → Extraction pipeline runs on response ✓             |
|                                                       |
|  [Emotional state: Confident — it works!]            |
+-------------------------------------------------------+
```

---

## Emotional Arc Summary

| Step | Entry Emotion | Design Lever | Exit Emotion |
|------|--------------|--------------|-------------|
| 1: Install | Anxious (needs new key?) | Clear prereq in README | Focused |
| 2: Configure | Focused | Familiar .env pattern, minimal new vars | Methodical |
| 3: Start server | Methodical | Explicit provider confirmation on startup | Hopeful |
| 4: Validate | Hopeful | First agent response succeeds | Confident |

**Error recovery arc**: Frustrated (CLI missing) → Guided (clear message + commands) → Recovered (server starts)

---

## Integration Points

1. `config.ts` `InferenceProvider` type — must include `claude-code` as valid value
2. `config.ts` `loadServerConfig()` — must handle `INFERENCE_PROVIDER=claude-code` without requiring `OPENROUTER_API_KEY`
3. `dependencies.ts` dispatch — must route to `createClaudeCodeModels()` factory
4. `ai-sdk-provider-claude-code` — must produce Vercel AI SDK-compatible model objects for `streamText()` / `generateObject()`
5. Optional env vars `CLAUDE_CODE_EFFORT` and `CLAUDE_CODE_MAX_BUDGET_USD` — consumed by the factory, not required

---

## Error Paths Summary

| Failure | User sees | Recovery action |
|---------|-----------|-----------------|
| Claude Code CLI not installed | Named error + install command | `npm install -g @anthropic-ai/claude-code` + `claude login` |
| Claude Code not authenticated | Named error + auth command | `claude login` |
| Invalid model ID for claude-code | Error at factory init, lists valid IDs | Correct `CHAT_AGENT_MODEL` in `.env` |
| `ai-sdk-provider-claude-code` not installed | Import error with package name | `bun add ai-sdk-provider-claude-code` |
| `CLAUDE_CODE_MAX_BUDGET_USD` budget reached mid-session | Provider error surfaced in chat stream | Increase budget or restart server |

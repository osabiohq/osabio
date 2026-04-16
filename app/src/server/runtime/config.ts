export type OpenRouterReasoningEffort = "xhigh" | "high" | "medium" | "low" | "minimal" | "none";

export type OpenRouterReasoningOptions = {
  enabled?: boolean;
  exclude?: boolean;
  max_tokens?: number;
  effort?: OpenRouterReasoningEffort;
};

export type InferenceProvider = "openrouter" | "ollama" | "claude-code";

export type ClaudeCodeEffort = "low" | "normal" | "high";

export type ServerConfig = {
  inferenceProvider: InferenceProvider;
  openRouterApiKey?: string;
  ollamaBaseUrl?: string;
  chatAgentModelId: string;
  extractionModelId: string;
  pmAgentModelId: string;
  analyticsAgentModelId: string;
  extractionStoreThreshold: number;
  extractionDisplayThreshold: number;
  openRouterReasoning?: OpenRouterReasoningOptions;
  surrealUrl: string;
  surrealUsername: string;
  surrealPassword: string;
  surrealNamespace: string;
  surrealDatabase: string;
  port: number;
  observerModelId: string;
  scorerModelId: string;
  githubWebhookSecret?: string;
  betterAuthSecret: string;
  betterAuthUrl: string;
  githubClientId: string;
  githubClientSecret: string;
  anthropicApiUrl: string;
  anthropicApiKey?: string;
  selfHosted: boolean;
  adminEmail?: string;
  adminPassword?: string;
  worktreeManagerEnabled: boolean;
  orchestratorMockAgent: boolean;
  sandboxAgentEnabled: boolean;
  sandboxAgentType?: string;
  internalWebhookSecret?: string;
  toolEncryptionKey?: string;
  baseUrl: string;
  claudeCodeEffort?: ClaudeCodeEffort;
  claudeCodeMaxBudgetUsd?: number;
};

export function loadServerConfig(): ServerConfig {
  const inferenceProvider = parseInferenceProvider();

  const openRouterApiKey = inferenceProvider === "openrouter"
    ? requireEnv("OPENROUTER_API_KEY")
    : Bun.env.OPENROUTER_API_KEY?.trim() || undefined;

  const ollamaBaseUrl = inferenceProvider === "ollama"
    ? (Bun.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434")
    : undefined;

  const extractionStoreThreshold = parseUnitInterval(
    requireEnv("EXTRACTION_STORE_THRESHOLD"),
    "EXTRACTION_STORE_THRESHOLD",
  );

  const extractionDisplayThreshold = parseUnitInterval(
    requireEnv("EXTRACTION_DISPLAY_THRESHOLD"),
    "EXTRACTION_DISPLAY_THRESHOLD",
  );

  if (extractionDisplayThreshold < extractionStoreThreshold) {
    throw new Error("EXTRACTION_DISPLAY_THRESHOLD must be greater than or equal to EXTRACTION_STORE_THRESHOLD");
  }

  const chatAgentModelId = requireEnv("CHAT_AGENT_MODEL");
  const extractionModelId = requireEnv("EXTRACTION_MODEL");
  const pmAgentModelId = optionalEnv("PM_AGENT_MODEL") ?? extractionModelId;
  const analyticsAgentModelId = requireEnv("ANALYTICS_MODEL");
  const surrealUrl = requireEnv("SURREAL_URL");
  const surrealUsername = requireEnv("SURREAL_USERNAME");
  const surrealPassword = requireEnv("SURREAL_PASSWORD");
  const surrealNamespace = requireEnv("SURREAL_NAMESPACE");
  const surrealDatabase = requireEnv("SURREAL_DATABASE");

  const port = parsePositiveInteger(requireEnv("PORT"), "PORT");
  const observerModelId = optionalEnv("OBSERVER_MODEL") ?? extractionModelId;
  const scorerModelId = optionalEnv("SCORER_MODEL") ?? extractionModelId;
  const githubWebhookSecret = optionalEnv("GITHUB_WEBHOOK_SECRET");
  const betterAuthSecret = requireEnv("BETTER_AUTH_SECRET");
  const betterAuthUrl = requireEnv("BETTER_AUTH_URL");
  const githubClientId = requireEnv("GITHUB_CLIENT_ID");
  const githubClientSecret = requireEnv("GITHUB_CLIENT_SECRET");
  const anthropicApiUrl = optionalEnv("ANTHROPIC_API_URL") ?? "https://api.anthropic.com";
  const anthropicApiKey = optionalEnv("ANTHROPIC_API_KEY");

  const openRouterReasoning = inferenceProvider === "openrouter"
    ? parseOpenRouterReasoning()
    : undefined;

  const claudeCodeEffort = inferenceProvider === "claude-code"
    ? parseClaudeCodeEffort()
    : undefined;

  const claudeCodeMaxBudgetUsd = inferenceProvider === "claude-code"
    ? parseClaudeCodeMaxBudgetUsd()
    : undefined;

  const selfHosted = parseBooleanEnv("SELF_HOSTED");
  const worktreeManagerEnabled = parseBooleanEnv("WORKTREE_MANAGER_ENABLED");
  const orchestratorMockAgent = parseBooleanEnv("ORCHESTRATOR_MOCK_AGENT");
  const sandboxAgentEnabled = parseBooleanEnv("SANDBOX_AGENT_ENABLED");
  const sandboxAgentType = optionalEnv("SANDBOX_AGENT_TYPE");
  const internalWebhookSecret = optionalEnv("INTERNAL_WEBHOOK_SECRET");
  const toolEncryptionKey = optionalEnv("TOOL_ENCRYPTION_KEY");
  const baseUrl = optionalEnv("OSABIO_BASE_URL") ?? `http://localhost:${port}`;

  const adminEmail = selfHosted
    ? requireSelfHostedEnv("ADMIN_EMAIL")
    : undefined;
  const adminPassword = selfHosted
    ? requireSelfHostedEnv("ADMIN_PASSWORD")
    : undefined;

  return {
    inferenceProvider,
    ...(openRouterApiKey ? { openRouterApiKey } : {}),
    ...(ollamaBaseUrl ? { ollamaBaseUrl } : {}),
    chatAgentModelId,
    extractionModelId,
    pmAgentModelId,
    analyticsAgentModelId,
    extractionStoreThreshold,
    extractionDisplayThreshold,
    ...(openRouterReasoning ? { openRouterReasoning } : {}),
    surrealUrl,
    surrealUsername,
    surrealPassword,
    surrealNamespace,
    surrealDatabase,
    port,
    observerModelId,
    scorerModelId,
    ...(githubWebhookSecret ? { githubWebhookSecret } : {}),
    betterAuthSecret,
    betterAuthUrl,
    githubClientId,
    githubClientSecret,
    anthropicApiUrl,
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    selfHosted,
    ...(adminEmail ? { adminEmail } : {}),
    ...(adminPassword ? { adminPassword } : {}),
    worktreeManagerEnabled,
    orchestratorMockAgent,
    sandboxAgentEnabled,
    ...(sandboxAgentType ? { sandboxAgentType } : {}),
    ...(internalWebhookSecret ? { internalWebhookSecret } : {}),
    ...(toolEncryptionKey ? { toolEncryptionKey } : {}),
    baseUrl,
    ...(claudeCodeEffort ? { claudeCodeEffort } : {}),
    ...(claudeCodeMaxBudgetUsd !== undefined ? { claudeCodeMaxBudgetUsd } : {}),
  };
}

function optionalEnv(name: string): string | undefined {
  const value = Bun.env[name]?.trim();
  if (!value) return undefined;
  return value;
}

function requireEnv(name: string): string {
  const value = Bun.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function parsePositiveInteger(value: string, envName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${envName} must be a positive integer`);
  }
  return parsed;
}

function parseUnitInterval(value: string, envName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${envName} must be a number between 0 and 1`);
  }

  return parsed;
}

function parseInferenceProvider(): InferenceProvider {
  const value = Bun.env.INFERENCE_PROVIDER?.trim().toLowerCase();
  if (!value || value === "openrouter") return "openrouter";
  if (value === "ollama") return "ollama";
  if (value === "claude-code") return "claude-code";
  throw new Error("INFERENCE_PROVIDER must be one of: openrouter, ollama, claude-code");
}

function parseBooleanEnv(name: string): boolean {
  const value = Bun.env[name]?.trim().toLowerCase();
  return value === "true";
}

function requireSelfHostedEnv(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when SELF_HOSTED=true`);
  }
  return value;
}

function parseOpenRouterReasoning(): OpenRouterReasoningOptions | undefined {
  const effortValue = Bun.env.OPENROUTER_REASONING_EFFORT;
  const maxTokensValue = Bun.env.OPENROUTER_REASONING_MAX_TOKENS;

  if (!effortValue && !maxTokensValue) {
    return undefined;
  }

  const reasoning: OpenRouterReasoningOptions = {};

  if (effortValue) {
    const allowedEfforts: OpenRouterReasoningEffort[] = ["xhigh", "high", "medium", "low", "minimal", "none"];

    if (!allowedEfforts.includes(effortValue as OpenRouterReasoningEffort)) {
      throw new Error("OPENROUTER_REASONING_EFFORT must be one of xhigh, high, medium, low, minimal, none");
    }
    reasoning.effort = effortValue as OpenRouterReasoningEffort;
  }

  if (maxTokensValue) {
    const parsed = Number(maxTokensValue);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error("OPENROUTER_REASONING_MAX_TOKENS must be a positive number");
    }
    reasoning.max_tokens = parsed;
  }

  return reasoning;
}

function parseClaudeCodeEffort(): ClaudeCodeEffort | undefined {
  const value = Bun.env.CLAUDE_CODE_EFFORT?.trim();
  if (!value) return undefined;

  const allowedEfforts: ClaudeCodeEffort[] = ["low", "normal", "high"];
  if (!allowedEfforts.includes(value as ClaudeCodeEffort)) {
    throw new Error(`CLAUDE_CODE_EFFORT must be one of: low, normal, high`);
  }
  return value as ClaudeCodeEffort;
}

function parseClaudeCodeMaxBudgetUsd(): number | undefined {
  const value = Bun.env.CLAUDE_CODE_MAX_BUDGET_USD?.trim();
  if (!value) return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("CLAUDE_CODE_MAX_BUDGET_USD must be a positive number");
  }
  return parsed;
}

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOllama } from "ollama-ai-provider";
import { wrapLanguageModel } from "ai";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import { Surreal } from "surrealdb";
import type { ServerConfig } from "./config";
import { createAuth, type Auth } from "../auth/config";
import { bootstrapSigningKeyFromSurreal, type AsSigningKey } from "../oauth/as-key-management";
import { createMcpClientFactory, type McpClientFactory } from "../tool-registry/mcp-client";
import type { SandboxAgentAdapter } from "../orchestrator/sandbox-adapter";

const devtools = process.env.AI_DEVTOOLS === "1" ? devToolsMiddleware() : undefined;

export async function createRuntimeDependencies(config: ServerConfig): Promise<{
  surreal: Surreal;
  analyticsSurreal: Surreal;
  auth: Auth;
  chatAgentModel: any;
  extractionModel: any;
  pmAgentModel: any;
  analyticsAgentModel: any;
  observerModel: any;
  scorerModel: any;
  asSigningKey: AsSigningKey;
  mcpClientFactory: McpClientFactory;
  sandboxAgentAdapter?: SandboxAgentAdapter;
  destroySandbox?: () => Promise<void>;
}> {
  const surreal = new Surreal();
  await surreal.connect(config.surrealUrl, {
    namespace: config.surrealNamespace,
    database: config.surrealDatabase,
    authentication: () => ({
      username: config.surrealUsername,
      password: config.surrealPassword,
    }),
  });
  await surreal.signin({ username: config.surrealUsername, password: config.surrealPassword });
  await surreal.use({ namespace: config.surrealNamespace, database: config.surrealDatabase });

  const analyticsSurreal = new Surreal();
  await analyticsSurreal.connect(config.surrealUrl, {
    namespace: config.surrealNamespace,
    database: config.surrealDatabase,
    authentication: () => ({
      namespace: config.surrealNamespace,
      database: config.surrealDatabase,
      username: "analytics",
      password: "osabio-analytics-readonly",
    }),
  });
  await analyticsSurreal.signin({
    namespace: config.surrealNamespace,
    database: config.surrealDatabase,
    username: "analytics",
    password: "osabio-analytics-readonly",
  });
  await analyticsSurreal.use({ namespace: config.surrealNamespace, database: config.surrealDatabase });

  const wrap = (model: any) => devtools ? wrapLanguageModel({ model, middleware: devtools }) : model;

  const { chatAgentModel, extractionModel, pmAgentModel, analyticsAgentModel, observerModel, scorerModel } =
    config.inferenceProvider === "claude-code"
      ? await createClaudeCodeModels(config, wrap)
      : config.inferenceProvider === "ollama"
        ? createOllamaModels(config, wrap)
        : createOpenRouterModels(config, wrap);

  const auth = createAuth(surreal, {
    betterAuthSecret: config.betterAuthSecret,
    betterAuthUrl: config.betterAuthUrl,
    githubClientId: config.githubClientId,
    githubClientSecret: config.githubClientSecret,
    selfHosted: config.selfHosted,
  });

  const asSigningKey = await bootstrapSigningKeyFromSurreal(surreal);
  const mcpClientFactory = createMcpClientFactory();

  // SandboxAgent SDK — start embedded server when enabled
  // When orchestratorMockAgent is true, use mock adapter instead of real SDK
  // (acceptance tests set both sandboxAgentEnabled + orchestratorMockAgent)
  let sandboxAgentAdapter: SandboxAgentAdapter | undefined;
  let destroySandbox: (() => Promise<void>) | undefined;
  if (config.sandboxAgentEnabled && !config.orchestratorMockAgent) {
    const { SandboxAgent: SandboxAgentClass } = await import("sandbox-agent");
    const { local } = await import("sandbox-agent/local");
    const { createSandboxAgentAdapter } = await import("../orchestrator/sandbox-adapter");
    const sdk = await SandboxAgentClass.start({ sandbox: local() });
    sandboxAgentAdapter = createSandboxAgentAdapter(sdk);
    destroySandbox = () => sdk.destroySandbox();
  } else if (config.sandboxAgentEnabled && config.orchestratorMockAgent) {
    const { createMockAdapter } = await import("../orchestrator/sandbox-adapter");
    sandboxAgentAdapter = createMockAdapter();
  }

  return {
    surreal,
    analyticsSurreal,
    auth,
    chatAgentModel,
    extractionModel,
    pmAgentModel,
    analyticsAgentModel,
    observerModel,
    scorerModel,
    asSigningKey,
    mcpClientFactory,
    sandboxAgentAdapter,
    destroySandbox,
  };
}

// ---------------------------------------------------------------------------
// OpenRouter model factory
// ---------------------------------------------------------------------------

function createOpenRouterModels(config: ServerConfig, wrap: (model: any) => any) {
  const openrouter = createOpenRouter({ apiKey: config.openRouterApiKey! });
  const withPlugins = (modelId: string, reasoning = true) =>
    wrap(openrouter(modelId, {
      plugins: [{ id: "response-healing" }],
      ...(reasoning && config.openRouterReasoning ? { extraBody: { reasoning: config.openRouterReasoning } } : {}),
    }));

  return {
    chatAgentModel: withPlugins(config.chatAgentModelId),
    extractionModel: withPlugins(config.extractionModelId),
    pmAgentModel: withPlugins(config.pmAgentModelId),
    analyticsAgentModel: withPlugins(config.analyticsAgentModelId, false),
    observerModel: withPlugins(config.observerModelId),
    scorerModel: withPlugins(config.scorerModelId, false),
  };
}

// ---------------------------------------------------------------------------
// Ollama model factory
// ---------------------------------------------------------------------------

function createOllamaModels(config: ServerConfig, wrap: (model: any) => any) {
  const ollama = createOllama({ baseURL: `${config.ollamaBaseUrl}/api` });

  return {
    chatAgentModel: wrap(ollama(config.chatAgentModelId)),
    extractionModel: wrap(ollama(config.extractionModelId)),
    pmAgentModel: wrap(ollama(config.pmAgentModelId)),
    analyticsAgentModel: wrap(ollama(config.analyticsAgentModelId)),
    observerModel: wrap(ollama(config.observerModelId)),
    scorerModel: wrap(ollama(config.scorerModelId)),
  };
}

// ---------------------------------------------------------------------------
// Claude Code model factory (async — executes 3-layer startup probe)
// ---------------------------------------------------------------------------

export async function createClaudeCodeModels(config: ServerConfig, wrap: (model: any) => any) {
  // Layer 1: package import probe
  let claudeCodeProvider: (modelId: string, settings?: Record<string, unknown>) => any;
  try {
    const mod = await import("ai-sdk-provider-claude-code");
    if (typeof mod.claudeCode !== "function") {
      throw new Error("claudeCode is not a function");
    }
    claudeCodeProvider = mod.claudeCode;
  } catch {
    throw new Error(
      "ai-sdk-provider-claude-code is not installed. Run: bun add ai-sdk-provider-claude-code"
    );
  }

  // Layer 2: CLI presence probe
  const claudeBinaryPath = Bun.which("claude");
  if (claudeBinaryPath === null) {
    throw new Error(
      "Claude Code CLI is not installed. Install it with: npm install -g @anthropic-ai/claude-code"
    );
  }

  // Layer 3: auth state probe
  const authProcess = Bun.spawn(["claude", "auth", "status"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const authExitCode = await authProcess.exited;

  let isAuthenticated = false;
  if (authExitCode === 0) {
    const rawOutput = await new Response(authProcess.stdout).text();
    try {
      const parsed = JSON.parse(rawOutput);
      isAuthenticated = parsed.loggedIn === true;
    } catch {
      // Could not parse JSON — treat as unauthenticated
    }
  }

  if (!isAuthenticated) {
    throw new Error(
      "Claude Code CLI is not authenticated. Authenticate with: claude login"
    );
  }

  // Build provider options from config
  const providerSettings: Record<string, unknown> = {};
  if (config.claudeCodeEffort !== undefined) {
    // Map config effort values to provider effort values
    // config: "low" | "normal" | "high"
    // provider: "low" | "medium" | "high" | "max"
    const effortMap: Record<string, string> = {
      low: "low",
      normal: "medium",
      high: "high",
    };
    providerSettings.effort = effortMap[config.claudeCodeEffort];
  }
  if (config.claudeCodeMaxBudgetUsd !== undefined) {
    providerSettings.maxBudgetUsd = config.claudeCodeMaxBudgetUsd;
  }

  const model = (modelId: string) => wrap(claudeCodeProvider(modelId, providerSettings));

  return {
    chatAgentModel: model(config.chatAgentModelId),
    extractionModel: model(config.extractionModelId),
    pmAgentModel: model(config.pmAgentModelId),
    analyticsAgentModel: model(config.analyticsAgentModelId),
    observerModel: model(config.observerModelId),
    scorerModel: model(config.scorerModelId),
  };
}

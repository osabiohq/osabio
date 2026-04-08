/**
 * LLM Proxy Acceptance Test Kit
 *
 * Domain-specific helpers for LLM proxy acceptance tests.
 * Extends the shared acceptance-test-kit with proxy-specific
 * workspace setup, request builders, and graph query helpers.
 *
 * Driving ports: HTTP endpoints at /proxy/llm/anthropic/v1/messages
 * and /api/workspaces/:workspaceId/proxy/spend
 */
import { RecordId, type Surreal } from "surrealdb";
import {
  setupAcceptanceSuite,
  createTestUser,
  fetchRaw,
  type AcceptanceTestRuntime,
  type TestUser,
} from "../acceptance-test-kit";

// Re-export shared helpers
export {
  setupAcceptanceSuite,
  createTestUser,
  fetchRaw,
  type AcceptanceTestRuntime,
  type TestUser,
};

// ---------------------------------------------------------------------------
// Test Model Configuration
// ---------------------------------------------------------------------------

/**
 * The Anthropic model to use in proxy acceptance tests.
 * Required env var: TEST_PROXY_ANTHROPIC_MODEL
 * Example: claude-haiku-4-5-20251001
 */
function requireTestProxyModel(): string {
  const model = process.env.TEST_PROXY_ANTHROPIC_MODEL?.trim();
  if (!model) {
    throw new Error(
      "TEST_PROXY_ANTHROPIC_MODEL env var is required for proxy acceptance tests. " +
      "Set it to a cheap model like claude-haiku-4-5-20251001.",
    );
  }
  return model;
}

export const TEST_PROXY_MODEL = requireTestProxyModel();

// ---------------------------------------------------------------------------
// Proxy Request Builders
// ---------------------------------------------------------------------------

export type ProxyRequestOptions = {
  model: string;
  stream?: boolean;
  maxTokens?: number;
  messages?: Array<{ role: string; content: string }>;
  metadata?: { user_id?: string };
  apiKey?: string;
  workspaceHeader?: string;
  taskHeader?: string;
  agentTypeHeader?: string;
};

/**
 * Build a proxy request body matching the Anthropic Messages API format.
 */
export function buildProxyRequestBody(options: ProxyRequestOptions): string {
  return JSON.stringify({
    model: options.model,
    max_tokens: options.maxTokens ?? 100,
    stream: options.stream ?? false,
    messages: options.messages ?? [
      { role: "user", content: "Say hello in one word." },
    ],
    ...(options.metadata ? { metadata: options.metadata } : {}),
  });
}

/**
 * Build headers for a proxy request, including identity headers.
 */
export function buildProxyHeaders(options: ProxyRequestOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };

  if (options.apiKey) {
    headers["x-api-key"] = options.apiKey;
  }
  if (options.workspaceHeader) {
    headers["X-Osabio-Workspace"] = options.workspaceHeader;
  }
  if (options.taskHeader) {
    headers["X-Osabio-Task"] = options.taskHeader;
  }
  if (options.agentTypeHeader) {
    headers["X-Osabio-Agent-Type"] = options.agentTypeHeader;
  }

  return headers;
}

/**
 * Retry a fetch call on transient upstream errors (rate limiting).
 * OpenRouter may return 401 or 429 under concurrent load.
 */
async function withUpstreamRetry(
  fn: () => Promise<Response>,
  options?: { retryUnauthorized?: boolean },
  maxRetries = 2,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fn();
    const canRetryUnauthorized = options?.retryUnauthorized ?? false;
    const isTransient = response.status === 429
      || (canRetryUnauthorized && response.status === 401 && attempt < maxRetries);
    if (!isTransient) return response;
    // Consume body before retry to avoid resource leaks
    await response.text().catch(() => undefined);
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
  }
  return fn();
}

function shouldRetryUnauthorized(apiKey?: string): boolean {
  if (!apiKey) return false;
  return !apiKey.startsWith("sk-test-") && !apiKey.startsWith("sk-invalid-");
}

/**
 * Send a request through the LLM proxy endpoint.
 * Returns the raw Response for flexible assertion.
 */
export async function sendProxyRequest(
  baseUrl: string,
  options: ProxyRequestOptions,
): Promise<Response> {
  const body = buildProxyRequestBody(options);
  const headers = buildProxyHeaders(options);
  const url = `${baseUrl}/proxy/llm/anthropic/v1/messages`;

  return withUpstreamRetry(() =>
    fetch(url, { method: "POST", headers, body }),
    { retryUnauthorized: shouldRetryUnauthorized(options.apiKey) },
  );
}

/**
 * Send a count_tokens request through the proxy.
 */
export async function sendCountTokensRequest(
  baseUrl: string,
  options: ProxyRequestOptions,
): Promise<Response> {
  const body = buildProxyRequestBody(options);
  const headers = buildProxyHeaders(options);
  const url = `${baseUrl}/proxy/llm/anthropic/v1/messages/count_tokens`;

  return withUpstreamRetry(() =>
    fetch(url, { method: "POST", headers, body }),
    { retryUnauthorized: shouldRetryUnauthorized(options.apiKey) },
  );
}

// ---------------------------------------------------------------------------
// SSE Stream Helpers
// ---------------------------------------------------------------------------

export type SSEEvent = {
  event?: string;
  data: string;
};

/**
 * Collect all SSE events from a streaming proxy response.
 */
export async function collectProxySSEEvents(response: Response): Promise<SSEEvent[]> {
  if (!response.body) {
    throw new Error("No response body for SSE collection");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: SSEEvent[] = [];
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const segments = buffer.split("\n\n");
      buffer = segments.pop() ?? "";

      for (const segment of segments) {
        const lines = segment.split("\n");
        let eventType: string | undefined;
        let dataLine: string | undefined;

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ")) {
            dataLine = line.slice(6);
          }
        }

        if (dataLine !== undefined) {
          events.push({ event: eventType, data: dataLine });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return events;
}

// ---------------------------------------------------------------------------
// Workspace and Identity Setup
// ---------------------------------------------------------------------------

/**
 * Create a workspace record in SurrealDB for proxy testing.
 */
export async function createProxyTestWorkspace(
  surreal: Surreal,
  workspaceId: string,
  options?: { dailyBudget?: number; alertThreshold?: number },
): Promise<string> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const content: Record<string, unknown> = {
    name: `Proxy Test Workspace ${workspaceId}`,
    status: "active",
    onboarding_complete: true,
    onboarding_turn_count: 0,
    onboarding_summary_pending: false,
    onboarding_started_at: new Date(),
    created_at: new Date(),
  };

  if (options?.dailyBudget !== undefined) {
    content.daily_budget_usd = options.dailyBudget;
  }

  await surreal.query(`CREATE $workspace CONTENT $content;`, {
    workspace: workspaceRecord,
    content,
  });

  return workspaceId;
}

/**
 * Create a project record linked to a workspace.
 */
export async function createProxyTestProject(
  surreal: Surreal,
  projectId: string,
  workspaceId: string,
): Promise<string> {
  const projectRecord = new RecordId("project", projectId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $project CONTENT $content;`, {
    project: projectRecord,
    content: {
      name: `Test Project ${projectId}`,
      status: "active",
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  return projectId;
}

/**
 * Create a task record linked to a project and workspace.
 */
export async function createProxyTestTask(
  surreal: Surreal,
  taskId: string,
  projectId: string,
  workspaceId: string,
): Promise<string> {
  const taskRecord = new RecordId("task", taskId);
  const projectRecord = new RecordId("project", projectId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $task CONTENT $content;`, {
    task: taskRecord,
    content: {
      title: `Test Task ${taskId}`,
      status: "open",
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  // Link task to project
  await surreal.query(`RELATE $task->belongs_to->$project SET added_at = time::now();`, {
    task: taskRecord,
    project: projectRecord,
  });

  return taskId;
}

// ---------------------------------------------------------------------------
// Graph Query Helpers
// ---------------------------------------------------------------------------

export type LlmTraceRecord = {
  id: RecordId;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  cost_usd: number;
  latency_ms: number;
  stop_reason?: string;
  request_id?: string;
  created_at: Date;
};

/**
 * Query all LLM traces in a workspace.
 */
export async function getTracesForWorkspace(
  surreal: Surreal,
  workspaceId: string,
): Promise<LlmTraceRecord[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const results = await surreal.query(
    `SELECT * FROM trace WHERE ->scoped_to->workspace CONTAINS $ws ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  );

  return (results[0] ?? []) as LlmTraceRecord[];
}

/**
 * Query traces attributed to a specific task.
 */
export async function getTracesForTask(
  surreal: Surreal,
  taskId: string,
): Promise<LlmTraceRecord[]> {
  const taskRecord = new RecordId("task", taskId);

  const results = await surreal.query(
    `SELECT * FROM trace WHERE ->attributed_to->task CONTAINS $task ORDER BY created_at DESC;`,
    { task: taskRecord },
  );

  return (results[0] ?? []) as LlmTraceRecord[];
}

/**
 * Check whether a trace has the expected graph edges.
 */
export async function getTraceEdges(
  surreal: Surreal,
  traceId: string,
): Promise<{
  workspaces: RecordId[];
  tasks: RecordId[];
  sessions: RecordId[];
}> {
  const traceRecord = new RecordId("trace", traceId);

  const results = await surreal.query(
    `SELECT
       ->scoped_to->workspace AS workspaces,
       ->attributed_to->task AS tasks,
       <-invoked<-agent_session AS sessions
     FROM $trace;`,
    { trace: traceRecord },
  );

  const row = (results[0] as Array<{
    workspaces: RecordId[];
    tasks: RecordId[];
    sessions: RecordId[];
  }>)?.[0];

  return {
    workspaces: row?.workspaces ?? [],
    tasks: row?.tasks ?? [],
    sessions: row?.sessions ?? [],
  };
}

/**
 * Query the total spend for a workspace (sum of trace costs).
 */
export async function getWorkspaceSpend(
  surreal: Surreal,
  workspaceId: string,
): Promise<number> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const results = await surreal.query(
    `SELECT cost_usd FROM trace WHERE workspace = $ws;`,
    { ws: workspaceRecord },
  );

  const rows = (results[0] ?? []) as Array<{ cost_usd: number }>;
  return rows.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0);
}

/**
 * Seed an LLM trace directly for testing dashboard/audit scenarios
 * that need pre-existing trace data.
 */
export async function seedLlmTrace(
  surreal: Surreal,
  traceId: string,
  options: {
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    latency_ms: number;
    workspaceId: string;
    taskId?: string;
    sessionId?: string;
    stop_reason?: string;
    cache_read_tokens?: number;
    cache_creation_tokens?: number;
    created_at?: Date;
  },
): Promise<string> {
  const traceRecord = new RecordId("trace", traceId);
  const workspaceRecord = new RecordId("workspace", options.workspaceId);

  // Ensure a test identity exists for the actor field (required by trace schema)
  const actorId = `proxy-test-actor-${options.workspaceId}`;
  const actorRecord = new RecordId("identity", actorId);
  await surreal.query(
    `CREATE $actor CONTENT { name: "proxy-test-system", type: "system", workspace: $ws, created_at: time::now() };`,
    { actor: actorRecord, ws: workspaceRecord },
  ).catch(() => undefined); // Ignore if already exists

  const traceContent: Record<string, unknown> = {
    type: "llm_call",
    model: options.model,
    input_tokens: options.input_tokens,
    output_tokens: options.output_tokens,
    cache_read_tokens: options.cache_read_tokens ?? 0,
    cache_creation_tokens: options.cache_creation_tokens ?? 0,
    cost_usd: options.cost_usd,
    latency_ms: options.latency_ms,
    stop_reason: options.stop_reason ?? "end_turn",
    workspace: workspaceRecord,
    actor: actorRecord,
    created_at: options.created_at ?? new Date(),
  };

  // Link session directly on trace record (schema: session TYPE option<record<agent_session>>)
  if (options.sessionId) {
    traceContent.session = new RecordId("agent_session", options.sessionId);
  }

  await surreal.query(`CREATE $trace CONTENT $content;`, {
    trace: traceRecord,
    content: traceContent,
  });

  // Create workspace edge
  await surreal.query(
    `RELATE $trace->scoped_to->$workspace SET created_at = time::now();`,
    { trace: traceRecord, workspace: workspaceRecord },
  );

  // Create task edge if provided
  if (options.taskId) {
    const taskRecord = new RecordId("task", options.taskId);
    await surreal.query(
      `RELATE $trace->attributed_to->$task SET created_at = time::now();`,
      { trace: traceRecord, task: taskRecord },
    );
  }

  // Create session edge if provided
  if (options.sessionId) {
    const sessionRecord = new RecordId("agent_session", options.sessionId);
    await surreal.query(
      `RELATE $sess->invoked->$trace SET created_at = time::now();`,
      { trace: traceRecord, sess: sessionRecord },
    );
  }

  return traceId;
}

// ---------------------------------------------------------------------------
// Policy Setup Helpers
// ---------------------------------------------------------------------------

/**
 * Create a model access policy for the proxy.
 */
export async function createModelAccessPolicy(
  surreal: Surreal,
  workspaceId: string,
  options: {
    policyId: string;
    agentType: string;
    allowedModels: string[];
    status?: string;
  },
): Promise<string> {
  const policyRecord = new RecordId("policy", options.policyId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $policy CONTENT $content;`, {
    policy: policyRecord,
    content: {
      title: `Model Access: ${options.agentType}`,
      description: `Controls which models ${options.agentType} can use`,
      status: options.status ?? "active",
      version: 1,
      workspace: workspaceRecord,
      selector: {},
      rego_source: "package osabio.policy\ndefault allow = true",
      created_at: new Date(),
    },
  });

  return options.policyId;
}

/**
 * Set the daily budget for a workspace (updates proxy settings).
 */
export async function setWorkspaceBudget(
  surreal: Surreal,
  workspaceId: string,
  dailyBudget: number,
): Promise<void> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(
    `UPDATE $workspace SET proxy_settings.daily_budget = $budget;`,
    { workspace: workspaceRecord, budget: dailyBudget },
  );
}

// ---------------------------------------------------------------------------
// Spend API Helpers
// ---------------------------------------------------------------------------

/**
 * Query the spend breakdown API endpoint.
 */
export async function querySpendBreakdown(
  baseUrl: string,
  workspaceId: string,
  period: string = "today",
): Promise<Response> {
  return fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/proxy/spend?period=${period}`,
    { method: "GET" },
  );
}

// ---------------------------------------------------------------------------
// Audit API Helpers
// ---------------------------------------------------------------------------

/**
 * Query the audit trace detail endpoint.
 */
export async function queryTraceDetail(
  baseUrl: string,
  workspaceId: string,
  traceId: string,
): Promise<Response> {
  return fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/proxy/traces/${traceId}`,
    { method: "GET" },
  );
}

/**
 * Query traces for a project within a date range.
 */
export async function queryTracesByProject(
  baseUrl: string,
  workspaceId: string,
  projectId: string,
  startDate: string,
  endDate: string,
): Promise<Response> {
  return fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/proxy/traces?project=${projectId}&start=${startDate}&end=${endDate}`,
    { method: "GET" },
  );
}

/**
 * Run the compliance check for a workspace.
 */
export async function runComplianceCheck(
  baseUrl: string,
  workspaceId: string,
  startDate: string,
  endDate: string,
): Promise<Response> {
  return fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/proxy/compliance?start=${startDate}&end=${endDate}`,
    { method: "GET" },
  );
}

// ---------------------------------------------------------------------------
// Claude Code metadata builder
// ---------------------------------------------------------------------------

/**
 * Build a Claude Code-style metadata.user_id string.
 */
export function buildClaudeCodeUserId(
  userHash: string,
  accountId: string,
  sessionId: string,
): string {
  return `user_${userHash}_account_${accountId}_session_${sessionId}`;
}

// ---------------------------------------------------------------------------
// Intelligence: Proxy Intelligence Config
// ---------------------------------------------------------------------------

/**
 * Create a proxy_intelligence_config record for a workspace.
 * Controls context injection, contradiction detection, and session timeout.
 */
export async function createProxyIntelligenceConfig(
  surreal: Surreal,
  workspaceId: string,
  options?: {
    contextInjectionEnabled?: boolean;
    contextInjectionTokenBudget?: number;
    contextInjectionCacheTtlSeconds?: number;
    contextInjectionTier?: "fast" | "secure";
    contradictionDetectionEnabled?: boolean;
    contradictionTier1Threshold?: number;
    contradictionTier2ConfidenceMin?: number;
  },
): Promise<string> {
  const configId = `cfg-${workspaceId}`;
  const configRecord = new RecordId("proxy_intelligence_config", configId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $config CONTENT $content;`, {
    config: configRecord,
    content: {
      workspace: workspaceRecord,
      context_injection_enabled: options?.contextInjectionEnabled ?? true,
      context_injection_token_budget: options?.contextInjectionTokenBudget ?? 1000,
      context_injection_cache_ttl_seconds: options?.contextInjectionCacheTtlSeconds ?? 300,
      context_injection_tier: options?.contextInjectionTier ?? "secure",
      contradiction_detection_enabled: options?.contradictionDetectionEnabled ?? true,
      contradiction_tier1_threshold: options?.contradictionTier1Threshold ?? 0.75,
      contradiction_tier2_confidence_min: options?.contradictionTier2ConfidenceMin ?? 0.6,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  return configId;
}

// ---------------------------------------------------------------------------
// Intelligence: Session Query Helpers
// ---------------------------------------------------------------------------

export type AgentSessionRecord = {
  id: RecordId;
  agent: string;
  workspace: RecordId;
  started_at: Date;
  ended_at?: Date;
  last_activity_at?: Date;
  source?: string;
  external_session_id?: string;
};

/**
 * Query agent sessions for a workspace, optionally filtered by source.
 */
export async function getSessionsForWorkspace(
  surreal: Surreal,
  workspaceId: string,
  options?: { source?: string },
): Promise<AgentSessionRecord[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const sourceFilter = options?.source
    ? `AND source = $source`
    : "";

  const results = await surreal.query(
    `SELECT * FROM agent_session WHERE workspace = $ws ${sourceFilter} ORDER BY started_at DESC;`,
    { ws: workspaceRecord, source: options?.source },
  );

  return (results[0] ?? []) as AgentSessionRecord[];
}

/**
 * Get a specific agent session by ID.
 */
export async function getSessionById(
  surreal: Surreal,
  sessionId: string,
): Promise<AgentSessionRecord | undefined> {
  const sessionRecord = new RecordId("agent_session", sessionId);

  const results = await surreal.query(
    `SELECT * FROM $sess;`,
    { sess: sessionRecord },
  );

  return (results[0] as AgentSessionRecord[])?.[0];
}

/**
 * Seed an agent session directly for testing scenarios
 * that need pre-existing session data.
 */
export async function seedAgentSession(
  surreal: Surreal,
  sessionId: string,
  options: {
    workspaceId: string;
    agent?: string;
    source?: string;
    externalSessionId?: string;
    startedAt?: Date;
    lastActivityAt?: Date;
    endedAt?: Date;
  },
): Promise<string> {
  const sessionRecord = new RecordId("agent_session", sessionId);
  const workspaceRecord = new RecordId("workspace", options.workspaceId);

  const content: Record<string, unknown> = {
    agent: options.agent ?? "coding-agent",
    workspace: workspaceRecord,
    started_at: options.startedAt ?? new Date(),
    last_event_at: options.lastActivityAt ?? new Date(),
    created_at: new Date(),
  };

  if (options.externalSessionId) {
    content.external_session_id = options.externalSessionId;
  }
  if (options.endedAt) {
    content.ended_at = options.endedAt;
  }
  if (options.source) {
    content.external_session_id = content.external_session_id ?? options.source;
  }

  await surreal.query(`CREATE $sess CONTENT $content;`, {
    sess: sessionRecord,
    content,
  });

  return sessionId;
}

/**
 * Simulate a session becoming stale by backdating last_activity_at.
 * This allows testing the background sweep timeout behavior.
 */
export async function simulateSessionTimeout(
  surreal: Surreal,
  sessionId: string,
  minutesAgo: number,
): Promise<void> {
  const sessionRecord = new RecordId("agent_session", sessionId);
  const staleTime = new Date(Date.now() - minutesAgo * 60 * 1000);

  await surreal.query(
    `UPDATE $sess SET last_activity_at = $staleTime;`,
    { sess: sessionRecord, staleTime },
  );
}

// ---------------------------------------------------------------------------
// Intelligence: Decision Helpers
// ---------------------------------------------------------------------------

/**
 * Seed a confirmed decision in a workspace for contradiction testing.
 */
export async function seedConfirmedDecision(
  surreal: Surreal,
  decisionId: string,
  options: {
    workspaceId: string;
    summary: string;
    rationale?: string;
  },
): Promise<string> {
  const decisionRecord = new RecordId("decision", decisionId);
  const workspaceRecord = new RecordId("workspace", options.workspaceId);

  const content: Record<string, unknown> = {
    summary: options.summary,
    rationale: options.rationale ?? `Rationale for: ${options.summary}`,
    status: "confirmed",
    workspace: workspaceRecord,
    created_at: new Date(),
  };

  await surreal.query(`CREATE $decision CONTENT $content;`, {
    decision: decisionRecord,
    content,
  });

  return decisionId;
}

/**
 * Seed an active learning in a workspace for context injection testing.
 */
export async function seedActiveLearning(
  surreal: Surreal,
  learningId: string,
  options: {
    workspaceId: string;
    text: string;
    priority?: string;
  },
): Promise<string> {
  const learningRecord = new RecordId("learning", learningId);
  const workspaceRecord = new RecordId("workspace", options.workspaceId);

  const content: Record<string, unknown> = {
    text: options.text,
    status: "active",
    learning_type: "constraint",
    source: "human",
    priority: options.priority ?? "medium",
    target_agents: ["coding-agent"],
    workspace: workspaceRecord,
    created_at: new Date(),
  };

  await surreal.query(`CREATE $learning CONTENT $content;`, {
    learning: learningRecord,
    content,
  });

  return learningId;
}

// ---------------------------------------------------------------------------
// Intelligence: Observation Seed Helpers
// ---------------------------------------------------------------------------

/**
 * Seed an open observation (conflict/warning) for context injection testing.
 */
export async function seedOpenObservation(
  surreal: Surreal,
  observationId: string,
  options: {
    workspaceId: string;
    text: string;
    severity: "conflict" | "warning";
  },
): Promise<string> {
  const observationRecord = new RecordId("observation", observationId);
  const workspaceRecord = new RecordId("workspace", options.workspaceId);

  const content: Record<string, unknown> = {
    text: options.text,
    severity: options.severity,
    status: "open",
    source_agent: "observer",
    workspace: workspaceRecord,
    created_at: new Date(),
  };

  await surreal.query(`CREATE $obs CONTENT $content;`, {
    obs: observationRecord,
    content,
  });

  return observationId;
}

// ---------------------------------------------------------------------------
// Intelligence: Observation Query Helpers
// ---------------------------------------------------------------------------

export type ObservationRecord = {
  id: RecordId;
  text: string;
  severity: string;
  status: string;
  observation_type?: string;
  source_agent?: string;
  workspace: RecordId;
  created_at: Date;
};

/**
 * Query observations for a workspace, optionally filtered by type and source.
 */
export async function getObservationsForWorkspace(
  surreal: Surreal,
  workspaceId: string,
  options?: { observationType?: string; sourceAgent?: string },
): Promise<ObservationRecord[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  let filters = `WHERE workspace = $ws`;
  if (options?.observationType) {
    filters += ` AND observation_type = $obsType`;
  }
  if (options?.sourceAgent) {
    filters += ` AND source_agent = $srcAgent`;
  }

  const results = await surreal.query(
    `SELECT * FROM observation ${filters} ORDER BY created_at DESC;`,
    {
      ws: workspaceRecord,
      obsType: options?.observationType,
      srcAgent: options?.sourceAgent,
    },
  );

  return (results[0] ?? []) as ObservationRecord[];
}

// ---------------------------------------------------------------------------
// Intelligence: Extended Proxy Request Options
// ---------------------------------------------------------------------------

/**
 * Send a proxy request with additional intelligence-related headers.
 * Extends the base sendProxyRequest with session and session-end headers.
 */
export async function sendProxyRequestWithIntelligence(
  baseUrl: string,
  options: ProxyRequestOptions & {
    sessionHeader?: string;
    sessionEndHeader?: boolean;
    systemPrompt?: string | Array<{ type: string; text: string; cache_control?: { type: string } }>;
  },
): Promise<Response> {
  const body = JSON.parse(buildProxyRequestBody(options));

  // Add system prompt if provided (for context injection tests)
  if (options.systemPrompt) {
    body.system = options.systemPrompt;
  }

  const headers = buildProxyHeaders(options);

  if (options.sessionHeader) {
    headers["X-Osabio-Session"] = options.sessionHeader;
  }
  if (options.sessionEndHeader) {
    headers["X-Osabio-Session-End"] = "true";
  }

  const url = `${baseUrl}/proxy/llm/anthropic/v1/messages`;
  const serializedBody = JSON.stringify(body);

  return withUpstreamRetry(() =>
    fetch(url, { method: "POST", headers, body: serializedBody }),
  );
}

// ---------------------------------------------------------------------------
// Intelligence: Conversation Query Helpers
// ---------------------------------------------------------------------------

export type ConversationRecord = {
  id: RecordId;
  workspace: RecordId;
  title: string;
  source?: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Query conversations for a workspace, optionally filtered by source.
 */
export async function getConversationsForWorkspace(
  surreal: Surreal,
  workspaceId: string,
  options?: { source?: string },
): Promise<ConversationRecord[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const sourceFilter = options?.source
    ? `AND source = $source`
    : "";

  const results = await surreal.query(
    `SELECT * FROM conversation WHERE workspace = $ws ${sourceFilter} ORDER BY createdAt DESC;`,
    { ws: workspaceRecord, source: options?.source },
  );

  return (results[0] ?? []) as ConversationRecord[];
}

/**
 * Get traces linked to a specific conversation.
 */
export async function getTracesForConversation(
  surreal: Surreal,
  conversationId: string,
): Promise<LlmTraceRecord[]> {
  const conversationRecord = new RecordId("conversation", conversationId);

  const results = await surreal.query(
    `SELECT * FROM trace WHERE input.conversation = $conv ORDER BY created_at DESC;`,
    { conv: conversationRecord },
  );

  return (results[0] ?? []) as LlmTraceRecord[];
}

// ---------------------------------------------------------------------------
// Intelligence: Completed Task Helpers
// ---------------------------------------------------------------------------

/**
 * Seed a completed task with no decision links for reverse coherence testing.
 * Uses created_at for the age threshold (task schema has no completed_at field).
 */
export async function seedCompletedTaskWithoutDecision(
  surreal: Surreal,
  taskId: string,
  options: {
    workspaceId: string;
    title: string;
    completedAt?: Date;
  },
): Promise<string> {
  const taskRecord = new RecordId("task", taskId);
  const workspaceRecord = new RecordId("workspace", options.workspaceId);
  const createdAt = options.completedAt
    ? new Date(options.completedAt.getTime() - 7 * 24 * 60 * 60 * 1000)
    : new Date(Date.now() - 22 * 24 * 60 * 60 * 1000);

  await surreal.query(`CREATE $task CONTENT $content;`, {
    task: taskRecord,
    content: {
      title: options.title,
      status: "completed",
      workspace: workspaceRecord,
      created_at: createdAt,
    },
  });

  return taskId;
}

// ---------------------------------------------------------------------------
// Intelligence: Session End Helpers
// ---------------------------------------------------------------------------

/**
 * End an agent session by setting ended_at, simulating what the CLI/orchestrator does.
 * This triggers the SurrealDB EVENT for Observer session-end analysis.
 */
export async function endAgentSession(
  surreal: Surreal,
  sessionId: string,
): Promise<void> {
  const sessionRecord = new RecordId("agent_session", sessionId);

  await surreal.query(
    `UPDATE $sess SET ended_at = time::now();`,
    { sess: sessionRecord },
  );
}

// ---------------------------------------------------------------------------
// Intelligence: Trace Content Helpers
// ---------------------------------------------------------------------------

/**
 * Seed an LLM trace with response content in the FLEXIBLE output field.
 * Used for Observer per-trace analysis testing.
 */
export async function seedLlmTraceWithContent(
  surreal: Surreal,
  traceId: string,
  options: {
    model: string;
    workspaceId: string;
    sessionId?: string;
    conversationId?: string;
    responseText: string;
    stopReason?: string;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  },
): Promise<string> {
  const traceRecord = new RecordId("trace", traceId);
  const workspaceRecord = new RecordId("workspace", options.workspaceId);

  // Ensure a test identity exists for the actor field (required by trace schema)
  const actorId = `proxy-test-actor-${options.workspaceId}`;
  const actorRecord = new RecordId("identity", actorId);
  await surreal.query(
    `CREATE $actor CONTENT { name: "proxy-test-system", type: "system", workspace: $ws, created_at: time::now() };`,
    { actor: actorRecord, ws: workspaceRecord },
  ).catch(() => undefined); // Ignore if already exists

  const input: Record<string, unknown> = {};
  if (options.conversationId) {
    input.conversation = new RecordId("conversation", options.conversationId);
  }

  const output: Record<string, unknown> = {
    content: [{ type: "text", text: options.responseText }],
    stop_reason: options.stopReason ?? "end_turn",
  };

  await surreal.query(`CREATE $trace CONTENT $content;`, {
    trace: traceRecord,
    content: {
      type: "llm_call",
      model: options.model,
      actor: actorRecord,
      workspace: workspaceRecord,
      input_tokens: options.inputTokens ?? 100,
      output_tokens: options.outputTokens ?? 50,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      cost_usd: options.costUsd ?? 0.001,
      latency_ms: 500,
      stop_reason: options.stopReason ?? "end_turn",
      input,
      output,
      created_at: new Date(),
    },
  });

  // Create workspace edge
  await surreal.query(
    `RELATE $trace->scoped_to->$workspace SET created_at = time::now();`,
    { trace: traceRecord, workspace: workspaceRecord },
  );

  // Link to session: set session field on trace AND create invoked edge
  if (options.sessionId) {
    const sessionRecord = new RecordId("agent_session", options.sessionId);
    await surreal.query(
      `UPDATE $trace SET session = $sess;`,
      { trace: traceRecord, sess: sessionRecord },
    );
    await surreal.query(
      `RELATE $sess->invoked->$trace SET created_at = time::now();`,
      { trace: traceRecord, sess: sessionRecord },
    );
  }

  return traceId;
}

// ---------------------------------------------------------------------------
// Intelligence: Observer Trigger Helpers
// ---------------------------------------------------------------------------

/**
 * Trigger the Observer coherence scan for a workspace.
 */
export async function triggerCoherenceScan(
  baseUrl: string,
  workspaceId: string,
): Promise<Response> {
  return fetch(
    `${baseUrl}/api/observe/scan/${workspaceId}`,
    { method: "POST" },
  );
}

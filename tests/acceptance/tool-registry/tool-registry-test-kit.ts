/**
 * Tool Registry Acceptance Test Kit
 *
 * Domain-specific helpers for MCP Tool Registry acceptance tests.
 * Extends the shared acceptance-test-kit with tool registry setup,
 * SurrealDB seed helpers, and API request builders.
 *
 * Driving ports:
 *   - POST /api/workspaces/:workspaceId/tools (tool CRUD)
 *   - POST /api/workspaces/:workspaceId/tools/:toolId/grants (can_use edges)
 *   - POST /api/workspaces/:workspaceId/providers (credential provider CRUD)
 *   - POST /api/workspaces/:workspaceId/accounts/connect/:providerId (account connection)
 *   - DELETE /api/workspaces/:workspaceId/accounts/:accountId (account revocation)
 *   - GET /api/workspaces/:workspaceId/identities/:identityId/toolset (effective toolset)
 *   - POST /proxy/llm/anthropic/v1/messages (proxy with tool injection + interception)
 */
import { RecordId, type Surreal } from "surrealdb";
import { http, HttpResponse } from "msw";
import { setupServer as setupMswServer } from "msw/node";
import {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  type AcceptanceTestRuntime,
  type TestUserWithMcp,
} from "../acceptance-test-kit";
import { seedProxyToken } from "../shared-fixtures";

// Re-export shared helpers
export {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  type AcceptanceTestRuntime,
  type TestUserWithMcp,
};

// ---------------------------------------------------------------------------
// Tool Seed Helpers
// ---------------------------------------------------------------------------

export type SeedToolOptions = {
  name: string;
  toolkit: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  provider?: string; // credential_provider record ID
  riskLevel?: "low" | "medium" | "high" | "critical";
  status?: "active" | "disabled";
  workspaceId: string;
};

/**
 * Seed an mcp_tool record directly in SurrealDB.
 * Returns the tool record ID string.
 */
export async function seedMcpTool(
  surreal: Surreal,
  toolId: string,
  options: SeedToolOptions,
): Promise<string> {
  const toolRecord = new RecordId("mcp_tool", toolId);
  const workspaceRecord = new RecordId("workspace", options.workspaceId);

  const content: Record<string, unknown> = {
    name: options.name,
    toolkit: options.toolkit,
    description: options.description,
    input_schema: options.inputSchema,
    risk_level: options.riskLevel ?? "medium",
    workspace: workspaceRecord,
    status: options.status ?? "active",
    created_at: new Date(),
  };

  if (options.outputSchema) {
    content.output_schema = options.outputSchema;
  }

  if (options.provider) {
    content.provider = new RecordId("credential_provider", options.provider);
  }

  await surreal.query(`CREATE $tool CONTENT $content;`, {
    tool: toolRecord,
    content,
  });

  return toolId;
}

/**
 * Seed a Brain-native tool (no provider reference).
 * These are tools backed by Brain's own graph queries.
 */
export async function seedOsabioNativeTool(
  surreal: Surreal,
  toolId: string,
  options: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    workspaceId: string;
  },
): Promise<string> {
  return seedMcpTool(surreal, toolId, {
    ...options,
    toolkit: "osabio",
    riskLevel: "low",
  });
}

/**
 * Seed an integration tool (has provider reference).
 */
export async function seedIntegrationTool(
  surreal: Surreal,
  toolId: string,
  options: {
    name: string;
    toolkit: string;
    description: string;
    inputSchema: Record<string, unknown>;
    providerId: string;
    workspaceId: string;
    riskLevel?: "low" | "medium" | "high" | "critical";
  },
): Promise<string> {
  return seedMcpTool(surreal, toolId, {
    ...options,
    provider: options.providerId,
  });
}

// ---------------------------------------------------------------------------
// Can_use Edge Helpers
// ---------------------------------------------------------------------------

/**
 * Create a can_use relation edge from identity to mcp_tool.
 */
export async function seedCanUseEdge(
  surreal: Surreal,
  identityId: string,
  toolId: string,
  options?: { maxCallsPerHour?: number },
): Promise<void> {
  const identityRecord = new RecordId("identity", identityId);
  const toolRecord = new RecordId("mcp_tool", toolId);

  const setClause = options?.maxCallsPerHour
    ? `SET granted_at = time::now(), max_calls_per_hour = ${options.maxCallsPerHour}`
    : `SET granted_at = time::now()`;

  await surreal.query(
    `RELATE $identity->can_use->$tool ${setClause};`,
    { identity: identityRecord, tool: toolRecord },
  );
}

// ---------------------------------------------------------------------------
// Credential Provider Helpers
// ---------------------------------------------------------------------------

export type SeedProviderOptions = {
  name: string;
  displayName: string;
  authMethod: "oauth2" | "api_key" | "bearer" | "basic";
  workspaceId: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecretEncrypted?: string;
  scopes?: string[];
  apiKeyHeader?: string;
};

/**
 * Seed a credential_provider record directly in SurrealDB.
 */
export async function seedCredentialProvider(
  surreal: Surreal,
  providerId: string,
  options: SeedProviderOptions,
): Promise<string> {
  const providerRecord = new RecordId("credential_provider", providerId);
  const workspaceRecord = new RecordId("workspace", options.workspaceId);

  const content: Record<string, unknown> = {
    name: options.name,
    display_name: options.displayName,
    auth_method: options.authMethod,
    workspace: workspaceRecord,
    created_at: new Date(),
  };

  if (options.authorizationUrl) content.authorization_url = options.authorizationUrl;
  if (options.tokenUrl) content.token_url = options.tokenUrl;
  if (options.clientId) content.client_id = options.clientId;
  if (options.clientSecretEncrypted) content.client_secret_encrypted = options.clientSecretEncrypted;
  if (options.scopes) content.scopes = options.scopes;
  if (options.apiKeyHeader) content.api_key_header = options.apiKeyHeader;

  await surreal.query(`CREATE $provider CONTENT $content;`, {
    provider: providerRecord,
    content,
  });

  return providerId;
}

// ---------------------------------------------------------------------------
// Connected Account Helpers
// ---------------------------------------------------------------------------

export type SeedAccountOptions = {
  identityId: string;
  providerId: string;
  workspaceId: string;
  status?: "active" | "expired" | "revoked";
  accessTokenEncrypted?: string;
  refreshTokenEncrypted?: string;
  tokenExpiresAt?: Date;
  apiKeyEncrypted?: string;
  basicUsername?: string;
  basicPasswordEncrypted?: string;
  scopes?: string[];
};

/**
 * Seed a connected_account record directly in SurrealDB.
 */
export async function seedConnectedAccount(
  surreal: Surreal,
  accountId: string,
  options: SeedAccountOptions,
): Promise<string> {
  const accountRecord = new RecordId("connected_account", accountId);
  const identityRecord = new RecordId("identity", options.identityId);
  const providerRecord = new RecordId("credential_provider", options.providerId);
  const workspaceRecord = new RecordId("workspace", options.workspaceId);

  const content: Record<string, unknown> = {
    identity: identityRecord,
    provider: providerRecord,
    workspace: workspaceRecord,
    status: options.status ?? "active",
    connected_at: new Date(),
  };

  if (options.accessTokenEncrypted) content.access_token_encrypted = options.accessTokenEncrypted;
  if (options.refreshTokenEncrypted) content.refresh_token_encrypted = options.refreshTokenEncrypted;
  if (options.tokenExpiresAt) content.token_expires_at = options.tokenExpiresAt;
  if (options.apiKeyEncrypted) content.api_key_encrypted = options.apiKeyEncrypted;
  if (options.basicUsername) content.basic_username = options.basicUsername;
  if (options.basicPasswordEncrypted) content.basic_password_encrypted = options.basicPasswordEncrypted;
  if (options.scopes) content.scopes = options.scopes;

  await surreal.query(`CREATE $account CONTENT $content;`, {
    account: accountRecord,
    content,
  });

  return accountId;
}

// ---------------------------------------------------------------------------
// Governance Helpers
// ---------------------------------------------------------------------------

/**
 * Seed a governs_tool relation edge from policy to mcp_tool.
 */
export async function seedGovernsTool(
  surreal: Surreal,
  policyId: string,
  toolId: string,
  options?: { conditions?: string; maxPerCall?: number; maxPerDay?: number },
): Promise<void> {
  const policyRecord = new RecordId("policy", policyId);
  const toolRecord = new RecordId("mcp_tool", toolId);

  const setClauses: string[] = [];
  if (options?.conditions) setClauses.push(`conditions = $conditions`);
  if (options?.maxPerCall !== undefined) setClauses.push(`max_per_call = ${options.maxPerCall}`);
  if (options?.maxPerDay !== undefined) setClauses.push(`max_per_day = ${options.maxPerDay}`);

  const setString = setClauses.length > 0 ? `SET ${setClauses.join(", ")}` : "";

  await surreal.query(
    `RELATE $policy->governs_tool->$tool ${setString};`,
    { policy: policyRecord, tool: toolRecord, conditions: options?.conditions },
  );
}

/**
 * Seed a policy record for tool governance testing.
 */
export async function seedToolPolicy(
  surreal: Surreal,
  policyId: string,
  options: {
    title: string;
    workspaceId: string;
    identityId?: string;
    status?: string;
  },
): Promise<string> {
  const policyRecord = new RecordId("policy", policyId);
  const workspaceRecord = new RecordId("workspace", options.workspaceId);
  // created_by is required (record<identity>); use a deterministic fallback for tests
  const createdByRecord = new RecordId(
    "identity",
    options.identityId ?? "test-policy-author",
  );

  await surreal.query(`CREATE $policy CONTENT $content;`, {
    policy: policyRecord,
    content: {
      title: options.title,
      description: `Tool governance policy: ${options.title}`,
      status: options.status ?? "active",
      version: 1,
      workspace: workspaceRecord,
      created_by: createdByRecord,
      selector: {},
      rego_source: "package osabio.policy\ndefault allow = true",
      created_at: new Date(),
    },
  });

  return policyId;
}

// ---------------------------------------------------------------------------
// Query Helpers
// ---------------------------------------------------------------------------

export type McpToolRecord = {
  id: RecordId;
  name: string;
  toolkit: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  provider?: RecordId;
  risk_level: string;
  workspace: RecordId;
  status: string;
  created_at: Date;
};

/**
 * Query all mcp_tool records in a workspace.
 */
export async function getToolsForWorkspace(
  surreal: Surreal,
  workspaceId: string,
): Promise<McpToolRecord[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const results = await surreal.query(
    `SELECT * FROM mcp_tool WHERE workspace = $ws ORDER BY toolkit, name;`,
    { ws: workspaceRecord },
  );

  return (results[0] ?? []) as McpToolRecord[];
}

/**
 * Query can_use edges for an identity.
 */
export async function getCanUseEdgesForIdentity(
  surreal: Surreal,
  identityId: string,
): Promise<Array<{ in: RecordId; out: RecordId; granted_at: Date; max_calls_per_hour?: number }>> {
  const identityRecord = new RecordId("identity", identityId);

  const results = await surreal.query(
    `SELECT * FROM can_use WHERE in = $identity;`,
    { identity: identityRecord },
  );

  return (results[0] ?? []) as Array<{ in: RecordId; out: RecordId; granted_at: Date; max_calls_per_hour?: number }>;
}

/**
 * Query trace records with type "tool_call" for a workspace.
 */
export async function getToolCallTraces(
  surreal: Surreal,
  workspaceId: string,
): Promise<Array<{
  id: RecordId;
  type: string;
  tool_name?: string;
  actor?: RecordId;
  workspace: RecordId;
  duration_ms?: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  created_at: Date;
}>> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const results = await surreal.query(
    `SELECT * FROM trace WHERE type = 'tool_call' AND workspace = $ws ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  );

  return (results[0] ?? []) as Array<{
    id: RecordId;
    type: string;
    tool_name?: string;
    actor?: RecordId;
    workspace: RecordId;
    duration_ms?: number;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    created_at: Date;
  }>;
}

/**
 * Query connected_account records for an identity.
 */
export async function getConnectedAccounts(
  surreal: Surreal,
  identityId: string,
): Promise<Array<{
  id: RecordId;
  identity: RecordId;
  provider: RecordId;
  status: string;
  access_token_encrypted?: string;
  refresh_token_encrypted?: string;
  api_key_encrypted?: string;
  basic_password_encrypted?: string;
}>> {
  const identityRecord = new RecordId("identity", identityId);

  const results = await surreal.query(
    `SELECT * FROM connected_account WHERE identity = $identity;`,
    { identity: identityRecord },
  );

  return (results[0] ?? []) as Array<{
    id: RecordId;
    identity: RecordId;
    provider: RecordId;
    status: string;
    access_token_encrypted?: string;
    refresh_token_encrypted?: string;
    api_key_encrypted?: string;
    basic_password_encrypted?: string;
  }>;
}

/**
 * Query credential_provider records for a workspace.
 */
export async function getProvidersForWorkspace(
  surreal: Surreal,
  workspaceId: string,
): Promise<Array<{
  id: RecordId;
  name: string;
  display_name: string;
  auth_method: string;
  client_secret_encrypted?: string;
}>> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const results = await surreal.query(
    `SELECT * FROM credential_provider WHERE workspace = $ws ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  );

  return (results[0] ?? []) as Array<{
    id: RecordId;
    name: string;
    display_name: string;
    auth_method: string;
    client_secret_encrypted?: string;
  }>;
}

// Re-export seedProxyToken from shared fixtures
export { seedProxyToken };

// ---------------------------------------------------------------------------
// Proxy Request Helpers (for tool injection + interception tests)
// ---------------------------------------------------------------------------

/**
 * Send a request through the LLM proxy with proxy token auth.
 * Seeds a proxy_token on first call per user (cached on the user object).
 *
 * This is the driving port for tool injection tests (step 7.5) and
 * tool interception tests (step 8.5).
 */
export async function sendProxyRequestWithIdentity(
  baseUrl: string,
  surreal: Surreal,
  user: TestUserWithMcp,
  options: {
    messages: Array<{ role: string; content: string }>;
    tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
    model?: string;
    maxTokens?: number;
    stream?: boolean;
    apiKey?: string;
  },
): Promise<Response> {
  const cached = (user as unknown as { _proxyToken?: string })._proxyToken;
  const proxyToken = cached ?? await seedProxyToken(surreal, user.identityId, user.workspaceId);
  if (!cached) {
    (user as unknown as { _proxyToken?: string })._proxyToken = proxyToken;
  }

  const body = JSON.stringify({
    model: options.model ?? "claude-haiku-4-5-20251001",
    max_tokens: options.maxTokens ?? 100,
    stream: options.stream ?? false,
    messages: options.messages,
    ...(options.tools ? { tools: options.tools } : {}),
  });

  return fetch(`${baseUrl}/proxy/llm/anthropic/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": options.apiKey ?? "test-api-key",
      "X-Osabio-Auth": proxyToken,
    },
    body,
  });
}

// ---------------------------------------------------------------------------
// Composite Seed Helpers (build on earlier phases)
// ---------------------------------------------------------------------------

/**
 * Set up a complete tool grant scenario:
 * Creates an mcp_tool + can_use edge for an identity.
 * Reusable across credential, proxy, and governance tests.
 */
export async function seedToolWithGrant(
  surreal: Surreal,
  options: {
    toolId: string;
    toolName: string;
    toolkit: string;
    description: string;
    inputSchema: Record<string, unknown>;
    identityId: string;
    workspaceId: string;
    providerId?: string;
    riskLevel?: "low" | "medium" | "high" | "critical";
    maxCallsPerHour?: number;
  },
): Promise<string> {
  await seedMcpTool(surreal, options.toolId, {
    name: options.toolName,
    toolkit: options.toolkit,
    description: options.description,
    inputSchema: options.inputSchema,
    provider: options.providerId,
    riskLevel: options.riskLevel,
    workspaceId: options.workspaceId,
  });

  await seedCanUseEdge(surreal, options.identityId, options.toolId, {
    maxCallsPerHour: options.maxCallsPerHour,
  });

  return options.toolId;
}

/**
 * Set up a full integration tool scenario:
 * credential_provider + mcp_tool (with provider) + can_use edge + connected_account.
 * Reusable across credential brokerage and integration routing tests.
 */
export async function seedFullIntegrationTool(
  surreal: Surreal,
  options: {
    providerId: string;
    providerName: string;
    authMethod: "oauth2" | "api_key" | "bearer" | "basic";
    toolId: string;
    toolName: string;
    toolkit: string;
    description: string;
    inputSchema: Record<string, unknown>;
    identityId: string;
    workspaceId: string;
    accountId: string;
    // OAuth2-specific
    authorizationUrl?: string;
    tokenUrl?: string;
    clientId?: string;
    clientSecretEncrypted?: string;
    scopes?: string[];
    accessTokenEncrypted?: string;
    refreshTokenEncrypted?: string;
    tokenExpiresAt?: Date;
    // API key-specific
    apiKeyHeader?: string;
    apiKeyEncrypted?: string;
    // Basic-specific
    basicUsername?: string;
    basicPasswordEncrypted?: string;
  },
): Promise<{
  providerId: string;
  toolId: string;
  accountId: string;
}> {
  // 1. Create credential provider
  await seedCredentialProvider(surreal, options.providerId, {
    name: options.providerName,
    displayName: options.providerName,
    authMethod: options.authMethod,
    workspaceId: options.workspaceId,
    authorizationUrl: options.authorizationUrl,
    tokenUrl: options.tokenUrl,
    clientId: options.clientId,
    clientSecretEncrypted: options.clientSecretEncrypted,
    scopes: options.scopes,
    apiKeyHeader: options.apiKeyHeader,
  });

  // 2. Create mcp_tool with provider reference
  await seedIntegrationTool(surreal, options.toolId, {
    name: options.toolName,
    toolkit: options.toolkit,
    description: options.description,
    inputSchema: options.inputSchema,
    providerId: options.providerId,
    workspaceId: options.workspaceId,
  });

  // 3. Create can_use edge
  await seedCanUseEdge(surreal, options.identityId, options.toolId);

  // 4. Create connected account
  await seedConnectedAccount(surreal, options.accountId, {
    identityId: options.identityId,
    providerId: options.providerId,
    workspaceId: options.workspaceId,
    accessTokenEncrypted: options.accessTokenEncrypted,
    refreshTokenEncrypted: options.refreshTokenEncrypted,
    tokenExpiresAt: options.tokenExpiresAt,
    apiKeyEncrypted: options.apiKeyEncrypted,
    basicUsername: options.basicUsername,
    basicPasswordEncrypted: options.basicPasswordEncrypted,
    scopes: options.scopes,
  });

  return {
    providerId: options.providerId,
    toolId: options.toolId,
    accountId: options.accountId,
  };
}

// ---------------------------------------------------------------------------
// Mock Anthropic API (MSW)
// ---------------------------------------------------------------------------

/**
 * Create a module-level MSW server that mocks the Anthropic Messages API.
 * Returns a simple text response for every request. Use in beforeAll/afterAll.
 */
export function createMockAnthropicServer(anthropicApiUrl = process.env.ANTHROPIC_API_URL?.trim() || "https://api.anthropic.com") {
  const server = setupMswServer(
    http.post(`${anthropicApiUrl}/v1/messages`, () => {
      return HttpResponse.json({
        id: `msg_mock_${crypto.randomUUID().slice(0, 8)}`,
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Mock response from Anthropic." }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    }),
  );
  return server;
}

/**
 * Create an MSW mock that returns a tool_use response on the first call,
 * then end_turn on subsequent calls. Use for tests that need the proxy
 * to enter the tool interception loop (e.g. tracing tests).
 */
export function createMockAnthropicServerWithToolUse(
  toolName: string,
  toolInput: Record<string, unknown> = { query: "test" },
  anthropicApiUrl = process.env.ANTHROPIC_API_URL?.trim() || "https://api.anthropic.com",
) {
  let callCount = 0;

  const server = setupMswServer(
    http.post(`${anthropicApiUrl}/v1/messages`, () => {
      callCount++;
      if (callCount === 1) {
        return HttpResponse.json({
          id: `msg_mock_${crypto.randomUUID().slice(0, 8)}`,
          type: "message",
          role: "assistant",
          content: [{
            type: "tool_use",
            id: `toolu_mock_${crypto.randomUUID().slice(0, 8)}`,
            name: toolName,
            input: toolInput,
          }],
          model: "claude-haiku-4-5-20251001",
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 15, output_tokens: 20 },
        });
      }
      return HttpResponse.json({
        id: `msg_mock_${crypto.randomUUID().slice(0, 8)}`,
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Based on the search results, here is what I found." }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 25, output_tokens: 15 },
      });
    }),
  );

  return server;
}

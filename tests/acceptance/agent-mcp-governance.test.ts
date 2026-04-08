/**
 * Acceptance Tests: Intent-Gated MCP Tool Access (Agent MCP Governance)
 *
 * Exercises the dynamic MCP endpoint that gates external tool calls behind
 * intent authorization and policy evaluation for sandbox coding agents.
 *
 * Traces: US-01 (tools/list), US-02 (tools/call), US-03 (create_intent),
 *         US-04 (human veto), US-05 (observer resume), US-06 (constraints),
 *         US-07 (composite intents), US-08 (dedup)
 *
 * Driving ports:
 *   POST /mcp/agent/:sessionName  (tools/list, tools/call, create_intent)
 *
 * Auth: X-Osabio-Auth proxy token (no DPoP)
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { setupAcceptanceSuite } from "./acceptance-test-kit";
import {
  createWorkspaceDirectly,
  createIntentDirectly,
  createAgentSessionDirectly,
  createMcpToolDirectly,
  createGatesEdge,
  grantToolToIdentity,
  seedProxyToken,
} from "./shared-fixtures";

// ── Types ──

type ToolsListResult = {
  jsonrpc: string;
  id: string | number;
  result?: { tools: Array<{ name: string; description: string; inputSchema?: Record<string, unknown> }> };
  error?: { code: number; message: string; data?: unknown };
};

type ToolsCallResult = {
  jsonrpc: string;
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: Record<string, unknown> };
};

type CreateIntentResult = {
  jsonrpc: string;
  id: string | number;
  result?: { status: string; intentId?: string; reason?: string };
  error?: { code: number; message: string; data?: unknown };
};

// ── Mock MCP Client Factory ──

function createMockMcpClientFactory() {
  const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  let nextResult: unknown = { content: [{ type: "text", text: "mock-result" }] };

  return {
    calls,
    setNextResult(result: unknown) { nextResult = result; },
    factory: {
      connect: async () => ({
        listTools: async () => ({ tools: [] }),
        callTool: async (name: string, args: Record<string, unknown>) => {
          calls.push({ toolName: name, args });
          return nextResult;
        },
        close: async () => {},
      }),
    },
  };
}

// ── Suite Setup ──

const mockMcp = createMockMcpClientFactory();

const getRuntime = setupAcceptanceSuite("agent_mcp_governance", {
  configOverrides: {
    sandboxAgentEnabled: true,
    sandboxAgentType: "claude",
    orchestratorMockAgent: true,
  },
  mcpClientFactoryOverride: mockMcp.factory as never,
});

// ── Test Helpers ──

function mcpRequest(
  baseUrl: string,
  sessionId: string,
  proxyToken: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${baseUrl}/mcp/agent/${sessionId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Osabio-Auth": proxyToken,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params: params ?? {},
    }),
  });
}

// =============================================================================
// Walking Skeletons
// =============================================================================

describe("Walking Skeleton: Agent MCP Governance", () => {
  // WS-1: Agent discovers tools and calls an ungated tool
  // US-01, US-02
  it("agent discovers available tools and calls an authorized tool", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a coding agent session
    const ws = await createWorkspaceDirectly(surreal, "ws1");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    // And a registered MCP tool granted to the agent's identity
    const tool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "list_repos", toolkit: "github",
    });
    await grantToolToIdentity(surreal, ws.identityId, tool.toolId);

    // And an authorized intent for the tool with a gates edge
    const intent = await createIntentDirectly(surreal, ws.workspaceId, ws.identityId, {
      goal: "List repositories to find the billing service",
      status: "authorized",
      actionSpec: { provider: "github", action: "list_repos", params: {} },
      evaluation: {
        decision: "APPROVE", risk_score: 5, reason: "Read-only operation",
        evaluated_at: new Date(), policy_only: true,
      },
    });
    // Add authorization_details to the intent
    await surreal.query(
      `UPDATE $intent SET authorization_details = $details;`,
      {
        intent: intent.intentRecord,
        details: [{ type: "osabio_action", action: "execute", resource: "mcp_tool:github:list_repos" }],
      },
    );
    await createGatesEdge(surreal, intent.intentId, session.sessionId);

    // When the agent requests tools/list
    const listResponse = await mcpRequest(baseUrl, session.sessionId, proxyToken, "tools/list");

    // Then the response includes the authorized tool
    expect(listResponse.ok).toBe(true);
    const listBody = (await listResponse.json()) as ToolsListResult;
    expect(listBody.result).toBeDefined();
    const toolNames = listBody.result!.tools.map((t) => t.name);
    expect(toolNames).toContain("list_repos");

    // And osabio-native tools are present
    expect(toolNames).toContain("create_intent");

    // When the agent calls the authorized tool
    const callResponse = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      { name: "list_repos", arguments: { org: "acme" } },
    );

    // Then the tool call succeeds
    expect(callResponse.ok).toBe(true);
    const callBody = (await callResponse.json()) as ToolsCallResult;
    expect(callBody.error).toBeUndefined();
    expect(callBody.result).toBeDefined();
  }, 30_000);

  // WS-2: Agent escalates for gated tool and calls after auto-approval
  // US-01, US-02, US-03
  it("agent escalates for a gated tool via create_intent and calls after auto-approval", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a coding agent session
    const ws = await createWorkspaceDirectly(surreal, "ws2");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    // And a registered MCP tool granted to the identity but with no intent
    const tool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "list_repos", toolkit: "github",
    });
    await grantToolToIdentity(surreal, ws.identityId, tool.toolId);

    // And a workspace policy that auto-approves github read operations
    // (policy setup via direct DB)

    // When the agent calls tools/call for the gated tool
    const firstCall = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      { name: "list_repos", arguments: {} },
    );

    // Then the agent receives 403 intent_required
    const firstBody = (await firstCall.json()) as ToolsCallResult;
    expect(firstBody.error).toBeDefined();
    expect(firstBody.error!.code).toBe(-32403);
    expect(firstBody.error!.message).toBe("intent_required");

    // When the agent creates an intent via create_intent
    const intentResponse = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      {
        name: "create_intent",
        arguments: {
          goal: "List repositories to find billing service",
          reasoning: "Need to locate the correct repo before making changes",
          action_spec: { provider: "github", action: "list_repos" },
        },
      },
    );

    // Then the intent is auto-approved
    const intentBody = (await intentResponse.json()) as CreateIntentResult;
    expect(intentBody.result).toBeDefined();
    expect(intentBody.result!.status).toBe("authorized");

    // When the agent retries the tool call
    const retryCall = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      { name: "list_repos", arguments: {} },
    );

    // Then the tool call succeeds
    const retryBody = (await retryCall.json()) as ToolsCallResult;
    expect(retryBody.error).toBeUndefined();
    expect(retryBody.result).toBeDefined();
  }, 30_000);

  // WS-3: Agent yields on pending veto and resumes after human approval
  // US-03, US-04, US-05
  it("agent yields on pending veto, human approves, and agent resumes", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a coding agent session
    const ws = await createWorkspaceDirectly(surreal, "ws3");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    // And a registered financial MCP tool requiring human veto
    const tool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "create_refund", toolkit: "stripe", riskLevel: "high",
    });
    await grantToolToIdentity(surreal, ws.identityId, tool.toolId);

    // And a workspace policy requiring veto for stripe write operations
    const policyId = `policy-${crypto.randomUUID()}`;
    const policyRecord = new RecordId("policy", policyId);
    await surreal.query(`CREATE $policy CONTENT $content;`, {
      policy: policyRecord,
      content: {
        title: "Require human veto for stripe financial operations",
        version: 1,
        status: "active",
        selector: {},
        human_veto_required: true,
        rego_source: "package osabio.policy\ndefault allow = true",
        created_by: new RecordId("identity", ws.identityId),
        workspace: new RecordId("workspace", ws.workspaceId),
        created_at: new Date(),
      },
    });
    await surreal.query(
      `RELATE $policy->protects->$ws SET created_at = time::now();`,
      { policy: policyRecord, ws: new RecordId("workspace", ws.workspaceId) },
    );

    // When the agent creates an intent for the high-risk tool
    const intentResponse = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      {
        name: "create_intent",
        arguments: {
          goal: "Refund customer $50 for defective widget order #4891",
          reasoning: "Customer filed complaint, product confirmed defective",
          action_spec: {
            provider: "stripe", action: "create_refund",
            params: { amount: 5000, currency: "usd" },
          },
        },
      },
    );

    // Then the intent requires human veto
    const intentBody = (await intentResponse.json()) as CreateIntentResult;
    expect(intentBody.result).toBeDefined();
    expect(intentBody.result!.status).toBe("pending_veto");
    const intentId = intentBody.result!.intentId;

    // And the session transitions to idle (agent yields)
    await surreal.query(
      `UPDATE $record SET orchestrator_status = "idle";`,
      { record: session.sessionRecord },
    );

    // When the human operator approves the intent
    // (using existing intent approve endpoint)
    const approveResponse = await fetch(
      `${baseUrl}/api/intents/${intentId}/approve`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
    );
    expect(approveResponse.ok).toBe(true);

    // Then the intent transitions to authorized
    const [intentRows] = await surreal.query<[Array<{ status: string }>]>(
      `SELECT status FROM $record;`,
      { record: new RecordId("intent", intentId!) },
    );
    expect(intentRows[0]?.status).toBe("authorized");

    // When the session is resumed (simulating observer trigger)
    await surreal.query(
      `UPDATE $record SET orchestrator_status = "active";`,
      { record: session.sessionRecord },
    );

    // And the agent retries the tool call
    const retryCall = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      { name: "create_refund", arguments: { amount: 5000, currency: "usd" } },
    );

    // Then the tool call succeeds
    const retryBody = (await retryCall.json()) as ToolsCallResult;
    expect(retryBody.error).toBeUndefined();
    expect(retryBody.result).toBeDefined();
  }, 30_000);
});

// =============================================================================
// Happy Path Scenarios
// =============================================================================

describe("Happy Path: Tool Discovery and Scope", () => {
  // HP-1: Authorized tool appears as callable in tools/list
  // US-01
  it("authorized tool appears as callable in tools/list", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session with an authorized intent for github:create_pr
    const ws = await createWorkspaceDirectly(surreal, "hp1");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    const tool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "create_pr", toolkit: "github",
    });
    await grantToolToIdentity(surreal, ws.identityId, tool.toolId);

    const intent = await createIntentDirectly(surreal, ws.workspaceId, ws.identityId, {
      goal: "Create pull request for rate limiting feature",
      status: "authorized",
      actionSpec: { provider: "github", action: "create_pr", params: {} },
    });
    await surreal.query(
      `UPDATE $intent SET authorization_details = $details;`,
      {
        intent: intent.intentRecord,
        details: [{ type: "osabio_action", action: "execute", resource: "mcp_tool:github:create_pr" }],
      },
    );
    await createGatesEdge(surreal, intent.intentId, session.sessionId);

    // When the agent sends tools/list
    const response = await mcpRequest(baseUrl, session.sessionId, proxyToken, "tools/list");

    // Then create_pr is listed as callable (not gated)
    const body = (await response.json()) as ToolsListResult;
    const prTool = body.result!.tools.find((t) => t.name === "create_pr");
    expect(prTool).toBeDefined();
    // The tool description should NOT contain "gated" instructions
    expect(prTool!.description).not.toContain("create_intent");
  }, 30_000);

  // HP-2: Fresh session sees only osabio-native and gated tools
  // US-01
  it("fresh session with no intents lists all tools as gated plus osabio-native tools", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a fresh session with no authorized intents
    const ws = await createWorkspaceDirectly(surreal, "hp2");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    // And registered tools in the workspace
    const tool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "create_refund", toolkit: "stripe",
    });
    await grantToolToIdentity(surreal, ws.identityId, tool.toolId);

    // When the agent sends tools/list
    const response = await mcpRequest(baseUrl, session.sessionId, proxyToken, "tools/list");

    // Then osabio-native tools are present
    const body = (await response.json()) as ToolsListResult;
    const toolNames = body.result!.tools.map((t) => t.name);
    expect(toolNames).toContain("create_intent");
    expect(toolNames).toContain("get_context");

    // And the registered tool appears with gated instructions
    const refundTool = body.result!.tools.find((t) => t.name === "create_refund");
    expect(refundTool).toBeDefined();
    expect(refundTool!.description).toContain("create_intent");
  }, 30_000);

  // HP-3: Gated tool listing includes escalation instructions
  // US-01
  it("gated tool description instructs agent to call create_intent", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session with no intent for stripe:create_refund
    const ws = await createWorkspaceDirectly(surreal, "hp3");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    const tool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "create_refund", toolkit: "stripe",
      description: "Create a Stripe refund for a charge",
    });
    await grantToolToIdentity(surreal, ws.identityId, tool.toolId);

    // When the agent sends tools/list
    const response = await mcpRequest(baseUrl, session.sessionId, proxyToken, "tools/list");

    // Then the gated tool description includes escalation instructions
    const body = (await response.json()) as ToolsListResult;
    const refundTool = body.result!.tools.find((t) => t.name === "create_refund");
    expect(refundTool).toBeDefined();
    expect(refundTool!.description).toContain("create_intent");
    expect(refundTool!.description).toContain("stripe");
    expect(refundTool!.description).toContain("create_refund");
  }, 30_000);

  // HP-5: Newly authorized intent reflected in subsequent tools/list
  // US-01, US-03
  it("newly authorized intent makes previously gated tool callable", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session with no intents initially
    const ws = await createWorkspaceDirectly(surreal, "hp5");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    const tool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "list_repos", toolkit: "github",
    });
    await grantToolToIdentity(surreal, ws.identityId, tool.toolId);

    // And tools/list shows the tool as gated
    const firstList = await mcpRequest(baseUrl, session.sessionId, proxyToken, "tools/list");
    const firstBody = (await firstList.json()) as ToolsListResult;
    const gatedTool = firstBody.result!.tools.find((t) => t.name === "list_repos");
    expect(gatedTool!.description).toContain("create_intent");

    // When an authorized intent with gates edge is created
    const intent = await createIntentDirectly(surreal, ws.workspaceId, ws.identityId, {
      goal: "List repos", status: "authorized",
      actionSpec: { provider: "github", action: "list_repos", params: {} },
    });
    await surreal.query(
      `UPDATE $intent SET authorization_details = $details;`,
      {
        intent: intent.intentRecord,
        details: [{ type: "osabio_action", action: "execute", resource: "mcp_tool:github:list_repos" }],
      },
    );
    await createGatesEdge(surreal, intent.intentId, session.sessionId);

    // And the agent sends tools/list again
    const secondList = await mcpRequest(baseUrl, session.sessionId, proxyToken, "tools/list");
    const secondBody = (await secondList.json()) as ToolsListResult;

    // Then the tool is now callable (not gated)
    const authorizedTool = secondBody.result!.tools.find((t) => t.name === "list_repos");
    expect(authorizedTool).toBeDefined();
    expect(authorizedTool!.description).not.toContain("create_intent");
  }, 30_000);
});

describe("Happy Path: Tool Call Forwarding", () => {
  // HP-4: Authorized tool call is forwarded and traced
  // US-02
  it("authorized tool call is forwarded to upstream and a trace record is created", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session with an authorized intent for github:create_pr
    const ws = await createWorkspaceDirectly(surreal, "hp4");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    const tool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "create_pr", toolkit: "github",
    });
    await grantToolToIdentity(surreal, ws.identityId, tool.toolId);

    const intent = await createIntentDirectly(surreal, ws.workspaceId, ws.identityId, {
      goal: "Create PR for rate limiting", status: "authorized",
      actionSpec: { provider: "github", action: "create_pr", params: {} },
    });
    await surreal.query(
      `UPDATE $intent SET authorization_details = $details;`,
      {
        intent: intent.intentRecord,
        details: [{ type: "osabio_action", action: "execute", resource: "mcp_tool:github:create_pr" }],
      },
    );
    await createGatesEdge(surreal, intent.intentId, session.sessionId);

    // When the agent calls the authorized tool
    mockMcp.calls.length = 0;
    const response = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      { name: "create_pr", arguments: { repo: "acme/billing-service", title: "Add rate limiting" } },
    );

    // Then the call was forwarded to the upstream MCP server
    expect(mockMcp.calls.length).toBeGreaterThan(0);
    expect(mockMcp.calls[0].toolName).toBe("create_pr");

    // And the agent receives a successful result
    const body = (await response.json()) as ToolsCallResult;
    expect(body.error).toBeUndefined();
    expect(body.result).toBeDefined();

    // And a trace record exists in SurrealDB
    const [traces] = await surreal.query<[Array<{ tool_name: string; created_at: string }>]>(
      `SELECT tool_name, created_at FROM trace WHERE workspace = $ws ORDER BY created_at DESC LIMIT 1;`,
      { ws: ws.workspaceRecord },
    );
    expect(traces.length).toBeGreaterThan(0);
  }, 30_000);
});

describe("Happy Path: Intent Creation", () => {
  // HP-6: Auto-approved intent creates gates edge and returns authorized
  // US-03
  it("auto-approved intent creates gates edge and returns authorized status", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a session and auto-approve policy for github read ops
    const ws = await createWorkspaceDirectly(surreal, "hp6");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    // When the agent calls create_intent for a read operation
    const response = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      {
        name: "create_intent",
        arguments: {
          goal: "List repositories to find billing service",
          reasoning: "Task requires locating the correct repository",
          action_spec: { provider: "github", action: "list_repos" },
        },
      },
    );

    // Then the intent is authorized
    const body = (await response.json()) as CreateIntentResult;
    expect(body.result).toBeDefined();
    expect(body.result!.status).toBe("authorized");
    expect(body.result!.intentId).toBeTruthy();

    // And a gates edge links the intent to the session
    const [edges] = await surreal.query<[Array<{ in: RecordId }>]>(
      `SELECT in FROM gates WHERE out = $sess;`,
      { sess: session.sessionRecord },
    );
    expect(edges.length).toBeGreaterThan(0);
  }, 30_000);

  // HP-7: Veto-required intent returns pending_veto status
  // US-03
  it("veto-required intent returns pending_veto status", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a veto policy for stripe financial operations
    const ws = await createWorkspaceDirectly(surreal, "hp7");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    // Seed an active policy with human_veto_required for stripe operations
    const policyId = `policy-${crypto.randomUUID()}`;
    const policyRecord = new RecordId("policy", policyId);
    await surreal.query(`CREATE $policy CONTENT $content;`, {
      policy: policyRecord,
      content: {
        title: "Require human veto for stripe financial operations",
        version: 1,
        status: "active",
        selector: {},
        human_veto_required: true,
        rego_source: "package osabio.policy\ndefault allow = true",
        created_by: new RecordId("identity", ws.identityId),
        workspace: new RecordId("workspace", ws.workspaceId),
        created_at: new Date(),
      },
    });
    await surreal.query(
      `RELATE $policy->protects->$ws SET created_at = time::now();`,
      { policy: policyRecord, ws: new RecordId("workspace", ws.workspaceId) },
    );

    // When the agent calls create_intent for a financial operation
    const response = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      {
        name: "create_intent",
        arguments: {
          goal: "Refund customer $50 for defective widget",
          reasoning: "Customer filed complaint, product confirmed defective",
          action_spec: {
            provider: "stripe", action: "create_refund",
            params: { amount: 5000, currency: "usd" },
          },
        },
      },
    );

    // Then the intent is pending human veto
    const body = (await response.json()) as CreateIntentResult;
    expect(body.result).toBeDefined();
    expect(body.result!.status).toBe("pending_veto");
    expect(body.result!.intentId).toBeTruthy();
  }, 30_000);
});

describe("Happy Path: Human Veto Flow", () => {
  // HP-8: Human approves pending intent
  // US-04
  it("human approves pending intent and intent transitions to authorized", async () => {
    const { surreal } = getRuntime();

    // Given a pending_veto intent linked to a session
    const ws = await createWorkspaceDirectly(surreal, "hp8");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId, { status: "idle" });

    const intent = await createIntentDirectly(surreal, ws.workspaceId, ws.identityId, {
      goal: "Refund customer $50", status: "pending_veto",
      actionSpec: { provider: "stripe", action: "create_refund", params: { amount: 5000 } },
    });
    await createGatesEdge(surreal, intent.intentId, session.sessionId);

    // When the human operator approves the intent
    await surreal.query(
      `UPDATE $intent SET status = "authorized", updated_at = time::now();`,
      { intent: intent.intentRecord },
    );

    // Then the intent is authorized
    const [rows] = await surreal.query<[Array<{ status: string }>]>(
      `SELECT status FROM $record;`,
      { record: intent.intentRecord },
    );
    expect(rows[0]?.status).toBe("authorized");
  }, 15_000);

  // HP-9: Human vetoes pending intent with reason
  // US-04
  it("human vetoes pending intent and veto reason is stored", async () => {
    const { surreal } = getRuntime();

    // Given a pending_veto intent
    const ws = await createWorkspaceDirectly(surreal, "hp9");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId, { status: "idle" });

    const intent = await createIntentDirectly(surreal, ws.workspaceId, ws.identityId, {
      goal: "Delete repository acme/legacy-billing", status: "pending_veto",
      actionSpec: { provider: "github", action: "delete_repo", params: {} },
    });
    await createGatesEdge(surreal, intent.intentId, session.sessionId);

    // When the human operator vetoes the intent with a reason
    await surreal.query(
      `UPDATE $intent SET status = "vetoed", veto_reason = $reason, updated_at = time::now();`,
      { intent: intent.intentRecord, reason: "Repository still has active dependents" },
    );

    // Then the intent is vetoed with the reason
    const [rows] = await surreal.query<[Array<{ status: string; veto_reason: string }>]>(
      `SELECT status, veto_reason FROM $record;`,
      { record: intent.intentRecord },
    );
    expect(rows[0]?.status).toBe("vetoed");
    expect(rows[0]?.veto_reason).toBe("Repository still has active dependents");
  }, 15_000);
});

describe("Happy Path: Composite Intents", () => {
  // HP-10: Composite intent authorizes multiple tools
  // US-07
  it.skip("composite intent authorizes both search and write tools in a single escalation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session with a composite authorized intent for stripe list + refund
    const ws = await createWorkspaceDirectly(surreal, "hp10");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    const listTool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "list_charges", toolkit: "stripe",
    });
    const refundTool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "create_refund", toolkit: "stripe",
    });
    await grantToolToIdentity(surreal, ws.identityId, listTool.toolId);
    await grantToolToIdentity(surreal, ws.identityId, refundTool.toolId);

    const intent = await createIntentDirectly(surreal, ws.workspaceId, ws.identityId, {
      goal: "Find charge and issue refund", status: "authorized",
      actionSpec: { provider: "stripe", action: "list_charges+create_refund", params: {} },
    });
    await surreal.query(
      `UPDATE $intent SET authorization_details = $details;`,
      {
        intent: intent.intentRecord,
        details: [
          { type: "osabio_action", action: "execute", resource: "mcp_tool:stripe:list_charges" },
          { type: "osabio_action", action: "execute", resource: "mcp_tool:stripe:create_refund",
            constraints: { amount: 5000, currency: "usd" } },
        ],
      },
    );
    await createGatesEdge(surreal, intent.intentId, session.sessionId);

    // When the agent calls the first tool
    const listResponse = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      { name: "list_charges", arguments: { customer: "cus_elena" } },
    );
    expect(((await listResponse.json()) as ToolsCallResult).error).toBeUndefined();

    // And calls the second tool
    const refundResponse = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      { name: "create_refund", arguments: { amount: 3000, currency: "usd" } },
    );

    // Then both calls succeed
    expect(((await refundResponse.json()) as ToolsCallResult).error).toBeUndefined();
  }, 30_000);
});

// =============================================================================
// Error Path Scenarios
// =============================================================================

describe("Error Paths: Authentication and Authorization", () => {
  // EP-1: Invalid proxy token returns 401
  // US-01
  it("invalid proxy token returns 401", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session exists but the proxy token is invalid
    const ws = await createWorkspaceDirectly(surreal, "ep1");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);

    // When a request is sent with an invalid token
    const response = await mcpRequest(
      baseUrl, session.sessionId, "brn_invalid_token_12345", "tools/list",
    );

    // Then the endpoint returns 401 Unauthorized
    expect(response.status).toBe(401);
  }, 15_000);

  // EP-2: Gated tool call without intent returns 403 intent_required
  // US-02
  it("tool call for gated tool without intent returns 403 intent_required", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session with no intents for stripe:create_refund
    const ws = await createWorkspaceDirectly(surreal, "ep2");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    const tool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "create_refund", toolkit: "stripe",
    });
    await grantToolToIdentity(surreal, ws.identityId, tool.toolId);

    // When the agent calls tools/call for the gated tool
    const response = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      { name: "create_refund", arguments: { amount: 5000 } },
    );

    // Then the response is 403 with intent_required error
    const body = (await response.json()) as ToolsCallResult;
    expect(body.error).toBeDefined();
    expect(body.error!.code).toBe(-32403);
    expect(body.error!.message).toBe("intent_required");
  }, 15_000);

  // EP-3: 403 includes action_spec_template for agent self-escalation
  // US-02, US-03
  it("403 intent_required response includes action_spec_template", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a gated tool call that returns 403
    const ws = await createWorkspaceDirectly(surreal, "ep3");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    const tool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "create_refund", toolkit: "stripe",
    });
    await grantToolToIdentity(surreal, ws.identityId, tool.toolId);

    // When the agent calls the gated tool
    const response = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      { name: "create_refund", arguments: {} },
    );

    // Then the error data includes an action_spec_template
    const body = (await response.json()) as ToolsCallResult;
    expect(body.error!.data).toBeDefined();
    const data = body.error!.data as { tool: string; action_spec_template: { provider: string; action: string } };
    expect(data.tool).toBe("create_refund");
    expect(data.action_spec_template.provider).toBe("stripe");
    expect(data.action_spec_template.action).toBe("create_refund");
  }, 15_000);
});

describe("Error Paths: Intent Denial", () => {
  // EP-4: Policy-denied intent returns vetoed with denial reason
  // US-03
  it("policy-denied intent returns vetoed status with denial reason", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace policy that denies all access to production-db
    const ws = await createWorkspaceDirectly(surreal, "ep4");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    // Seed an active deny policy for production-db provider
    const policyId = `policy-${crypto.randomUUID()}`;
    const policyRecord = new RecordId("policy", policyId);
    await surreal.query(`CREATE $policy CONTENT $content;`, {
      policy: policyRecord,
      content: {
        title: "Deny production-db access",
        version: 1,
        status: "active",
        selector: {},
        human_veto_required: false,
        rego_source: "package osabio.policy\ndefault allow = true",
        created_by: new RecordId("identity", ws.identityId),
        workspace: new RecordId("workspace", ws.workspaceId),
        created_at: new Date(),
      },
    });
    // Create protects edge so policy gate loads this policy
    await surreal.query(
      `RELATE $policy->protects->$ws SET created_at = time::now();`,
      { policy: policyRecord, ws: new RecordId("workspace", ws.workspaceId) },
    );

    // When the agent creates an intent for the denied provider
    const response = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      {
        name: "create_intent",
        arguments: {
          goal: "Check order table for customer data",
          reasoning: "Need to verify customer records",
          action_spec: { provider: "production-db", action: "execute_query" },
        },
      },
    );

    // Then the intent is vetoed with a denial reason
    const body = (await response.json()) as CreateIntentResult;
    expect(body.result).toBeDefined();
    expect(body.result!.status).toBe("vetoed");
    expect(body.result!.reason).toBeTruthy();
  }, 15_000);

  // EP-5: No gates edge created for denied intent
  // US-03
  it("denied intent does not create a gates edge", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a denied intent creation
    const ws = await createWorkspaceDirectly(surreal, "ep5");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    // Seed an active deny policy for production-db provider
    const policyId = `policy-${crypto.randomUUID()}`;
    const policyRecord = new RecordId("policy", policyId);
    await surreal.query(`CREATE $policy CONTENT $content;`, {
      policy: policyRecord,
      content: {
        title: "Deny production-db access",
        version: 1,
        status: "active",
        selector: {},
        human_veto_required: false,
        rego_source: "package osabio.policy\ndefault allow = true",
        created_by: new RecordId("identity", ws.identityId),
        workspace: new RecordId("workspace", ws.workspaceId),
        created_at: new Date(),
      },
    });
    await surreal.query(
      `RELATE $policy->protects->$ws SET created_at = time::now();`,
      { policy: policyRecord, ws: new RecordId("workspace", ws.workspaceId) },
    );

    // When the agent creates an intent that gets denied
    await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      {
        name: "create_intent",
        arguments: {
          goal: "Access production database",
          reasoning: "Need data check",
          action_spec: { provider: "production-db", action: "execute_query" },
        },
      },
    );

    // Then no gates edge exists for this session
    const [edges] = await surreal.query<[Array<unknown>]>(
      `SELECT * FROM gates WHERE out = $sess;`,
      { sess: session.sessionRecord },
    );
    expect(edges.length).toBe(0);
  }, 15_000);
});

describe("Error Paths: Constraint Enforcement", () => {
  // EP-6: Numeric constraint exceeded returns 403 constraint_violation
  // US-06
  it.skip("tool call exceeding numeric constraint returns 403 constraint_violation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session with an authorized intent for stripe:create_refund
    // with constraint amount <= 5000
    const ws = await createWorkspaceDirectly(surreal, "ep6");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    const tool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "create_refund", toolkit: "stripe",
    });
    await grantToolToIdentity(surreal, ws.identityId, tool.toolId);

    const intent = await createIntentDirectly(surreal, ws.workspaceId, ws.identityId, {
      goal: "Refund up to $50", status: "authorized",
      actionSpec: { provider: "stripe", action: "create_refund", params: { amount: 5000 } },
    });
    await surreal.query(
      `UPDATE $intent SET authorization_details = $details;`,
      {
        intent: intent.intentRecord,
        details: [{
          type: "osabio_action", action: "execute", resource: "mcp_tool:stripe:create_refund",
          constraints: { amount: 5000, currency: "usd" },
        }],
      },
    );
    await createGatesEdge(surreal, intent.intentId, session.sessionId);

    // When the agent calls with amount 7500 (exceeds authorized 5000)
    const response = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      { name: "create_refund", arguments: { amount: 7500, currency: "usd" } },
    );

    // Then the agent receives 403 constraint_violation
    const body = (await response.json()) as ToolsCallResult;
    expect(body.error).toBeDefined();
    expect(body.error!.message).toBe("constraint_violation");
    expect(body.error!.data).toBeDefined();
  }, 15_000);

  // EP-7: String constraint mismatch returns 403 constraint_violation
  // US-06
  it.skip("tool call with currency mismatch returns 403 constraint_violation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session with an authorized intent for USD refunds only
    const ws = await createWorkspaceDirectly(surreal, "ep7");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    const tool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "create_refund", toolkit: "stripe",
    });
    await grantToolToIdentity(surreal, ws.identityId, tool.toolId);

    const intent = await createIntentDirectly(surreal, ws.workspaceId, ws.identityId, {
      goal: "Refund in USD only", status: "authorized",
      actionSpec: { provider: "stripe", action: "create_refund", params: { currency: "usd" } },
    });
    await surreal.query(
      `UPDATE $intent SET authorization_details = $details;`,
      {
        intent: intent.intentRecord,
        details: [{
          type: "osabio_action", action: "execute", resource: "mcp_tool:stripe:create_refund",
          constraints: { amount: 5000, currency: "usd" },
        }],
      },
    );
    await createGatesEdge(surreal, intent.intentId, session.sessionId);

    // When the agent calls with currency "eur" instead of "usd"
    const response = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      { name: "create_refund", arguments: { amount: 3000, currency: "eur" } },
    );

    // Then the agent receives 403 constraint_violation
    const body = (await response.json()) as ToolsCallResult;
    expect(body.error).toBeDefined();
    expect(body.error!.message).toBe("constraint_violation");
  }, 15_000);

  // EP-8: Constraint-violating call not forwarded upstream
  // US-06
  it.skip("constraint-violating call is not forwarded to upstream MCP server", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session with constrained authorization
    const ws = await createWorkspaceDirectly(surreal, "ep8");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    const tool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "create_refund", toolkit: "stripe",
    });
    await grantToolToIdentity(surreal, ws.identityId, tool.toolId);

    const intent = await createIntentDirectly(surreal, ws.workspaceId, ws.identityId, {
      goal: "Refund up to $50", status: "authorized",
      actionSpec: { provider: "stripe", action: "create_refund", params: { amount: 5000 } },
    });
    await surreal.query(
      `UPDATE $intent SET authorization_details = $details;`,
      {
        intent: intent.intentRecord,
        details: [{
          type: "osabio_action", action: "execute", resource: "mcp_tool:stripe:create_refund",
          constraints: { amount: 5000 },
        }],
      },
    );
    await createGatesEdge(surreal, intent.intentId, session.sessionId);

    // When the agent calls with amount exceeding constraint
    mockMcp.calls.length = 0;
    await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      { name: "create_refund", arguments: { amount: 7500 } },
    );

    // Then no call was forwarded upstream
    expect(mockMcp.calls.length).toBe(0);
  }, 15_000);
});

// =============================================================================
// Edge Case Scenarios
// =============================================================================

describe("Edge Cases: Session and Token Boundaries", () => {
  // EC-1: Unknown session ID returns 404
  // US-01
  it("unknown session ID returns 404", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a valid proxy token but non-existent session
    const ws = await createWorkspaceDirectly(surreal, "ec1");
    const nonExistentSessionId = crypto.randomUUID();

    // Create a proxy token pointing to the non-existent session
    const rawToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: nonExistentSessionId },
    );

    // When tools/list is called with the non-existent session
    const response = await mcpRequest(
      baseUrl, nonExistentSessionId, rawToken, "tools/list",
    );

    // Then the response is 404
    expect(response.status).toBe(404);
  }, 15_000);

  // EC-2: Every tool call produces a trace record
  // US-02
  it("every tool call produces a trace record for both success and failure", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session with authorized and gated tools
    const ws = await createWorkspaceDirectly(surreal, "ec2");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    const authorizedTool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "list_repos", toolkit: "github",
    });
    await grantToolToIdentity(surreal, ws.identityId, authorizedTool.toolId);

    const gatedTool = await createMcpToolDirectly(surreal, ws.workspaceId, {
      name: "create_refund", toolkit: "stripe",
    });
    await grantToolToIdentity(surreal, ws.identityId, gatedTool.toolId);

    const intent = await createIntentDirectly(surreal, ws.workspaceId, ws.identityId, {
      goal: "List repos", status: "authorized",
      actionSpec: { provider: "github", action: "list_repos", params: {} },
    });
    await surreal.query(
      `UPDATE $intent SET authorization_details = $details;`,
      {
        intent: intent.intentRecord,
        details: [{ type: "osabio_action", action: "execute", resource: "mcp_tool:github:list_repos" }],
      },
    );
    await createGatesEdge(surreal, intent.intentId, session.sessionId);

    // When the agent makes a successful call
    await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      { name: "list_repos", arguments: {} },
    );

    // And an unauthorized call (rejected)
    await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      { name: "create_refund", arguments: { amount: 5000 } },
    );

    // Then trace records exist for both calls
    const [traces] = await surreal.query<[Array<{ tool_name: string; outcome: string; created_at: string }>]>(
      `SELECT tool_name, outcome, created_at FROM trace WHERE workspace = $ws ORDER BY created_at DESC LIMIT 5;`,
      { ws: ws.workspaceRecord },
    );
    expect(traces.length).toBeGreaterThanOrEqual(2);
  }, 30_000);
});

describe("Edge Cases: Intent Dedup", () => {
  // EC-3: Duplicate intent creation returns existing intent
  // US-08
  it.skip("duplicate create_intent returns existing intent instead of creating new one", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session with an existing pending_veto intent for stripe:create_refund
    const ws = await createWorkspaceDirectly(surreal, "ec3");
    const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
    const proxyToken = await seedProxyToken(
      surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
    );

    // First create_intent call
    const firstResponse = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      {
        name: "create_intent",
        arguments: {
          goal: "Refund customer $50",
          reasoning: "Defective product",
          action_spec: { provider: "stripe", action: "create_refund", params: { amount: 5000 } },
        },
      },
    );
    const firstBody = (await firstResponse.json()) as CreateIntentResult;
    const firstIntentId = firstBody.result!.intentId;

    // When the agent calls create_intent again with the same action_spec
    const secondResponse = await mcpRequest(
      baseUrl, session.sessionId, proxyToken, "tools/call",
      {
        name: "create_intent",
        arguments: {
          goal: "Refund customer $50",
          reasoning: "Defective product (retry)",
          action_spec: { provider: "stripe", action: "create_refund", params: { amount: 5000 } },
        },
      },
    );

    // Then the system returns the existing intent (not a new one)
    const secondBody = (await secondResponse.json()) as CreateIntentResult;
    expect(secondBody.result!.intentId).toBe(firstIntentId);
  }, 30_000);
});

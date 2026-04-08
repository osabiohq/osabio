import appHtml from "../../client/index.html";
import { withTracing } from "../http/instrumentation";
import { jsonResponse } from "../http/response";
import { createSseRegistry } from "../streaming/sse-registry";
import { createRuntimeDependencies } from "./dependencies";
import { loadServerConfig } from "./config";
import { createInflightTracker } from "./types";
import type { ServerDependencies } from "./types";
import { ensureDefaultWorkspaceProjectScope } from "../workspace/workspace-scope";
import { createWorkspaceRouteHandlers } from "../workspace/workspace-routes";
import { createChatIngressHandlers } from "../chat/chat-ingress";
import { createEntitySearchHandler } from "../entities/entity-search-route";
import { createGraphRouteHandler } from "../graph/graph-route";
import { createEntityDetailHandler } from "../entities/entity-detail-route";
import { createEntityActionsHandler } from "../entities/entity-actions-route";
import { createWorkItemAcceptHandler } from "../entities/work-item-accept-route";
import { createBranchConversationHandler } from "../chat/branch-conversation";
import { createGitHubWebhookHandler } from "../webhook/github-webhook-route";
import { createFeedRouteHandler } from "../feed/feed-route";
import { createChatRouteHandler } from "../chat/chat-route";
import { createMcpRouteHandlers } from "../mcp/mcp-route";
import { createIntentRouteHandlers } from "../intent/intent-routes";
import { wireOrchestratorRoutes } from "../orchestrator/routes";
import type { ShellExec } from "../orchestrator/worktree-manager";
import { OSABIO_SCOPES } from "../auth/scopes";
import { createClientInfoHandler } from "../auth/client-info-route";
import { createVetoManager } from "../intent/veto-manager";
import { updateIntentStatus, queryExpiredVetoIntents } from "../intent/intent-queries";
import { buildJwksResponse } from "../oauth/as-key-management";
import { createIntentSubmissionHandler } from "../oauth/intent-submission";
import { createTokenEndpointHandler } from "../oauth/token-endpoint";
import { createNonceCache } from "../oauth/nonce-cache";
import { createBridgeExchangeHandler } from "../oauth/bridge";
import { RecordId } from "surrealdb";
import { createObserverRouteHandler, createGraphScanRouteHandler } from "../observer/observer-route";
import { createLearningRouteHandlers } from "../learning/learning-route";
import { createPolicyRouteHandlers } from "../policy/policy-route";
import { createSkillRouteHandlers } from "../skill/skill-route";
import { createObjectiveRouteHandlers } from "../objective/objective-route";
import { createBehaviorRouteHandlers } from "../behavior/behavior-route";
import { createProviderRouteHandlers, createAccountRouteHandlers } from "../tool-registry/routes";
import { createToolRouteHandlers } from "../tool-registry/tool-routes";
import { createGrantRouteHandlers } from "../tool-registry/grant-routes";
import { createServerRouteHandlers } from "../tool-registry/server-routes";
import { createLiveSelectManager } from "../reactive/live-select-manager";
import { createFeedSseBridge } from "../reactive/feed-sse-bridge";
import { createAgentActivatorHandler } from "../reactive/agent-activator";
import { createLoopDampener } from "../reactive/loop-dampener";
import { createAgentMcpHandler } from "../mcp/agent-mcp-route";
import { createAnthropicProxyHandler } from "../proxy/anthropic-proxy-route";
import { createProxyTokenHandler } from "../proxy/proxy-token-route";
import { createAgentRouteHandlers } from "../agents/agent-route";
import { lookupAgentInWorkspace } from "../agents/agent-queries";
import { createSpendApiHandlers } from "../proxy/spend-api";
import { createAuditApiHandlers } from "../proxy/audit-api";
import { initTelemetry } from "../telemetry/init";
import { log } from "../telemetry/logger";

export function createBrainServer(deps: ServerDependencies): ReturnType<typeof Bun.serve> {
  const config = deps.config;

  // Shell execution — shared by workspace and orchestrator routes
  const shellExec: ShellExec = async (command, args, cwd) => {
    const proc = Bun.spawn([command, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  };

  const workspaceHandlers = createWorkspaceRouteHandlers(deps, shellExec);
  const chatHandlers = createChatIngressHandlers(deps);
  const entitySearchHandler = createEntitySearchHandler(deps);
  const graphHandler = createGraphRouteHandler(deps);
  const entityDetailHandler = createEntityDetailHandler(deps);
  const entityActionsHandler = createEntityActionsHandler(deps);
  const workItemAcceptHandler = createWorkItemAcceptHandler(deps);
  const branchConversationHandler = createBranchConversationHandler(deps);
  const githubWebhookHandler = createGitHubWebhookHandler(deps);
  const feedHandler = createFeedRouteHandler(deps);
  const chatRouteHandler = createChatRouteHandler(deps);
  const mcpHandlers = createMcpRouteHandlers(deps);
  const intentHandlers = createIntentRouteHandlers(deps);
  const intentSubmissionHandler = createIntentSubmissionHandler(deps);
  const tokenEndpointHandler = createTokenEndpointHandler(deps);
  const bridgeExchangeHandler = createBridgeExchangeHandler(deps);
  const observerHandler = createObserverRouteHandler(deps);
  const graphScanHandler = createGraphScanRouteHandler(deps);

  // Agent Activator: POST endpoint called by SurrealDB DEFINE EVENT webhook
  const activatorDampener = createLoopDampener(
    { threshold: 4, windowMs: 60_000 },
    undefined,
    (_key, event) => {
      log.info("activator.dampened", "Loop dampener activated", {
        workspaceId: event.workspaceId,
        entityId: event.entityId,
        sourceAgent: event.sourceAgent,
      });
    },
  );
  const activatorHandler = createAgentActivatorHandler({
    surreal: deps.surreal,
    loopDampener: activatorDampener,
    inflight: deps.inflight,
    classifierModel: deps.extractionModel,
    internalWebhookSecret: config.internalWebhookSecret,
    onAgentActivation: (activation) => {
      log.info("activator.agent_activated", "LLM classified agent for activation", {
        agentId: activation.agentId,
        agentType: activation.agentType,
        workspaceId: activation.workspaceId,
        reason: activation.reason,
        observationId: activation.observationId,
      });
    },
  });
  const learningHandlers = createLearningRouteHandlers(deps);
  const policyHandlers = createPolicyRouteHandlers(deps);
  const skillHandlers = createSkillRouteHandlers(deps);
  const objectiveHandlers = createObjectiveRouteHandlers(deps);
  const behaviorHandlers = createBehaviorRouteHandlers(deps);
  const providerHandlers = createProviderRouteHandlers(deps);
  const accountHandlers = createAccountRouteHandlers(deps);
  const toolHandlers = createToolRouteHandlers(deps);
  const grantHandlers = createGrantRouteHandlers(deps);
  const mcpServerHandlers = createServerRouteHandlers(deps);
  const agentMcpHandler = createAgentMcpHandler(deps);
  const anthropicProxyHandler = createAnthropicProxyHandler(deps);
  const proxyTokenHandler = createProxyTokenHandler(deps);
  const spendApiHandlers = createSpendApiHandlers(deps);
  const auditApiHandlers = createAuditApiHandlers(deps);
  const agentCrudHandlers = createAgentRouteHandlers(deps);

  // Orchestrator wiring
  const orchestratorHandlers = wireOrchestratorRoutes({
    surreal: deps.surreal,
    shellExec,
    osabioBaseUrl: config.baseUrl,
    extractionModel: deps.extractionModel,
    asSigningKey: deps.asSigningKey,
    sseRegistry: deps.sse,
    auth: deps.auth,
    mockAgent: config.orchestratorMockAgent,
    sandboxAgentAdapter: deps.sandboxAgentAdapter,
    sandboxAgentType: config.sandboxAgentType,
    lookupAgentInWorkspace,
  });

  return Bun.serve({
    port: config.port,
    idleTimeout: 0,
    routes: {
      "/healthz": {
        GET: withTracing("GET /healthz", "GET", async () => jsonResponse({ status: "ok" }, 200)),
      },
      "/config": {
        GET: withTracing("GET /config", "GET", async () =>
          jsonResponse({
            selfHosted: config.selfHosted,
            worktreeManagerEnabled: config.worktreeManagerEnabled,
          }, 200),
        ),
      },
      "/api/workspaces": {
        POST: withTracing("POST /api/workspaces", "POST", (request) => workspaceHandlers.handleCreateWorkspace(request)),
      },
      "/api/workspaces/mine": {
        GET: withTracing("GET /api/workspaces/mine", "GET", (request) => workspaceHandlers.handleWorkspaceMine(request)),
      },
      "/api/workspaces/:workspaceId/bootstrap": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/bootstrap",
          "GET",
          (request) => workspaceHandlers.handleWorkspaceBootstrap(request.params.workspaceId),
        ),
      },
      "/api/workspaces/:workspaceId/sidebar": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/sidebar",
          "GET",
          (request) => workspaceHandlers.handleWorkspaceSidebar(request.params.workspaceId),
        ),
      },
      "/api/workspaces/:workspaceId/repo-path": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/repo-path",
          "POST",
          (request) => workspaceHandlers.handleUpdateRepoPath(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/settings": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/settings",
          "GET",
          (request) => workspaceHandlers.handleGetSettings(request.params.workspaceId, request),
        ),
        PUT: withTracing(
          "PUT /api/workspaces/:workspaceId/settings",
          "PUT",
          (request) => workspaceHandlers.handlePutSettings(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/conversations/:conversationId": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/conversations/:conversationId",
          "GET",
          (request) =>
            workspaceHandlers.handleWorkspaceConversation(
              request.params.workspaceId,
              request.params.conversationId,
            ),
        ),
      },
      "/api/chat": {
        POST: withTracing("POST /api/chat", "POST", (request) => chatRouteHandler(request)),
      },
      "/api/chat/messages": {
        POST: withTracing("POST /api/chat/messages", "POST", (request) => chatHandlers.handlePostChatMessage(request)),
      },
      "/api/chat/stream/:messageId": {
        GET: withTracing("GET /api/chat/stream/:messageId", "GET", (request) =>
          chatHandlers.handleChatStream(request.params.messageId),
        ),
      },
      "/api/entities/search": {
        GET: withTracing("GET /api/entities/search", "GET", (request) => entitySearchHandler(new URL(request.url))),
      },
      "/api/graph/:workspaceId": {
        GET: withTracing("GET /api/graph/:workspaceId", "GET", (request) =>
          graphHandler(request.params.workspaceId, new URL(request.url)),
        ),
      },
      "/api/entities/:entityId": {
        GET: withTracing("GET /api/entities/:entityId", "GET", (request) =>
          entityDetailHandler(request.params.entityId, new URL(request.url)),
        ),
      },
      "/api/entities/:entityId/actions": {
        POST: withTracing("POST /api/entities/:entityId/actions", "POST", (request) =>
          entityActionsHandler(request.params.entityId, request),
        ),
      },
      "/api/workspaces/:workspaceId/conversations/:parentId/branch": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/conversations/:parentId/branch",
          "POST",
          (request) =>
            branchConversationHandler(
              request.params.workspaceId,
              request.params.parentId,
              request,
            ),
        ),
      },
      "/api/workspaces/:workspaceId/work-items/accept": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/work-items/accept",
          "POST",
          (request) => workItemAcceptHandler(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/learnings": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/learnings",
          "POST",
          (request) => learningHandlers.handleCreate(request.params.workspaceId, request),
        ),
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/learnings",
          "GET",
          (request) => learningHandlers.handleList(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/learnings/:learningId": {
        PUT: withTracing(
          "PUT /api/workspaces/:workspaceId/learnings/:learningId",
          "PUT",
          (request) => learningHandlers.handleEdit(
            request.params.workspaceId,
            request.params.learningId,
            request,
          ),
        ),
      },
      "/api/workspaces/:workspaceId/learnings/:learningId/actions": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/learnings/:learningId/actions",
          "POST",
          (request) => learningHandlers.handleAction(
            request.params.workspaceId,
            request.params.learningId,
            request,
          ),
        ),
      },
      "/api/workspaces/:workspaceId/policies": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/policies",
          "GET",
          (request) => policyHandlers.handleList(request.params.workspaceId, request),
        ),
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/policies",
          "POST",
          (request) => policyHandlers.handleCreate(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/policies/validate": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/policies/validate",
          "POST",
          (request) => policyHandlers.handleValidate(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/policies/:policyId": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/policies/:policyId",
          "GET",
          (request) => policyHandlers.handleDetail(
            request.params.workspaceId,
            request.params.policyId,
            request,
          ),
        ),
      },
      "/api/workspaces/:workspaceId/policies/:policyId/activate": {
        PATCH: withTracing(
          "PATCH /api/workspaces/:workspaceId/policies/:policyId/activate",
          "PATCH",
          (request) => policyHandlers.handleActivate(
            request.params.workspaceId,
            request.params.policyId,
            request,
          ),
        ),
      },
      "/api/workspaces/:workspaceId/policies/:policyId/deprecate": {
        PATCH: withTracing(
          "PATCH /api/workspaces/:workspaceId/policies/:policyId/deprecate",
          "PATCH",
          (request) => policyHandlers.handleDeprecate(
            request.params.workspaceId,
            request.params.policyId,
            request,
          ),
        ),
      },
      "/api/workspaces/:workspaceId/policies/:policyId/versions": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/policies/:policyId/versions",
          "GET",
          (request) => policyHandlers.handleVersionHistory(
            request.params.workspaceId,
            request.params.policyId,
            request,
          ),
        ),
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/policies/:policyId/versions",
          "POST",
          (request) => policyHandlers.handleCreateVersion(
            request.params.workspaceId,
            request.params.policyId,
            request,
          ),
        ),
      },
      "/api/workspaces/:workspaceId/policies/:policyId/test": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/policies/:policyId/test",
          "POST",
          (request) => policyHandlers.handleTest(
            request.params.workspaceId,
            request.params.policyId,
            request,
          ),
        ),
      },
      "/api/workspaces/:workspaceId/skills": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/skills",
          "GET",
          (request) => skillHandlers.handleList(request.params.workspaceId, request),
        ),
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/skills",
          "POST",
          (request) => skillHandlers.handleCreate(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/skills/:skillId/activate": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/skills/:skillId/activate",
          "POST",
          (request) => skillHandlers.handleActivate(
            request.params.workspaceId,
            request.params.skillId,
            request,
          ),
        ),
      },
      "/api/workspaces/:workspaceId/skills/:skillId/deprecate": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/skills/:skillId/deprecate",
          "POST",
          (request) => skillHandlers.handleDeprecate(
            request.params.workspaceId,
            request.params.skillId,
            request,
          ),
        ),
      },
      // skill detail/update/delete MUST be after activate/deprecate to avoid :skillId capturing those sub-paths
      "/api/workspaces/:workspaceId/skills/:skillId": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/skills/:skillId",
          "GET",
          (request) => skillHandlers.handleGetDetail(
            request.params.workspaceId,
            request.params.skillId,
            request,
          ),
        ),
        PUT: withTracing(
          "PUT /api/workspaces/:workspaceId/skills/:skillId",
          "PUT",
          (request) => skillHandlers.handleUpdate(
            request.params.workspaceId,
            request.params.skillId,
            request,
          ),
        ),
        DELETE: withTracing(
          "DELETE /api/workspaces/:workspaceId/skills/:skillId",
          "DELETE",
          (request) => skillHandlers.handleDelete(
            request.params.workspaceId,
            request.params.skillId,
            request,
          ),
        ),
      },
      "/api/workspaces/:workspaceId/agents": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/agents",
          "GET",
          (request) => agentCrudHandlers.handleList(request.params.workspaceId, request),
        ),
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/agents",
          "POST",
          (request) => agentCrudHandlers.handleCreate(request.params.workspaceId, request),
        ),
      },
      // check-name MUST be registered before :agentId to avoid parameter capture
      "/api/workspaces/:workspaceId/agents/check-name": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/agents/check-name",
          "GET",
          (request) => agentCrudHandlers.handleCheckName(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/agents/:agentId": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/agents/:agentId",
          "GET",
          (request) => agentCrudHandlers.handleGetDetail(
            request.params.workspaceId,
            request.params.agentId,
            request,
          ),
        ),
        DELETE: withTracing(
          "DELETE /api/workspaces/:workspaceId/agents/:agentId",
          "DELETE",
          (request) => agentCrudHandlers.handleDelete(
            request.params.workspaceId,
            request.params.agentId,
            request,
          ),
        ),
      },
      "/api/workspaces/:workspaceId/objectives": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/objectives",
          "POST",
          (request) => objectiveHandlers.handleCreate(request.params.workspaceId, request),
        ),
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/objectives",
          "GET",
          (request) => objectiveHandlers.handleList(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/objectives/:objectiveId": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/objectives/:objectiveId",
          "GET",
          (request) => objectiveHandlers.handleGet(request.params.workspaceId, request.params.objectiveId),
        ),
        PUT: withTracing(
          "PUT /api/workspaces/:workspaceId/objectives/:objectiveId",
          "PUT",
          (request) => objectiveHandlers.handleUpdate(request.params.workspaceId, request.params.objectiveId, request),
        ),
      },
      "/api/workspaces/:workspaceId/objectives/:objectiveId/progress": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/objectives/:objectiveId/progress",
          "GET",
          (request) => objectiveHandlers.handleProgress(request.params.workspaceId, request.params.objectiveId),
        ),
      },
      "/api/workspaces/:workspaceId/behaviors": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/behaviors",
          "GET",
          (request) => behaviorHandlers.handleList(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/behaviors/score": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/behaviors/score",
          "POST",
          (request) => behaviorHandlers.handleScore(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/behavior-definitions": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/behavior-definitions",
          "POST",
          (request) => behaviorHandlers.handleCreateDefinition(request.params.workspaceId, request),
        ),
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/behavior-definitions",
          "GET",
          (request) => behaviorHandlers.handleListDefinitions(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/behavior-definitions/:definitionId": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/behavior-definitions/:definitionId",
          "GET",
          (request) => behaviorHandlers.handleGetDefinition(request.params.workspaceId, request.params.definitionId),
        ),
        PUT: withTracing(
          "PUT /api/workspaces/:workspaceId/behavior-definitions/:definitionId",
          "PUT",
          (request) => behaviorHandlers.handleUpdateDefinition(request.params.workspaceId, request.params.definitionId, request),
        ),
      },
      "/api/workspaces/:workspaceId/tools": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/tools",
          "GET",
          (request) => toolHandlers.handleListTools(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/tools/:toolId": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/tools/:toolId",
          "GET",
          (request) => toolHandlers.handleGetToolDetail(request.params.workspaceId, request.params.toolId, request),
        ),
      },
      "/api/workspaces/:workspaceId/tools/:toolId/grants": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/tools/:toolId/grants",
          "POST",
          (request) => grantHandlers.handleCreateGrant(request.params.workspaceId, request.params.toolId, request),
        ),
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/tools/:toolId/grants",
          "GET",
          (request) => grantHandlers.handleListGrants(request.params.workspaceId, request.params.toolId, request),
        ),
      },
      "/api/workspaces/:workspaceId/tools/:toolId/governance": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/tools/:toolId/governance",
          "POST",
          (request) => grantHandlers.handleAttachGovernance(request.params.workspaceId, request.params.toolId, request),
        ),
      },
      "/api/workspaces/:workspaceId/identities": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/identities",
          "GET",
          (request) => grantHandlers.handleListIdentities(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/mcp-servers": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/mcp-servers",
          "POST",
          (request) => mcpServerHandlers.handleCreateServer(request.params.workspaceId, request),
        ),
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/mcp-servers",
          "GET",
          (request) => mcpServerHandlers.handleListServers(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/mcp-servers/:serverId": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/mcp-servers/:serverId",
          "GET",
          (request) => mcpServerHandlers.handleGetServerDetail(request.params.workspaceId, request.params.serverId, request),
        ),
        DELETE: withTracing(
          "DELETE /api/workspaces/:workspaceId/mcp-servers/:serverId",
          "DELETE",
          (request) => mcpServerHandlers.handleDeleteServer(request.params.workspaceId, request.params.serverId, request),
        ),
      },
      "/api/workspaces/:workspaceId/mcp-servers/:serverId/headers": {
        PUT: withTracing(
          "PUT /api/workspaces/:workspaceId/mcp-servers/:serverId/headers",
          "PUT",
          (request) => mcpServerHandlers.handleUpdateHeaders(request.params.workspaceId, request.params.serverId, request),
        ),
      },
      "/api/workspaces/:workspaceId/mcp-servers/:serverId/discover": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/mcp-servers/:serverId/discover",
          "POST",
          (request) => mcpServerHandlers.handleDiscover(request.params.workspaceId, request.params.serverId, request),
        ),
      },
      "/api/workspaces/:workspaceId/mcp-servers/:serverId/discover-auth": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/mcp-servers/:serverId/discover-auth",
          "POST",
          (request) => mcpServerHandlers.handleDiscoverAuth(request.params.workspaceId, request.params.serverId, request),
        ),
      },
      "/api/workspaces/:workspaceId/mcp-servers/:serverId/authorize": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/mcp-servers/:serverId/authorize",
          "POST",
          (request) => mcpServerHandlers.handleAuthorize(request.params.workspaceId, request.params.serverId, request),
        ),
      },
      "/api/workspaces/:workspaceId/mcp-servers/:serverId/auth-status": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/mcp-servers/:serverId/auth-status",
          "GET",
          (request) => mcpServerHandlers.handleGetAuthStatus(request.params.workspaceId, request.params.serverId, request),
        ),
      },
      "/api/workspaces/:workspaceId/mcp-servers/oauth/callback": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/mcp-servers/oauth/callback",
          "GET",
          (request) => mcpServerHandlers.handleOAuthCallback(request.params.workspaceId, request),
        ),
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/mcp-servers/oauth/callback",
          "POST",
          (request) => mcpServerHandlers.handleOAuthCallback(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/mcp-servers/:serverId/sync": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/mcp-servers/:serverId/sync",
          "POST",
          (request) => mcpServerHandlers.handleSync(request.params.workspaceId, request.params.serverId, request),
        ),
      },
      "/api/workspaces/:workspaceId/providers": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/providers",
          "POST",
          (request) => providerHandlers.handleCreate(request.params.workspaceId, request),
        ),
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/providers",
          "GET",
          (request) => providerHandlers.handleList(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/accounts/connect/:providerId": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/accounts/connect/:providerId",
          "POST",
          (request) => accountHandlers.handleConnect(
            request.params.workspaceId,
            request.params.providerId,
            request,
          ),
        ),
      },
      "/api/workspaces/:workspaceId/accounts": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/accounts",
          "GET",
          (request) => accountHandlers.handleListAccounts(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/accounts/:accountId": {
        DELETE: withTracing(
          "DELETE /api/workspaces/:workspaceId/accounts/:accountId",
          "DELETE",
          (request) => accountHandlers.handleRevoke(
            request.params.workspaceId,
            request.params.accountId,
            request,
          ),
        ),
      },
      "/api/workspaces/:workspaceId/feed": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/feed",
          "GET",
          (request) => feedHandler(request.params.workspaceId),
        ),
      },
      "/api/workspaces/:workspaceId/feed/stream": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/feed/stream",
          "GET",
          (request) => deps.sse.handleWorkspaceStreamRequest(
            request.params.workspaceId,
            request.headers.get("Last-Event-ID") ?? undefined,
          ),
        ),
      },
      "/api/workspaces/:workspaceId/webhooks/github": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/webhooks/github",
          "POST",
          (request) => githubWebhookHandler(request.params.workspaceId, request),
        ),
      },
      // Orchestrator — coding agent session management
      "/api/orchestrator/:workspaceId/assign": {
        POST: orchestratorHandlers.assign,
      },
      "/api/orchestrator/:workspaceId/sessions/:sessionId": {
        GET: orchestratorHandlers.status,
      },
      "/api/orchestrator/:workspaceId/sessions/:sessionId/accept": {
        POST: orchestratorHandlers.accept,
      },
      "/api/orchestrator/:workspaceId/sessions/:sessionId/abort": {
        POST: orchestratorHandlers.abort,
      },
      "/api/orchestrator/:workspaceId/sessions/:sessionId/review": {
        GET: orchestratorHandlers.review,
      },
      "/api/orchestrator/:workspaceId/sessions/:sessionId/reject": {
        POST: orchestratorHandlers.reject,
      },
      "/api/orchestrator/:workspaceId/sessions/:sessionId/prompt": {
        POST: orchestratorHandlers.prompt,
      },
      "/api/orchestrator/:workspaceId/sessions/:sessionId/stream": {
        GET: orchestratorHandlers.stream!,
      },
      // MCP — Setup
      "/api/mcp/:workspaceId/projects": {
        GET: withTracing("GET /api/mcp/:workspaceId/projects", "GET", (request) =>
          mcpHandlers.handleListProjects(request.params.workspaceId),
        ),
      },
      // MCP — Intent-based context
      "/api/mcp/:workspaceId/context": {
        POST: withTracing("POST /api/mcp/:workspaceId/context", "POST", (request) =>
          mcpHandlers.handleIntentContext(request.params.workspaceId, request),
        ),
      },
      // MCP — Tier 1 Read
      "/api/mcp/:workspaceId/workspace-context": {
        POST: withTracing("POST /api/mcp/:workspaceId/workspace-context", "POST", (request) =>
          mcpHandlers.handleWorkspaceContext(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/project-context": {
        POST: withTracing("POST /api/mcp/:workspaceId/project-context", "POST", (request) =>
          mcpHandlers.handleProjectContext(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/task-context": {
        POST: withTracing("POST /api/mcp/:workspaceId/task-context", "POST", (request) =>
          mcpHandlers.handleTaskContext(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/decisions": {
        POST: withTracing("POST /api/mcp/:workspaceId/decisions", "POST", (request) =>
          mcpHandlers.handleGetDecisions(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/tasks/dependencies": {
        POST: withTracing("POST /api/mcp/:workspaceId/tasks/dependencies", "POST", (request) =>
          mcpHandlers.handleGetTaskDependencies(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/constraints": {
        POST: withTracing("POST /api/mcp/:workspaceId/constraints", "POST", (request) =>
          mcpHandlers.handleGetConstraints(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/changes": {
        POST: withTracing("POST /api/mcp/:workspaceId/changes", "POST", (request) =>
          mcpHandlers.handleGetChanges(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/entities/:entityId": {
        GET: withTracing("GET /api/mcp/:workspaceId/entities/:entityId", "GET", (request) =>
          mcpHandlers.handleGetEntityDetail(request.params.workspaceId, request.params.entityId, request),
        ),
      },
      // MCP — Tier 2 Reason
      "/api/mcp/:workspaceId/decisions/resolve": {
        POST: withTracing("POST /api/mcp/:workspaceId/decisions/resolve", "POST", (request) =>
          mcpHandlers.handleResolveDecision(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/constraints/check": {
        POST: withTracing("POST /api/mcp/:workspaceId/constraints/check", "POST", (request) =>
          mcpHandlers.handleCheckConstraints(request.params.workspaceId, request),
        ),
      },
      // MCP — Tier 3 Write
      "/api/mcp/:workspaceId/decisions/provisional": {
        POST: withTracing("POST /api/mcp/:workspaceId/decisions/provisional", "POST", (request) =>
          mcpHandlers.handleCreateProvisionalDecision(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/questions": {
        POST: withTracing("POST /api/mcp/:workspaceId/questions", "POST", (request) =>
          mcpHandlers.handleAskQuestion(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/tasks/status": {
        POST: withTracing("POST /api/mcp/:workspaceId/tasks/status", "POST", (request) =>
          mcpHandlers.handleUpdateTaskStatus(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/tasks/subtask": {
        POST: withTracing("POST /api/mcp/:workspaceId/tasks/subtask", "POST", (request) =>
          mcpHandlers.handleCreateSubtask(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/notes": {
        POST: withTracing("POST /api/mcp/:workspaceId/notes", "POST", (request) =>
          mcpHandlers.handleLogNote(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/observations": {
        POST: withTracing("POST /api/mcp/:workspaceId/observations", "POST", (request) =>
          mcpHandlers.handleLogObservation(request.params.workspaceId, request),
        ),
      },
      // MCP — Suggestions
      "/api/mcp/:workspaceId/suggestions": {
        POST: withTracing("POST /api/mcp/:workspaceId/suggestions", "POST", (request) =>
          mcpHandlers.handleListSuggestions(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/suggestions/create": {
        POST: withTracing("POST /api/mcp/:workspaceId/suggestions/create", "POST", (request) =>
          mcpHandlers.handleCreateSuggestion(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/suggestions/action": {
        POST: withTracing("POST /api/mcp/:workspaceId/suggestions/action", "POST", (request) =>
          mcpHandlers.handleSuggestionAction(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/suggestions/convert": {
        POST: withTracing("POST /api/mcp/:workspaceId/suggestions/convert", "POST", (request) =>
          mcpHandlers.handleConvertSuggestion(request.params.workspaceId, request),
        ),
      },
      // MCP — Lifecycle
      "/api/mcp/:workspaceId/sessions/start": {
        POST: withTracing("POST /api/mcp/:workspaceId/sessions/start", "POST", (request) =>
          mcpHandlers.handleSessionStart(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/sessions/end": {
        POST: withTracing("POST /api/mcp/:workspaceId/sessions/end", "POST", (request) =>
          mcpHandlers.handleSessionEnd(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/commits": {
        POST: withTracing("POST /api/mcp/:workspaceId/commits", "POST", (request) =>
          mcpHandlers.handleLogCommit(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/commits/pre-check": {
        POST: withTracing("POST /api/mcp/:workspaceId/commits/pre-check", "POST", (request) =>
          mcpHandlers.handlePreCheck(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/commits/post-check": {
        POST: withTracing("POST /api/mcp/:workspaceId/commits/post-check", "POST", (request) =>
          mcpHandlers.handlePostCheck(request.params.workspaceId, request),
        ),
      },
      // MCP — Intent tools
      "/api/mcp/:workspaceId/intents/create": {
        POST: withTracing("POST /api/mcp/:workspaceId/intents/create", "POST", (request) =>
          mcpHandlers.handleCreateIntent(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/intents/submit": {
        POST: withTracing("POST /api/mcp/:workspaceId/intents/submit", "POST", (request) =>
          mcpHandlers.handleSubmitIntent(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/intents/status": {
        POST: withTracing("POST /api/mcp/:workspaceId/intents/status", "POST", (request) =>
          mcpHandlers.handleGetIntentStatus(request.params.workspaceId, request),
        ),
      },
      // Agent MCP — intent-gated tool access for sandbox agents
      "/mcp/agent/:sessionId": {
        POST: withTracing("POST /mcp/agent/:sessionId", "POST", (request) =>
          agentMcpHandler(request.params.sessionId, request),
        ),
      },
      // Observer — periodic graph scan
      "/api/observe/scan/:workspaceId": {
        POST: withTracing("POST /api/observe/scan/:workspaceId", "POST", (request) =>
          graphScanHandler(request.params.workspaceId, request),
        ),
      },
      // Observer — verification pipeline (called by SurrealQL EVENT via http::post)
      "/api/observe/:table/:id": {
        POST: withTracing("POST /api/observe/:table/:id", "POST", (request) =>
          observerHandler(request.params.table, request.params.id, request),
        ),
      },
      // Agent Activator — starts new agents from observation events (called by SurrealQL EVENT via http::post)
      "/api/internal/activator/observation": {
        POST: withTracing("POST /api/internal/activator/observation", "POST", (request) =>
          activatorHandler(request),
        ),
      },
      // Intent — evaluate (called by SurrealQL EVENT via http::post)
      "/api/intents/:intentId/evaluate": {
        POST: withTracing("POST /api/intents/:intentId/evaluate", "POST", (request) =>
          intentHandlers.handleEvaluate(request.params.intentId, request),
        ),
      },
      // Intent — approve (workspace-less shortcut for out-of-band human approval)
      "/api/intents/:intentId/approve": {
        POST: withTracing("POST /api/intents/:intentId/approve", "POST", (request) =>
          intentHandlers.handleApprove("_direct", request.params.intentId),
        ),
      },
      // Intent — veto (workspace-less shortcut for out-of-band human veto)
      "/api/intents/:intentId/veto": {
        POST: withTracing("POST /api/intents/:intentId/veto", "POST", (request) =>
          intentHandlers.handleVeto("_direct", request.params.intentId, request),
        ),
      },
      // Intent — consent display
      "/api/workspaces/:workspaceId/intents/:intentId/consent": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/intents/:intentId/consent",
          "GET",
          (request) =>
            intentHandlers.handleConsent(request.params.workspaceId, request.params.intentId),
        ),
      },
      // Intent — approve from consent
      "/api/workspaces/:workspaceId/intents/:intentId/approve": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/intents/:intentId/approve",
          "POST",
          (request) =>
            intentHandlers.handleApprove(request.params.workspaceId, request.params.intentId),
        ),
      },
      // Intent — constrain from consent
      "/api/workspaces/:workspaceId/intents/:intentId/constrain": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/intents/:intentId/constrain",
          "POST",
          (request) =>
            intentHandlers.handleConstrain(request.params.workspaceId, request.params.intentId, request),
        ),
      },
      // Intent — veto
      "/api/workspaces/:workspaceId/intents/:intentId/veto": {
        POST: withTracing(
          "POST /api/workspaces/:workspaceId/intents/:intentId/veto",
          "POST",
          (request) =>
            intentHandlers.handleVeto(request.params.workspaceId, request.params.intentId, request),
        ),
      },
      // Intent — list pending for governance feed
      "/api/workspaces/:workspaceId/intents/pending": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/intents/pending",
          "GET",
          (request) => intentHandlers.handleListPending(request.params.workspaceId),
        ),
      },
      // Identity discovery — returns owner identity for CLI DPoP token acquisition
      "/api/auth/identity/:workspaceId": {
        GET: withTracing("GET /api/auth/identity/:workspaceId", "GET", async (request) => {
          const wsId = request.params.workspaceId;
          const rows = await deps.surreal.query<[Array<{ identityId: string }>]>(
            `SELECT meta::id(id) AS identityId FROM identity WHERE workspace = $ws AND type = "owner" LIMIT 1;`,
            { ws: new RecordId("workspace", wsId) },
          );
          const row = rows[0]?.[0];
          if (!row) return jsonResponse({ error: "workspace_not_found" }, 404);
          return jsonResponse({ identity_id: row.identityId }, 200);
        }),
      },
      // OAuth 2.1 RAR+DPoP — Intent submission with DPoP thumbprint binding
      "/api/auth/intents": {
        POST: withTracing("POST /api/auth/intents", "POST", (request) =>
          intentSubmissionHandler(request),
        ),
      },
      // OAuth 2.1 RAR+DPoP — Token endpoint
      "/api/auth/token": {
        POST: withTracing("POST /api/auth/token", "POST", (request) =>
          tokenEndpointHandler(request),
        ),
      },
      // OAuth 2.1 RAR+DPoP — Bridge session-to-token exchange
      "/api/auth/bridge/exchange": {
        POST: withTracing("POST /api/auth/bridge/exchange", "POST", (request) =>
          bridgeExchangeHandler(request),
        ),
      },
      // AS JWKS endpoint — public keys for token verification
      "/api/auth/osabio/.well-known/jwks": {
        GET: withTracing("GET /api/auth/osabio/.well-known/jwks", "GET", async () =>
          jsonResponse(buildJwksResponse(deps.asSigningKey), 200),
        ),
      },
      // OAuth 2.1 discovery — proxy root-level .well-known to better-auth handler
      "/.well-known/oauth-authorization-server/*": {
        GET: async (request) => deps.auth.handler(request),
      },
      "/.well-known/oauth-protected-resource": {
        GET: () => jsonResponse({
          resource: config.betterAuthUrl,
          authorization_servers: [config.betterAuthUrl],
          scopes_supported: Object.keys(OSABIO_SCOPES),
          bearer_methods_supported: ["header"],
        }, 200),
      },
      "/api/auth/oauth-client/:clientId": {
        GET: withTracing(
          "GET /api/auth/oauth-client/:clientId",
          "GET",
          createClientInfoHandler(deps.surreal),
        ),
      },
      // LLM Proxy — Audit provenance chain
      "/api/workspaces/:workspaceId/proxy/traces/:traceId": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/proxy/traces/:traceId",
          "GET",
          (request) => auditApiHandlers.handleTraceDetail(
            request.params.workspaceId,
            request.params.traceId,
          ),
        ),
      },
      "/api/workspaces/:workspaceId/proxy/traces": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/proxy/traces",
          "GET",
          (request) => auditApiHandlers.handleTracesByProject(
            request.params.workspaceId,
            new URL(request.url),
          ),
        ),
      },
      "/api/workspaces/:workspaceId/proxy/compliance": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/proxy/compliance",
          "GET",
          (request) => auditApiHandlers.handleCompliance(
            request.params.workspaceId,
            new URL(request.url),
          ),
        ),
      },
      // LLM Proxy — Spend monitoring dashboard
      "/api/workspaces/:workspaceId/proxy/spend": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/proxy/spend",
          "GET",
          (request) => spendApiHandlers.handleSpend(request.params.workspaceId),
        ),
      },
      "/api/workspaces/:workspaceId/proxy/sessions": {
        GET: withTracing(
          "GET /api/workspaces/:workspaceId/proxy/sessions",
          "GET",
          (request) => spendApiHandlers.handleSessions(request.params.workspaceId),
        ),
      },
      // Anthropic LLM Proxy — transparent passthrough with logging
      "/proxy/llm/anthropic/v1/messages": {
        POST: withTracing("POST /proxy/llm/anthropic/v1/messages", "POST", anthropicProxyHandler),
      },
      "/proxy/llm/anthropic/v1/messages/count_tokens": {
        POST: withTracing("POST /proxy/llm/anthropic/v1/messages/count_tokens", "POST", anthropicProxyHandler),
      },
      // Proxy token issuance — CLI osabio init Step 7
      "/api/auth/proxy-token": {
        POST: withTracing("POST /api/auth/proxy-token", "POST", proxyTokenHandler),
      },
      "/api/auth/*": async (request) => deps.auth.handler(request),
      "/": appHtml,
      "/*": appHtml,
    },
  });
}

function detectTransport(url: string): string {
  if (url.startsWith("wss://")) return "wss";
  if (url.startsWith("ws://")) return "ws";
  if (url.startsWith("https://")) return "https";
  return "http";
}

export async function startServer(): Promise<void> {
  const telemetry = initTelemetry();
  log.info("telemetry.init", "OpenTelemetry SDK initialized", { exporterType: telemetry.exporterType });

  const config = loadServerConfig();
  const runtime = await createRuntimeDependencies(config);
  await ensureDefaultWorkspaceProjectScope(runtime.surreal);

  const deps: ServerDependencies = {
    config,
    surreal: runtime.surreal,
    analyticsSurreal: runtime.analyticsSurreal,
    auth: runtime.auth,
    chatAgentModel: runtime.chatAgentModel,
    extractionModel: runtime.extractionModel,
    pmAgentModel: runtime.pmAgentModel,
    analyticsAgentModel: runtime.analyticsAgentModel,
    observerModel: runtime.observerModel,
    scorerModel: runtime.scorerModel,
    sse: createSseRegistry(),
    inflight: createInflightTracker(),
    asSigningKey: runtime.asSigningKey,
    nonceCache: createNonceCache(),
    mcpClientFactory: runtime.mcpClientFactory,
    sandboxAgentAdapter: runtime.sandboxAgentAdapter,
  };

  const server = createBrainServer(deps);

  // Start reactive coordination layer: LIVE SELECT -> Feed SSE Bridge -> SSE Registry
  const liveSelectManager = createLiveSelectManager({ surreal: runtime.surreal });
  const feedSseBridge = createFeedSseBridge({
    liveSelectManager,
    sseRegistry: deps.sse,
  });
  feedSseBridge.subscribeAll();

  deps.inflight.track(
    liveSelectManager.start().catch((err) => {
      log.error("reactive.start", "Failed to start Live Select Manager", err);
    }),
  );

  // Recover intents stuck in pending_veto with expired windows (fire-and-forget)
  const vetoManager = createVetoManager();
  deps.inflight.track(
    vetoManager.recoverExpiredWindows({
      updateStatus: (intentId, status) => updateIntentStatus(deps.surreal, intentId, status),
      emitVetoEvent: (event) => log.info("intent.veto.recovery", "Recovered expired veto window", { event }),
      queryExpiredVetoIntents: () => queryExpiredVetoIntents(deps.surreal),
    }).catch((err) => {
      log.error("intent.veto.recovery", "Failed to recover expired veto windows", err);
    }),
  );

  // Graceful shutdown: flush telemetry on SIGTERM/SIGINT
  const handleShutdownSignal = async (signal: string) => {
    log.info("server.shutdown", `Received ${signal}, draining telemetry...`);
    await telemetry.shutdown();
    process.exit(0);
  };
  process.on("SIGTERM", () => handleShutdownSignal("SIGTERM"));
  process.on("SIGINT", () => handleShutdownSignal("SIGINT"));

  log.info("server.started", "Brain app server started", {
    port: server.port,
    host: "127.0.0.1",
    chatAgentModelId: config.chatAgentModelId,
    extractionModelId: config.extractionModelId,
    pmAgentModelId: config.pmAgentModelId,
    extractionStoreThreshold: config.extractionStoreThreshold,
    extractionDisplayThreshold: config.extractionDisplayThreshold,
    surrealTransport: detectTransport(config.surrealUrl),
    surrealNamespace: config.surrealNamespace,
    surrealDatabase: config.surrealDatabase,
    openRouterReasoningEnabled: config.openRouterReasoning !== undefined,
  });
}

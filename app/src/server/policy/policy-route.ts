import { RecordId } from "surrealdb";
import { HttpError } from "../http/errors";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import { activatePolicy, buildVersionChain, createPolicy, deprecatePolicy, getPolicyById, getPolicyEdges, getVersionChain, listWorkspacePolicies } from "./policy-queries";
import { validatePolicyCreateBody } from "./policy-validation";
import { compileRego, createEngineCache, evaluateRegoPolicy } from "./rego-evaluator";
import type { IntentEvaluationContext, PolicyRecord, PolicySelector, PolicyStatus } from "./types";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Pure identity guard
// ---------------------------------------------------------------------------

/** Agents are denied mutation access to policies. */
const isAgentIdentity = (identityType: string): boolean =>
  identityType === "agent";

// ---------------------------------------------------------------------------
// Identity resolution (session -> person -> identity)
// ---------------------------------------------------------------------------

type IdentityInfo = {
  identityRecord: RecordId<"identity", string>;
  identityType: string;
};

async function resolveIdentityFromSession(
  deps: ServerDependencies,
  request: Request,
): Promise<IdentityInfo | Response> {
  const session = await deps.auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return jsonError("authentication required", 401);
  }

  const personRecord = new RecordId("person", session.user.id);

  const [identityRows] = await deps.surreal.query<[RecordId<"identity", string>[]]>(
    "SELECT VALUE in FROM identity_person WHERE out = $person LIMIT 1;",
    { person: personRecord },
  );
  const identityRecord = identityRows[0] as RecordId<"identity", string> | undefined;
  if (!identityRecord) {
    return jsonError("identity not found for user", 500);
  }

  const [typeRows] = await deps.surreal.query<[Array<{ type: string }>]>(
    "SELECT type FROM $identity;",
    { identity: identityRecord },
  );
  const identityType = typeRows[0]?.type;
  if (!identityType) {
    return jsonError("identity type not found", 500);
  }

  return { identityRecord, identityType };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

async function resolveWorkspace(
  deps: ServerDependencies,
  workspaceId: string,
  logEvent: string,
): Promise<RecordId<"workspace", string> | Response> {
  try {
    return await resolveWorkspaceRecord(deps.surreal, workspaceId);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.message, error.status);
    }
    log.error(logEvent, "Failed to resolve workspace", error, { workspaceId });
    return jsonError("failed to resolve workspace", 500);
  }
}

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

export function createPolicyRouteHandlers(deps: ServerDependencies) {
  return {
    handleList: (workspaceId: string, request: Request) =>
      handleListPolicies(deps, workspaceId, request),
    handleDetail: (workspaceId: string, policyId: string, request: Request) =>
      handlePolicyDetail(deps, workspaceId, policyId, request),
    handleCreate: (workspaceId: string, request: Request) =>
      handleCreatePolicy(deps, workspaceId, request),
    handleActivate: (workspaceId: string, policyId: string, request: Request) =>
      handleActivatePolicy(deps, workspaceId, policyId, request),
    handleDeprecate: (workspaceId: string, policyId: string, request: Request) =>
      handleDeprecatePolicy(deps, workspaceId, policyId, request),
    handleCreateVersion: (workspaceId: string, policyId: string, request: Request) =>
      handleCreatePolicyVersion(deps, workspaceId, policyId, request),
    handleVersionHistory: (workspaceId: string, policyId: string, request: Request) =>
      handleGetVersionHistory(deps, workspaceId, policyId, request),
    handleValidate: (workspaceId: string, request: Request) =>
      handleValidateRego(deps, workspaceId, request),
    handleTest: (workspaceId: string, policyId: string, request: Request) =>
      handleTestPolicy(deps, workspaceId, policyId, request),
  };
}

// ---------------------------------------------------------------------------
// Mutation guard: resolves identity and rejects agents
// ---------------------------------------------------------------------------

async function requireHumanIdentity(
  deps: ServerDependencies,
  request: Request,
): Promise<IdentityInfo | Response> {
  const identityOrError = await resolveIdentityFromSession(deps, request);
  if (isResponse(identityOrError)) return identityOrError;

  if (isAgentIdentity(identityOrError.identityType)) {
    return jsonError("agents cannot modify policies", 403);
  }

  return identityOrError;
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/policies
// ---------------------------------------------------------------------------

async function handleListPolicies(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  const identityOrError = await resolveIdentityFromSession(deps, request);
  if (isResponse(identityOrError)) return identityOrError;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "policy.list.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;
  const workspaceRecord = workspaceOrError;

  try {
    const url = new URL(request.url);
    const VALID_STATUSES: ReadonlySet<string> = new Set(["draft", "testing", "active", "deprecated", "superseded"]);
    const rawStatus = url.searchParams.get("status");
    const statusFilter = rawStatus && VALID_STATUSES.has(rawStatus)
      ? (rawStatus as PolicyStatus)
      : undefined;

    const policies = await listWorkspacePolicies(
      deps.surreal,
      workspaceRecord,
      statusFilter || undefined,
    );

    return jsonResponse({ policies }, 200);
  } catch (error) {
    log.error("policy.list.failed", "Failed to list policies", error, { workspaceId });
    return jsonError("failed to list policies", 500);
  }
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/policies/:policyId
// ---------------------------------------------------------------------------

async function handlePolicyDetail(
  deps: ServerDependencies,
  workspaceId: string,
  policyId: string,
  request: Request,
): Promise<Response> {
  const identityOrError = await resolveIdentityFromSession(deps, request);
  if (isResponse(identityOrError)) return identityOrError;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "policy.detail.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;
  const workspaceRecord = workspaceOrError;

  try {
    const policy = await getPolicyById(deps.surreal, policyId, workspaceRecord);
    if (!policy) {
      return jsonError("policy not found", 404);
    }

    const edges = await getPolicyEdges(deps.surreal, policyId);
    const versionChain = await buildVersionChain(deps.surreal, policy);

    return jsonResponse({
      policy: {
        id: policy.id.id as string,
        title: policy.title,
        description: policy.description,
        version: policy.version,
        status: policy.status,
        selector: policy.selector ?? {},
        rego_source: policy.rego_source ?? "",
        human_veto_required: policy.human_veto_required ?? false,
        ...(policy.max_ttl ? { max_ttl: policy.max_ttl } : {}),
        ...(policy.supersedes ? { supersedes: policy.supersedes.id as string } : {}),
        created_at: policy.created_at instanceof Date ? policy.created_at.toISOString() : String(policy.created_at),
        ...(policy.updated_at ? {
          updated_at: policy.updated_at instanceof Date ? policy.updated_at.toISOString() : String(policy.updated_at),
        } : {}),
      },
      edges,
      version_chain: versionChain,
    }, 200);
  } catch (error) {
    log.error("policy.detail.failed", "Failed to get policy detail", error, { workspaceId, policyId });
    return jsonError("failed to get policy detail", 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/policies (stub - guarded)
// ---------------------------------------------------------------------------

async function handleCreatePolicy(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  const guardResult = await requireHumanIdentity(deps, request);
  if (isResponse(guardResult)) return guardResult;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "policy.create.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;
  const workspaceRecord = workspaceOrError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const validation = await validatePolicyCreateBody(body as { title: unknown; description: unknown; rego_source: unknown });
  if (!validation.valid) {
    if (validation.compileErrors && validation.compileErrors.length > 0) {
      return jsonResponse({ error: validation.errors[0], errors: validation.compileErrors }, 400);
    }
    return jsonError(validation.errors[0], 400);
  }

  const parsed = body as Record<string, unknown>;

  try {
    const { policyId } = await createPolicy(deps.surreal, {
      title: parsed.title as string,
      description: parsed.description as string,
      selector: parsed.selector as PolicySelector | undefined,
      rego_source: parsed.rego_source as string,
      human_veto_required: parsed.human_veto_required as boolean | undefined,
      max_ttl: parsed.max_ttl as string | undefined,
      createdBy: guardResult.identityRecord,
      workspace: workspaceRecord,
    });

    return jsonResponse({ policy_id: policyId }, 201);
  } catch (error) {
    log.error("policy.create.failed", "Failed to create policy", error, { workspaceId });
    return jsonError("failed to create policy", 500);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/workspaces/:workspaceId/policies/:policyId/activate (stub - guarded)
// ---------------------------------------------------------------------------

/** Statuses from which activation is allowed. */
const ACTIVATABLE_STATUSES: ReadonlySet<PolicyStatus> = new Set<PolicyStatus>(["draft", "testing"]);

async function handleActivatePolicy(
  deps: ServerDependencies,
  workspaceId: string,
  policyId: string,
  request: Request,
): Promise<Response> {
  const guardResult = await requireHumanIdentity(deps, request);
  if (isResponse(guardResult)) return guardResult;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "policy.activate.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;
  const workspaceRecord = workspaceOrError;

  try {
    const policyRecord = new RecordId("policy", policyId);
    const policy = await deps.surreal.select<PolicyRecord>(policyRecord);

    if (!policy || (policy.workspace.id as string) !== (workspaceRecord.id as string)) {
      return jsonError("policy not found", 404);
    }

    if (!ACTIVATABLE_STATUSES.has(policy.status)) {
      return jsonError(
        `policy must be in draft or testing status to activate (current: ${policy.status})`,
        409,
      );
    }

    await activatePolicy(
      deps.surreal,
      policy,
      guardResult.identityRecord,
      workspaceRecord,
    );

    return jsonResponse({ status: "active" }, 200);
  } catch (error) {
    log.error("policy.activate.failed", "Failed to activate policy", error, { workspaceId, policyId });
    return jsonError("failed to activate policy", 500);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/workspaces/:workspaceId/policies/:policyId/deprecate (stub - guarded)
// ---------------------------------------------------------------------------

/** Only active policies can be deprecated. */
const DEPRECATABLE_STATUSES: ReadonlySet<PolicyStatus> = new Set<PolicyStatus>(["active"]);

async function handleDeprecatePolicy(
  deps: ServerDependencies,
  workspaceId: string,
  policyId: string,
  request: Request,
): Promise<Response> {
  const guardResult = await requireHumanIdentity(deps, request);
  if (isResponse(guardResult)) return guardResult;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "policy.deprecate.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;
  const workspaceRecord = workspaceOrError;

  try {
    const policyRecord = new RecordId("policy", policyId);
    const policy = await deps.surreal.select<PolicyRecord>(policyRecord);

    if (!policy || (policy.workspace.id as string) !== (workspaceRecord.id as string)) {
      return jsonError("policy not found", 404);
    }

    if (!DEPRECATABLE_STATUSES.has(policy.status)) {
      return jsonError(
        `policy must be in active status to deprecate (current: ${policy.status})`,
        409,
      );
    }

    await deprecatePolicy(deps.surreal, policyId);

    return jsonResponse({ status: "deprecated" }, 200);
  } catch (error) {
    log.error("policy.deprecate.failed", "Failed to deprecate policy", error, { workspaceId, policyId });
    return jsonError("failed to deprecate policy", 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/policies/:policyId/versions (stub - guarded)
// ---------------------------------------------------------------------------

/** Only active policies can spawn new versions. */
const VERSIONABLE_STATUSES: ReadonlySet<PolicyStatus> = new Set<PolicyStatus>(["active"]);

async function handleCreatePolicyVersion(
  deps: ServerDependencies,
  workspaceId: string,
  policyId: string,
  request: Request,
): Promise<Response> {
  const guardResult = await requireHumanIdentity(deps, request);
  if (isResponse(guardResult)) return guardResult;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "policy.version.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;
  const workspaceRecord = workspaceOrError;

  try {
    const sourcePolicy = await getPolicyById(deps.surreal, policyId, workspaceRecord);
    if (!sourcePolicy) {
      return jsonError("policy not found", 404);
    }

    if (!VERSIONABLE_STATUSES.has(sourcePolicy.status)) {
      return jsonError(
        `policy must be in active status to create a new version (current: ${sourcePolicy.status})`,
        409,
      );
    }

    // Parse optional overrides from request body — callers can customise the
    // new draft instead of getting an exact copy of the source policy.
    let overrides: Partial<{
      title: string;
      description: string;
      selector: PolicySelector;
      rego_source: string;
      human_veto_required: boolean;
      max_ttl: string;
    }> = {};
    try {
      const raw = await request.json();
      if (raw && typeof raw === "object") overrides = raw as typeof overrides;
    } catch {
      // No body or invalid JSON — use source values only.
    }

    // When overrides include rego_source, validate through the same path as create.
    if (overrides.rego_source !== undefined) {
      const validation = await validatePolicyCreateBody({
        title: overrides.title ?? sourcePolicy.title,
        description: overrides.description ?? sourcePolicy.description ?? "",
        rego_source: overrides.rego_source,
      });
      if (!validation.valid) {
        if (validation.compileErrors && validation.compileErrors.length > 0) {
          return jsonResponse({ error: validation.errors[0], errors: validation.compileErrors }, 400);
        }
        return jsonError(validation.errors[0], 400);
      }
    }

    const sourcePolicyRecord = new RecordId("policy", policyId);
    const { policyId: newPolicyId, version } = await createPolicy(deps.surreal, {
      title: overrides.title ?? sourcePolicy.title,
      description: overrides.description ?? sourcePolicy.description,
      selector: overrides.selector ?? sourcePolicy.selector,
      rego_source: overrides.rego_source ?? sourcePolicy.rego_source,
      human_veto_required: overrides.human_veto_required ?? sourcePolicy.human_veto_required,
      max_ttl: overrides.max_ttl ?? sourcePolicy.max_ttl,
      createdBy: guardResult.identityRecord,
      workspace: workspaceRecord,
      supersedes: sourcePolicyRecord,
    });

    return jsonResponse({ policy_id: newPolicyId, version }, 201);
  } catch (error) {
    log.error("policy.version.failed", "Failed to create policy version", error, { workspaceId, policyId });
    return jsonError("failed to create policy version", 500);
  }
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/policies/:policyId/versions
// ---------------------------------------------------------------------------

async function handleGetVersionHistory(
  deps: ServerDependencies,
  workspaceId: string,
  policyId: string,
  request: Request,
): Promise<Response> {
  const identityOrError = await resolveIdentityFromSession(deps, request);
  if (isResponse(identityOrError)) return identityOrError;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "policy.versions.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;
  const workspaceRecord = workspaceOrError;

  try {
    const versions = await getVersionChain(deps.surreal, policyId, workspaceRecord);
    if (!versions) {
      return jsonError("policy not found", 404);
    }

    return jsonResponse({ versions }, 200);
  } catch (error) {
    log.error("policy.versions.failed", "Failed to get version history", error, { workspaceId, policyId });
    return jsonError("failed to get version history", 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/policies/validate
// ---------------------------------------------------------------------------

async function handleValidateRego(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  const identityOrError = await resolveIdentityFromSession(deps, request);
  if (isResponse(identityOrError)) return identityOrError;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "policy.validate.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const parsed = body as Record<string, unknown>;
  if (!parsed.rego_source || typeof parsed.rego_source !== "string") {
    return jsonError("rego_source is required", 400);
  }

  try {
    const result = await compileRego(parsed.rego_source);
    return jsonResponse(result, 200);
  } catch (error) {
    log.error("policy.validate.failed", "Failed to validate Rego source", error, { workspaceId });
    return jsonError("failed to validate Rego source", 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/policies/:policyId/test
// ---------------------------------------------------------------------------

async function handleTestPolicy(
  deps: ServerDependencies,
  workspaceId: string,
  policyId: string,
  request: Request,
): Promise<Response> {
  const identityOrError = await resolveIdentityFromSession(deps, request);
  if (isResponse(identityOrError)) return identityOrError;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "policy.test.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;
  const workspaceRecord = workspaceOrError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const parsed = body as Record<string, unknown>;
  if (!parsed.action_spec || typeof parsed.action_spec !== "object") {
    return jsonError("action_spec is required", 400);
  }

  const policy = await getPolicyById(deps.surreal, policyId, workspaceRecord);
  if (!policy) {
    return jsonError("policy not found", 404);
  }

  try {
    const cache = createEngineCache();
    const result = await evaluateRegoPolicy(
      policy.rego_source,
      policyId,
      policy.version,
      parsed as unknown as IntentEvaluationContext,
      cache,
    );
    return jsonResponse(result, 200);
  } catch (error) {
    log.error("policy.test.failed", "Failed to test policy", error, { workspaceId, policyId });
    return jsonError("failed to test policy", 500);
  }
}

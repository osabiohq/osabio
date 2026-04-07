import { RecordId, type Surreal } from "surrealdb";

// Re-export everything from intent-test-kit (which re-exports orchestrator-test-kit)
export {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  createTestProject,
  getTestUserBearerToken,
  fetchJson,
  fetchRaw,
  createDraftIntent,
  submitIntent,
  getIntentStatus,
  getIntentRecord,
  getIntentEvaluation,
  waitForIntentStatus,
  simulateEvaluation,
  createTestIdentity,
  listPendingIntents,
  wireIntentEvaluationEvent,
  type OrchestratorTestRuntime,
  type TestUser,
  type TestUserWithToken,
  type TestWorkspace,
  type TestTask,
  type TestProject,
  type IntentStatus,
  type IntentRecord,
  type EvaluationResult,
  type ActionSpec,
  type BudgetLimit,
  type CreateIntentOptions,
} from "../intent-node/intent-test-kit";

// ---------------------------------------------------------------------------
// Policy-Specific Types
// ---------------------------------------------------------------------------

export type PolicySelector = {
  workspace?: string;
  agent_role?: string;
  resource?: string;
};

export type PolicyStatus = "draft" | "testing" | "active" | "deprecated" | "superseded";

export type PolicyRecord = {
  id: RecordId<"policy">;
  title: string;
  description?: string;
  version: number;
  status: PolicyStatus;
  selector: PolicySelector;
  rego_source: string;
  human_veto_required: boolean;
  max_ttl?: string;
  created_by: RecordId<"identity">;
  workspace: RecordId<"workspace">;
  supersedes?: RecordId<"policy">;
  created_at: string;
  updated_at?: string;
};

export type PolicyTraceEntry = {
  policy_id: string;
  policy_version: number;
  /** For Rego policies: contains policy ID. Field name kept for trace format compatibility. */
  rule_id: string;
  effect: "allow" | "deny";
  matched: boolean;
  priority: number;
};

export type CreatePolicyOptions = {
  title: string;
  description?: string;
  status?: PolicyStatus;
  selector?: PolicySelector;
  rego_source: string;
  human_veto_required?: boolean;
  max_ttl?: string;
};

// ---------------------------------------------------------------------------
// Domain Helpers -- Business Language Layer
// ---------------------------------------------------------------------------

export async function createPolicy(
  surreal: Surreal,
  workspaceId: string,
  createdById: string,
  opts: CreatePolicyOptions,
): Promise<{ policyId: string; policyRecord: RecordId<"policy"> }> {
  const policyId = `policy-${crypto.randomUUID()}`;
  const policyRecord = new RecordId("policy", policyId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const createdByRecord = new RecordId("identity", createdById);

  const content: Record<string, unknown> = {
    title: opts.title,
    version: 1,
    status: opts.status ?? "draft",
    selector: opts.selector ?? {},
    rego_source: opts.rego_source,
    human_veto_required: opts.human_veto_required ?? false,
    created_by: createdByRecord,
    workspace: workspaceRecord,
    created_at: new Date(),
  };

  if (opts.description) content.description = opts.description;
  if (opts.max_ttl) content.max_ttl = opts.max_ttl;

  await surreal.query(`CREATE $policy CONTENT $content;`, {
    policy: policyRecord,
    content,
  });

  return { policyId, policyRecord };
}

export async function activatePolicy(
  surreal: Surreal,
  policyId: string,
  creatorId: string,
  workspaceId: string,
): Promise<void> {
  const policyRecord = new RecordId("policy", policyId);
  const creatorRecord = new RecordId("identity", creatorId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`
    BEGIN TRANSACTION;
      UPDATE $policy SET status = 'active', updated_at = time::now();
      RELATE $creator->governing->$policy SET created_at = time::now();
      RELATE $policy->protects->$workspace SET created_at = time::now();
    COMMIT TRANSACTION;
  `, {
    policy: policyRecord,
    creator: creatorRecord,
    workspace: workspaceRecord,
  });
}

export async function deprecatePolicy(
  surreal: Surreal,
  policyId: string,
): Promise<void> {
  const policyRecord = new RecordId("policy", policyId);

  await surreal.query(`
    BEGIN TRANSACTION;
      UPDATE $policy SET status = 'deprecated', updated_at = time::now();
      DELETE governing WHERE out = $policy;
      DELETE protects WHERE in = $policy;
    COMMIT TRANSACTION;
  `, { policy: policyRecord });
}

export async function getPolicyRecord(
  surreal: Surreal,
  policyId: string,
): Promise<PolicyRecord> {
  const policyRecord = new RecordId("policy", policyId);
  const rows = (await surreal.query(`SELECT * FROM $policy;`, {
    policy: policyRecord,
  })) as Array<Array<PolicyRecord>>;
  const result = rows[0]?.[0];
  if (!result) throw new Error(`Policy ${policyId} not found`);
  return result;
}

export async function loadActivePoliciesForIdentity(
  surreal: Surreal,
  identityId: string,
  workspaceId: string,
): Promise<PolicyRecord[]> {
  const identityRecord = new RecordId("identity", identityId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  // Identity-linked policies
  const identityPolicies = (await surreal.query(
    `SELECT ->governing->policy.* AS policies FROM $identity;`,
    { identity: identityRecord },
  )) as Array<Array<{ policies: PolicyRecord[] }>>;

  // Workspace-linked policies
  const workspacePolicies = (await surreal.query(
    `SELECT <-protects<-policy.* AS policies FROM $workspace;`,
    { workspace: workspaceRecord },
  )) as Array<Array<{ policies: PolicyRecord[] }>>;

  const idPolicies = identityPolicies[0]?.[0]?.policies ?? [];
  const wsPolicies = workspacePolicies[0]?.[0]?.policies ?? [];

  // Deduplicate by policy ID and filter active only
  const seen = new Set<string>();
  const all: PolicyRecord[] = [];
  for (const p of [...idPolicies, ...wsPolicies]) {
    const id = p.id.id as string;
    if (!seen.has(id) && p.status === "active") {
      seen.add(id);
      all.push(p);
    }
  }
  return all;
}

export async function simulatePolicyGateResult(
  surreal: Surreal,
  intentId: string,
  result: {
    decision: "APPROVE" | "REJECT";
    risk_score: number;
    reason: string;
    policy_only: boolean;
    policy_trace: PolicyTraceEntry[];
    human_veto_required?: boolean;
  },
  resultStatus: "authorized" | "pending_veto" | "vetoed",
): Promise<void> {
  const intentRecord = new RecordId("intent", intentId);
  const evalContent: Record<string, unknown> = {
    decision: result.decision,
    risk_score: result.risk_score,
    reason: result.reason,
    evaluated_at: new Date(),
    policy_only: result.policy_only,
    policy_trace: result.policy_trace,
  };
  if (result.human_veto_required !== undefined) {
    evalContent.human_veto_required = result.human_veto_required;
  }

  const updates: Record<string, unknown> = {
    status: resultStatus,
    evaluation: evalContent,
    updated_at: new Date(),
  };

  if (resultStatus === "pending_veto") {
    updates.veto_expires_at = new Date(Date.now() + 5 * 60 * 1000);
  }

  await surreal.query(`UPDATE $intent MERGE $updates;`, {
    intent: intentRecord,
    updates,
  });
}

export async function getAuditEventsForPolicy(
  surreal: Surreal,
  policyId: string,
): Promise<Array<{ event_type: string; payload: Record<string, unknown> }>> {
  const rows = (await surreal.query(
    `SELECT event_type, payload, created_at FROM audit_event
     WHERE payload.policy_id = $policyId
     ORDER BY created_at ASC;`,
    { policyId },
  )) as Array<Array<{ event_type: string; payload: Record<string, unknown> }>>;
  return rows[0] ?? [];
}

export async function createPolicyAuditEvent(
  surreal: Surreal,
  eventType: string,
  actorId: string,
  workspaceId: string,
  policyId: string,
  policyVersion: number,
): Promise<void> {
  const auditId = `audit-${crypto.randomUUID()}`;
  const auditRecord = new RecordId("audit_event", auditId);
  const actorRecord = new RecordId("identity", actorId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $audit CONTENT $content;`, {
    audit: auditRecord,
    content: {
      event_type: eventType,
      actor: actorRecord,
      workspace: workspaceRecord,
      payload: {
        policy_id: policyId,
        policy_version: policyVersion,
      },
      severity: "info",
      created_at: new Date(),
    },
  });
}

export async function createPolicyVersion(
  surreal: Surreal,
  oldPolicyId: string,
  workspaceId: string,
  createdById: string,
  newRegoSource: string,
): Promise<{ policyId: string }> {
  const oldPolicy = await getPolicyRecord(surreal, oldPolicyId);
  const newPolicyId = `policy-${crypto.randomUUID()}`;
  const newPolicyRecord = new RecordId("policy", newPolicyId);
  const oldPolicyRecord = new RecordId("policy", oldPolicyId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const createdByRecord = new RecordId("identity", createdById);

  await surreal.query(`
    BEGIN TRANSACTION;
      CREATE $newPolicy CONTENT {
        title: $title,
        version: $newVersion,
        status: 'active',
        selector: $selector,
        rego_source: $regoSource,
        human_veto_required: $vetoRequired,
        created_by: $createdBy,
        workspace: $workspace,
        supersedes: $oldPolicy,
        created_at: time::now()
      };
      UPDATE $oldPolicy SET status = 'superseded', updated_at = time::now();
    COMMIT TRANSACTION;
  `, {
    newPolicy: newPolicyRecord,
    oldPolicy: oldPolicyRecord,
    title: oldPolicy.title,
    newVersion: (oldPolicy.version as number) + 1,
    selector: oldPolicy.selector,
    regoSource: newRegoSource,
    vetoRequired: oldPolicy.human_veto_required,
    createdBy: createdByRecord,
    workspace: workspaceRecord,
  });

  return { policyId: newPolicyId };
}

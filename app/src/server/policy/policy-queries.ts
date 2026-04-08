import { RecordId, type Surreal } from "surrealdb";
import type { PolicyRecord, PolicySelector, PolicyStatus } from "./types";

// --- Detail Response Types ---

export type PolicyEdgeInfo = {
  governing: Array<{ identity_id: string; created_at: string }>;
  protects: Array<{ workspace_id: string; created_at: string }>;
};

export type PolicyVersionChainItem = {
  id: string;
  version: number;
  status: string;
  created_at: string;
};

// --- List Response Types ---

export type PolicyListItem = {
  id: string;
  title: string;
  status: string;
  version: number;
  rules_count: number;
  human_veto_required: boolean;
  created_at: string;
  updated_at?: string;
};

// --- Pure Mapping ---

const formatTimestamp = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : String(value);

const toPolicyListItem = (record: PolicyRecord): PolicyListItem => ({
  id: record.id.id as string,
  title: record.title,
  status: record.status,
  version: record.version,
  rules_count: 0,
  human_veto_required: record.human_veto_required ?? false,
  created_at: formatTimestamp(record.created_at),
  ...(record.updated_at ? { updated_at: formatTimestamp(record.updated_at) } : {}),
});

// --- Parameter Types ---

type CreatePolicyParams = {
  title: string;
  description?: string;
  selector?: PolicySelector;
  rego_source: string;
  human_veto_required?: boolean;
  max_ttl?: string;
  createdBy: RecordId<"identity">;
  workspace: RecordId<"workspace">;
  supersedes?: RecordId<"policy">;
};

// --- Query Functions ---

export async function loadActivePolicies(
  surreal: Surreal,
  identityId: RecordId<"identity">,
  workspaceId: RecordId<"workspace">,
): Promise<PolicyRecord[]> {
  const identityResult = await surreal.query<
    [Array<{ policies: PolicyRecord[] }>]
  >(
    `SELECT ->governing->policy.* AS policies FROM $identity;`,
    { identity: identityId },
  );

  const workspaceResult = await surreal.query<
    [Array<{ policies: PolicyRecord[] }>]
  >(
    `SELECT <-protects<-policy.* AS policies FROM $workspace;`,
    { workspace: workspaceId },
  );

  const identityPolicies = identityResult[0]?.[0]?.policies ?? [];
  const workspacePolicies = workspaceResult[0]?.[0]?.policies ?? [];

  // Deduplicate by policy ID and filter active only
  const seen = new Set<string>();
  const result: PolicyRecord[] = [];
  for (const policy of [...identityPolicies, ...workspacePolicies]) {
    const id = policy.id.id as string;
    if (!seen.has(id) && policy.status === "active") {
      seen.add(id);
      result.push(policy);
    }
  }
  return result;
}

export async function listWorkspacePolicies(
  surreal: Surreal,
  workspace: RecordId<"workspace">,
  statusFilter?: PolicyStatus,
): Promise<PolicyListItem[]> {
  const query = statusFilter
    ? "SELECT * FROM policy WHERE workspace = $ws AND status = $status ORDER BY created_at DESC;"
    : "SELECT * FROM policy WHERE workspace = $ws ORDER BY created_at DESC;";

  const params: Record<string, unknown> = { ws: workspace };
  if (statusFilter) params.status = statusFilter;

  const [rows] = await surreal.query<[PolicyRecord[]]>(query, params);

  return (rows ?? []).map(toPolicyListItem);
}

export async function createPolicy(
  surreal: Surreal,
  params: CreatePolicyParams,
): Promise<{ policyId: string; policyRecord: RecordId<"policy">; version: number }> {
  const policyId = `policy-${crypto.randomUUID()}`;
  const policyRecord = new RecordId("policy", policyId);

  if (params.supersedes) {
    // Atomic version assignment inside a transaction to prevent TOCTOU race.
    // Two concurrent requests both reading the same source version would both
    // compute version N+1 and create duplicate drafts. The transaction:
    // 1. Checks no draft already supersedes this policy (rejects duplicates)
    // 2. Computes MAX(version)+1 from the chain atomically
    // 3. Creates the new draft
    const content: Record<string, unknown> = {
      title: params.title,
      description: params.description,
      version: 1, // placeholder — overwritten atomically inside transaction
      status: "draft",
      selector: params.selector ?? {},
      rego_source: params.rego_source,
      human_veto_required: params.human_veto_required ?? false,
      created_by: params.createdBy,
      workspace: params.workspace,
      supersedes: params.supersedes,
      created_at: new Date(),
    };
    if (params.max_ttl) content.max_ttl = params.max_ttl;

    await surreal.query(
      `
      BEGIN TRANSACTION;
        LET $existing = (SELECT VALUE id FROM policy
            WHERE supersedes = $supersedes AND status IN ['draft', 'testing'] LIMIT 1)[0];
        IF $existing != NONE {
          THROW "an in-flight version already exists for this policy";
        };
        LET $maxVer = (SELECT VALUE version FROM policy
            WHERE workspace = $ws AND (id = $supersedes OR supersedes = $supersedes)
            ORDER BY version DESC LIMIT 1)[0] ?? 0;
        CREATE $policy CONTENT $content;
        UPDATE $policy SET version = $maxVer + 1;
      COMMIT TRANSACTION;
      `,
      {
        policy: policyRecord,
        ws: params.workspace,
        supersedes: params.supersedes,
        content,
      },
    );

    // Read back the assigned version after the transaction commits.
    const [versionRows] = await surreal.query<[Array<{ version: number }>]>(
      "SELECT version FROM $policy;",
      { policy: policyRecord },
    );
    const version = versionRows[0]?.version ?? 1;
    return { policyId, policyRecord, version };
  }

  // Non-versioned (first version) — no supersedes, always version 1.
  const content: Record<string, unknown> = {
    title: params.title,
    description: params.description,
    version: 1,
    status: "draft",
    selector: params.selector ?? {},
    rego_source: params.rego_source,
    human_veto_required: params.human_veto_required ?? false,
    created_by: params.createdBy,
    workspace: params.workspace,
    created_at: new Date(),
  };
  if (params.max_ttl) content.max_ttl = params.max_ttl;

  await surreal.query("CREATE $policy CONTENT $content;", {
    policy: policyRecord,
    content,
  });

  return { policyId, policyRecord, version: 1 };
}

export async function activatePolicy(
  surreal: Surreal,
  policy: PolicyRecord,
  creatorId: RecordId<"identity">,
  workspaceId: RecordId<"workspace">,
): Promise<void> {
  const policyRecord = policy.id;
  const supersededRecord = policy.supersedes;

  if (supersededRecord) {
    // D5: Version monotonicity check inside transaction to prevent TOCTOU race.
    // Two concurrent activations of drafts superseding the same policy would both
    // read the old version outside the transaction, both pass, and both commit —
    // violating the single-active-version invariant. Moving the guard into the
    // transaction makes the check-and-update atomic.
    await surreal.query(
      `
      BEGIN TRANSACTION;
        LET $currentStatus = (SELECT VALUE status FROM $policy)[0];
        IF $currentStatus NOT IN ['draft', 'testing'] {
          THROW string::concat("policy must be in draft or testing status to activate (current: ", <string> $currentStatus, ")");
        };
        LET $oldVer = (SELECT VALUE version FROM $oldPolicy)[0];
        IF $oldVer != NONE AND $policyVersion <= $oldVer {
          THROW string::concat("version ", <string> $policyVersion,
            " must be greater than superseded version ", <string> $oldVer);
        };
        UPDATE $policy SET status = 'active', updated_at = time::now();
        RELATE $creator->governing->$policy SET created_at = time::now();
        RELATE $policy->protects->$workspace SET created_at = time::now();
        UPDATE $oldPolicy SET status = 'superseded', updated_at = time::now();
        DELETE governing WHERE out = $oldPolicy;
        DELETE protects WHERE in = $oldPolicy;
      COMMIT TRANSACTION;
    `,
      {
        policy: policyRecord,
        creator: creatorId,
        workspace: workspaceId,
        oldPolicy: supersededRecord,
        policyVersion: policy.version,
      },
    );
  } else {
    await surreal.query(
      `
      BEGIN TRANSACTION;
        LET $currentStatus = (SELECT VALUE status FROM $policy)[0];
        IF $currentStatus NOT IN ['draft', 'testing'] {
          THROW string::concat("policy must be in draft or testing status to activate (current: ", <string> $currentStatus, ")");
        };
        UPDATE $policy SET status = 'active', updated_at = time::now();
        RELATE $creator->governing->$policy SET created_at = time::now();
        RELATE $policy->protects->$workspace SET created_at = time::now();
      COMMIT TRANSACTION;
    `,
      {
        policy: policyRecord,
        creator: creatorId,
        workspace: workspaceId,
      },
    );
  }
}

export async function deprecatePolicy(
  surreal: Surreal,
  policyId: string,
): Promise<void> {
  const policyRecord = new RecordId("policy", policyId);

  await surreal.query(
    `
    BEGIN TRANSACTION;
      LET $currentStatus = (SELECT VALUE status FROM $policy)[0];
      IF $currentStatus NOT IN ['active'] {
        THROW string::concat("policy must be in active status to deprecate (current: ", <string> $currentStatus, ")");
      };
      UPDATE $policy SET status = 'deprecated', updated_at = time::now();
      DELETE governing WHERE out = $policy;
      DELETE protects WHERE in = $policy;
    COMMIT TRANSACTION;
  `,
    { policy: policyRecord },
  );
}

// --- Detail Query Functions ---

export async function getPolicyById(
  surreal: Surreal,
  policyId: string,
  workspace: RecordId<"workspace">,
): Promise<PolicyRecord | undefined> {
  const policyRecord = new RecordId("policy", policyId);
  const policy = await surreal.select<PolicyRecord>(policyRecord);

  if (!policy || (policy.workspace.id as string) !== (workspace.id as string)) {
    return undefined;
  }

  return policy;
}

export async function getPolicyEdges(
  surreal: Surreal,
  policyId: string,
): Promise<PolicyEdgeInfo> {
  const policyRecord = new RecordId("policy", policyId);

  const [governingRows] = await surreal.query<
    [Array<{ in: RecordId<"identity", string>; created_at: Date }>]
  >(
    "SELECT in, created_at FROM governing WHERE out = $policy;",
    { policy: policyRecord },
  );

  const [protectsRows] = await surreal.query<
    [Array<{ out: RecordId<"workspace", string>; created_at: Date }>]
  >(
    "SELECT out, created_at FROM protects WHERE in = $policy;",
    { policy: policyRecord },
  );

  return {
    governing: (governingRows ?? []).map((e) => ({
      identity_id: e.in.id as string,
      created_at: formatTimestamp(e.created_at),
    })),
    protects: (protectsRows ?? []).map((e) => ({
      workspace_id: e.out.id as string,
      created_at: formatTimestamp(e.created_at),
    })),
  };
}

export function buildVersionChainSingle(policy: PolicyRecord): PolicyVersionChainItem[] {
  return [{
    id: policy.id.id as string,
    version: policy.version,
    status: policy.status,
    created_at: formatTimestamp(policy.created_at),
  }];
}

// ---------------------------------------------------------------------------
// Version chain resolution — single-query bulk fetch + in-memory traversal
// ---------------------------------------------------------------------------

/**
 * Fetch all versioned policies in the workspace in one query, then walk the
 * supersedes chain in memory. Replaces N sequential DB round-trips with 1.
 */
async function resolveChainFromPool(
  surreal: Surreal,
  policy: PolicyRecord,
): Promise<PolicyRecord[]> {
  // Single round-trip: fetch all workspace policies that participate in any
  // supersedes relationship (as source or target). The LET subquery collects
  // IDs referenced as supersedes targets so root policies (which lack
  // supersedes themselves) are included in the pool.
  const [, pool] = await surreal.query<[unknown, PolicyRecord[]]>(
    `LET $targets = SELECT VALUE supersedes FROM policy WHERE workspace = $ws AND supersedes != NONE;
     SELECT * FROM policy WHERE workspace = $ws AND (
       supersedes != NONE OR id IN $targets OR id = $id
     ) ORDER BY version ASC;`,
    { ws: policy.workspace, id: policy.id },
  );

  // Build lookup maps for in-memory traversal
  const byId = new Map<string, PolicyRecord>();
  const bySupersedes = new Map<string, PolicyRecord>(); // key = superseded policy id
  for (const p of pool) {
    byId.set(p.id.id as string, p);
    if (p.supersedes) {
      bySupersedes.set(p.supersedes.id as string, p);
    }
  }

  // Ensure the starting policy is in the pool (it may lack supersedes)
  if (!byId.has(policy.id.id as string)) {
    byId.set(policy.id.id as string, policy);
  }

  // Walk backward to root
  const chain: PolicyRecord[] = [];
  const seen = new Set<string>();
  let current: PolicyRecord | undefined = policy;
  const ancestors: PolicyRecord[] = [];
  while (current?.supersedes) {
    const parentId = current.supersedes.id as string;
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    current = parent;
  }

  chain.push(...ancestors);
  if (!seen.has(policy.id.id as string)) {
    seen.add(policy.id.id as string);
    chain.push(policy);
  }

  // Walk forward to latest
  let latestId = policy.id.id as string;
  for (let i = 0; i < 50; i++) {
    const child = bySupersedes.get(latestId);
    if (!child) break;
    const childId = child.id.id as string;
    if (seen.has(childId)) break;
    seen.add(childId);
    chain.push(child);
    latestId = childId;
  }

  chain.sort((a, b) => a.version - b.version);
  return chain;
}

/** Build version chain formatted as PolicyVersionChainItem[]. */
export async function buildVersionChain(
  surreal: Surreal,
  policy: PolicyRecord,
): Promise<PolicyVersionChainItem[]> {
  const chain = await resolveChainFromPool(surreal, policy);
  return chain.map((v) => ({
    id: v.id.id as string,
    version: v.version,
    status: v.status,
    created_at: formatTimestamp(v.created_at),
  }));
}

/** Build enriched version chain (includes title + rules_count). */
export async function getVersionChain(
  surreal: Surreal,
  policyId: string,
  workspace: RecordId<"workspace">,
): Promise<Array<PolicyVersionChainItem & { title: string; rules_count: number }> | undefined> {
  const policy = await getPolicyById(surreal, policyId, workspace);
  if (!policy) return undefined;

  const chain = await resolveChainFromPool(surreal, policy);
  return chain.map((v) => ({
    id: v.id.id as string,
    version: v.version,
    status: v.status,
    created_at: formatTimestamp(v.created_at),
    title: v.title,
    rules_count: 0,
  }));
}

export async function createPolicyAuditEvent(
  surreal: Surreal,
  eventType: string,
  actor: RecordId<"identity">,
  workspace: RecordId<"workspace">,
  policyId: string,
  version: number,
): Promise<void> {
  const auditId = `audit-${crypto.randomUUID()}`;
  const auditRecord = new RecordId("audit_event", auditId);

  await surreal.query("CREATE $audit CONTENT $content;", {
    audit: auditRecord,
    content: {
      event_type: eventType,
      actor,
      workspace,
      payload: {
        policy_id: policyId,
        policy_version: version,
      },
      severity: "info",
      created_at: new Date(),
    },
  });
}

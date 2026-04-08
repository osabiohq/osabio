/**
 * Policy detail page: displays full policy record, governance edges,
 * version chain, and lifecycle action buttons (activate/deprecate/create version).
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useWorkspaceState } from "../../stores/workspace-state";
import type { PolicyStatus } from "../../hooks/use-policies";
import { VersionDiffView } from "./VersionDiffView";
import { RegoEditor } from "./RegoEditor";
import { PolicyTestPanel } from "./PolicyTestPanel";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Separator } from "../ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

type PolicyRule = { id: string; condition: RuleCondition; effect: "allow" | "deny"; priority: number };
type RulePredicate = { field: string; operator: string; value: string | number | boolean | string[] };
type RuleCondition = RulePredicate | RulePredicate[];
type PolicySelector = { workspace?: string; agent_role?: string; resource?: string };

type PolicyDetail = {
  id: string; title: string; description?: string; version: number; status: PolicyStatus;
  selector: PolicySelector; rules: PolicyRule[]; rego_source?: string; human_veto_required: boolean; max_ttl?: string;
  supersedes?: string; created_at: string; updated_at?: string;
};

type PolicyEdgeInfo = {
  governing: Array<{ identity_id: string; created_at: string }>;
  protects: Array<{ workspace_id: string; created_at: string }>;
};

type VersionChainItem = { id: string; version: number; status: string; created_at: string };
type PolicyDetailResponse = { policy: PolicyDetail; edges: PolicyEdgeInfo; version_chain: VersionChainItem[] };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<PolicyStatus, string> = { draft: "Draft", testing: "Testing", active: "Active", deprecated: "Deprecated", superseded: "Superseded" };
const STATUS_VARIANT: Record<PolicyStatus, "default" | "secondary" | "outline" | "destructive"> = { draft: "secondary", testing: "outline", active: "default", deprecated: "secondary", superseded: "secondary" };

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function canActivate(status: PolicyStatus): boolean { return status === "draft" || status === "testing"; }
function canDeprecate(status: PolicyStatus): boolean { return status === "active"; }
function canCreateVersion(status: PolicyStatus): boolean { return status === "active"; }

function formatCondition(condition: RuleCondition): string {
  const predicates = Array.isArray(condition) ? condition : [condition];
  return predicates.map((p) => {
    const valueDisplay = Array.isArray(p.value) ? `[${p.value.join(", ")}]` : String(p.value);
    return `${p.field} ${p.operator} ${valueDisplay}`;
  }).join(" AND ");
}

function buildPolicyDetailUrl(workspaceId: string, policyId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/policies/${encodeURIComponent(policyId)}`;
}

function hasSelectorValues(selector: PolicySelector): boolean {
  return Boolean(selector.workspace || selector.agent_role || selector.resource);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PolicyMetadata({ policy }: { policy: PolicyDetail }) {
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Status", value: <Badge variant={STATUS_VARIANT[policy.status]}>{STATUS_LABELS[policy.status]}</Badge> },
    { label: "Version", value: `v${policy.version}` },
    { label: "Created", value: formatDateTime(policy.created_at) },
  ];
  if (policy.updated_at) rows.push({ label: "Updated", value: formatDateTime(policy.updated_at) });
  rows.push({ label: "Human veto", value: policy.human_veto_required ? "Required" : "Not required" });
  if (policy.max_ttl) rows.push({ label: "Max TTL", value: policy.max_ttl });
  if (hasSelectorValues(policy.selector)) {
    rows.push({
      label: "Selector",
      value: <span className="font-mono text-xs">{[
        policy.selector.agent_role && `role: ${policy.selector.agent_role}`,
        policy.selector.workspace && `workspace: ${policy.selector.workspace}`,
        policy.selector.resource && `resource: ${policy.selector.resource}`,
      ].filter(Boolean).join(", ")}</span>,
    });
  }

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RulesSection({ rules }: { rules: PolicyRule[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">Rules ({rules.length})</h3>
      {rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">No rules defined.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-muted text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">ID</th>
                <th className="px-2 py-1.5 font-medium">Condition</th>
                <th className="px-2 py-1.5 font-medium">Effect</th>
                <th className="px-2 py-1.5 font-medium">Priority</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b border-border">
                  <td className="px-2 py-1.5 font-mono text-muted-foreground">{rule.id}</td>
                  <td className="px-2 py-1.5 font-mono">{formatCondition(rule.condition)}</td>
                  <td className="px-2 py-1.5">
                    <Badge variant={rule.effect === "deny" ? "destructive" : "secondary"}>{rule.effect}</Badge>
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">{rule.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RegoSourceSection({ regoSource }: { regoSource: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">Rego Source</h3>
      <RegoEditor value={regoSource} onChange={() => undefined} readOnly />
    </div>
  );
}

function GovernanceEdgesSection({ edges }: { edges: PolicyEdgeInfo }) {
  const hasEdges = edges.governing.length > 0 || edges.protects.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">Governance Edges</h3>
      {!hasEdges ? (
        <p className="text-xs text-muted-foreground">No governance edges.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {edges.governing.length > 0 && (
            <div className="flex flex-col gap-1">
              <h4 className="text-xs font-medium text-muted-foreground">Governing Identities</h4>
              <ul className="flex flex-col gap-0.5">
                {edges.governing.map((edge) => (
                  <li key={edge.identity_id} className="flex items-center justify-between rounded-md bg-muted px-2 py-1 text-xs">
                    <span className="font-mono text-foreground">{edge.identity_id}</span>
                    <span className="text-muted-foreground">{formatDate(edge.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {edges.protects.length > 0 && (
            <div className="flex flex-col gap-1">
              <h4 className="text-xs font-medium text-muted-foreground">Protected Workspaces</h4>
              <ul className="flex flex-col gap-0.5">
                {edges.protects.map((edge) => (
                  <li key={edge.workspace_id} className="flex items-center justify-between rounded-md bg-muted px-2 py-1 text-xs">
                    <span className="font-mono text-foreground">{edge.workspace_id}</span>
                    <span className="text-muted-foreground">{formatDate(edge.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VersionHistorySection({ versionChain, currentPolicyId, onCompare }: {
  versionChain: VersionChainItem[]; currentPolicyId: string;
  onCompare?: (oldVersionId: string, newVersionId: string) => void;
}) {
  if (versionChain.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Version History</h3>
        <p className="text-xs text-muted-foreground">No version history.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">Version History</h3>
      <ul className="flex flex-col gap-1">
        {versionChain.map((version, index) => {
          const isCurrent = version.id === currentPolicyId;
          const nextVersion = index < versionChain.length - 1 ? versionChain[index + 1] : undefined;
          return (
            <li key={version.id} className={cn("flex items-center justify-between rounded-md px-2 py-1.5 text-xs", isCurrent && "bg-accent-glow")}>
              <div className="flex items-center gap-2">
                {isCurrent ? (
                  <span className="font-medium text-foreground">v{version.version} (current)</span>
                ) : (
                  <Link to="/policies/$policyId" params={{ policyId: version.id }} className="font-medium text-ring hover:underline">
                    v{version.version}
                  </Link>
                )}
                <Badge variant={STATUS_VARIANT[version.status as PolicyStatus] ?? "secondary"}>
                  {STATUS_LABELS[version.status as PolicyStatus] ?? version.status}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {nextVersion && onCompare && (
                  <Button variant="ghost" size="xs" onClick={() => onCompare(nextVersion.id, version.id)}>
                    Diff v{nextVersion.version}
                  </Button>
                )}
                <span className="text-muted-foreground">{formatDate(version.created_at)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action buttons + confirm dialog
// ---------------------------------------------------------------------------

type LifecycleAction = "activate" | "deprecate" | "create_version";

function ActionButtons({ policy, onAction }: { policy: PolicyDetail; onAction: (action: LifecycleAction) => void }) {
  const showActivate = canActivate(policy.status);
  const showDeprecate = canDeprecate(policy.status);
  const showCreateVersion = canCreateVersion(policy.status);
  if (!showActivate && !showDeprecate && !showCreateVersion) return undefined;

  return (
    <div className="flex gap-1.5">
      {showActivate && <Button size="sm" onClick={() => onAction("activate")}>Activate</Button>}
      {showDeprecate && <Button variant="destructive" size="sm" onClick={() => onAction("deprecate")}>Deprecate</Button>}
      {showCreateVersion && <Button variant="outline" size="sm" onClick={() => onAction("create_version")}>Create New Version</Button>}
    </div>
  );
}

function ConfirmDialog({ title, message, confirmLabel, isDestructive, isSubmitting, onConfirm, onCancel }: {
  title: string; message: string; confirmLabel: string; isDestructive?: boolean; isSubmitting: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>Cancel</Button>
          <Button variant={isDestructive ? "destructive" : "default"} onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Processing..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PolicyDetailPage() {
  const { policyId } = useParams({ strict: false }) as { policyId: string };
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const navigate = useNavigate();

  const [data, setData] = useState<PolicyDetailResponse | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirmAction, setConfirmAction] = useState<LifecycleAction | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const [diffPair, setDiffPair] = useState<{ oldPolicy: PolicyDetail; newPolicy: PolicyDetail } | undefined>();
  const [isDiffLoading, setIsDiffLoading] = useState(false);

  const fetchPolicy = useCallback(async () => {
    if (!workspaceId) return;
    setIsLoading(true); setError(undefined);
    try {
      const response = await fetch(buildPolicyDetailUrl(workspaceId, policyId));
      if (!response.ok) throw new Error(await response.text() || `Failed to load policy (${response.status})`);
      setData((await response.json()) as PolicyDetailResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load policy");
    } finally { setIsLoading(false); }
  }, [workspaceId, policyId]);

  useEffect(() => { if (workspaceId) void fetchPolicy(); }, [workspaceId, policyId, fetchPolicy]);

  const handleAction = useCallback((action: LifecycleAction) => { setConfirmAction(action); setActionError(undefined); }, []);
  const handleCancelAction = useCallback(() => { if (!isSubmitting) { setConfirmAction(undefined); setActionError(undefined); } }, [isSubmitting]);

  const handleConfirmAction = useCallback(async () => {
    if (!workspaceId || !confirmAction) return;
    setIsSubmitting(true); setActionError(undefined);
    try {
      const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/policies/${encodeURIComponent(policyId)}`;
      if (confirmAction === "activate") {
        const response = await fetch(`${base}/activate`, { method: "PATCH" });
        if (!response.ok) { const body = await response.text(); let msg: string; try { msg = (JSON.parse(body) as { error?: string }).error ?? body; } catch { msg = body; } throw new Error(msg || "Failed to activate policy"); }
        setConfirmAction(undefined); void fetchPolicy();
      } else if (confirmAction === "deprecate") {
        const response = await fetch(`${base}/deprecate`, { method: "PATCH" });
        if (!response.ok) { const body = await response.text(); let msg: string; try { msg = (JSON.parse(body) as { error?: string }).error ?? body; } catch { msg = body; } throw new Error(msg || "Failed to deprecate policy"); }
        setConfirmAction(undefined); void fetchPolicy();
      } else if (confirmAction === "create_version") {
        const response = await fetch(`${base}/versions`, { method: "POST" });
        if (!response.ok) { const body = await response.text(); let msg: string; try { msg = (JSON.parse(body) as { error?: string }).error ?? body; } catch { msg = body; } throw new Error(msg || "Failed to create new version"); }
        const result = (await response.json()) as { policy_id: string };
        setConfirmAction(undefined); void navigate({ to: "/policies/$policyId", params: { policyId: result.policy_id } });
      }
    } catch (err) { setActionError(err instanceof Error ? err.message : "Action failed"); } finally { setIsSubmitting(false); }
  }, [workspaceId, policyId, confirmAction, fetchPolicy, navigate]);

  const handleCompareVersions = useCallback(async (oldVersionId: string, newVersionId: string) => {
    if (!workspaceId) return;
    setIsDiffLoading(true);
    try {
      const [oldRes, newRes] = await Promise.all([fetch(buildPolicyDetailUrl(workspaceId, oldVersionId)), fetch(buildPolicyDetailUrl(workspaceId, newVersionId))]);
      if (!oldRes.ok || !newRes.ok) throw new Error("Failed to fetch version details for comparison");
      const oldData = (await oldRes.json()) as PolicyDetailResponse;
      const newData = (await newRes.json()) as PolicyDetailResponse;
      setDiffPair({ oldPolicy: oldData.policy, newPolicy: newData.policy });
    } catch (err) { setActionError(err instanceof Error ? err.message : "Failed to load diff"); } finally { setIsDiffLoading(false); }
  }, [workspaceId]);

  const confirmConfig: Record<LifecycleAction, { title: string; message: string; confirmLabel: string; isDestructive?: boolean }> = {
    activate: { title: "Activate Policy", message: "Activating this policy will make it enforceable in the governance pipeline. Are you sure?", confirmLabel: "Activate" },
    deprecate: { title: "Deprecate Policy", message: "Deprecating this policy will remove it from active enforcement. This action cannot be undone. Are you sure?", confirmLabel: "Deprecate", isDestructive: true },
    create_version: { title: "Create New Version", message: "This will create a new draft version based on the current policy. The current version remains active until the new version is activated.", confirmLabel: "Create Version" },
  };

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <Link to="/policies" className="text-xs text-ring hover:underline">&larr; Back to Policies</Link>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading policy...</p>
      ) : data ? (
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-lg font-semibold text-foreground">{data.policy.title}</h1>
              {data.policy.description && <p className="text-sm text-muted-foreground">{data.policy.description}</p>}
            </div>
            <ActionButtons policy={data.policy} onAction={handleAction} />
          </div>

          {actionError && <p className="text-sm text-destructive">{actionError}</p>}

          <PolicyMetadata policy={data.policy} />
          <Separator />
          {data.policy.rego_source ? (
            <>
              <RegoSourceSection regoSource={data.policy.rego_source} />
              <Separator />
            </>
          ) : (
            <>
              <RulesSection rules={data.policy.rules} />
              <Separator />
            </>
          )}
          <GovernanceEdgesSection edges={data.edges} />
          <Separator />
          <VersionHistorySection versionChain={data.version_chain} currentPolicyId={data.policy.id} onCompare={handleCompareVersions} />
          <Separator />
          {workspaceId && <PolicyTestPanel policyId={data.policy.id} workspaceId={workspaceId} />}

          {isDiffLoading && <p className="text-sm text-muted-foreground">Loading diff...</p>}
          {diffPair && <VersionDiffView oldPolicy={diffPair.oldPolicy} newPolicy={diffPair.newPolicy} onClose={() => setDiffPair(undefined)} />}
          {confirmAction && <ConfirmDialog {...confirmConfig[confirmAction]} isSubmitting={isSubmitting} onConfirm={handleConfirmAction} onCancel={handleCancelAction} />}
        </>
      ) : undefined}
    </section>
  );
}

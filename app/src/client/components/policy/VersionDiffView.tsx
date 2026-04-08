/**
 * VersionDiffView: client-side structural diff between two policy versions.
 *
 * Pure diff functions compare rules, selector, and metadata fields.
 * No server endpoint needed (ADR-003) -- both versions are fetched
 * client-side and diffed in the browser.
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Badge } from "../ui/badge";
import { RegoEditor } from "./RegoEditor";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types (reuse from PolicyDetailPage shape)
// ---------------------------------------------------------------------------

type RulePredicate = {
  field: string;
  operator: string;
  value: string | number | boolean | string[];
};

type RuleCondition = RulePredicate | RulePredicate[];

type PolicyRule = {
  id: string;
  condition: RuleCondition;
  effect: "allow" | "deny";
  priority: number;
};

type PolicySelector = {
  workspace?: string;
  agent_role?: string;
  resource?: string;
};

type DiffablePolicy = {
  title: string;
  description?: string;
  version: number;
  selector: PolicySelector;
  rules: PolicyRule[];
  rego_source?: string;
  human_veto_required: boolean;
  max_ttl?: string;
};

// ---------------------------------------------------------------------------
// Diff result types
// ---------------------------------------------------------------------------

export type RuleDiff =
  | { kind: "added"; rule: PolicyRule }
  | { kind: "removed"; rule: PolicyRule }
  | { kind: "changed"; ruleId: string; oldRule: PolicyRule; newRule: PolicyRule };

export type FieldChange = {
  field: string;
  oldValue: string;
  newValue: string;
};

export type PolicyDiffResult = {
  ruleDiffs: RuleDiff[];
  selectorChanges: FieldChange[];
  metadataChanges: FieldChange[];
  regoSourceChanged: boolean;
  oldRegoSource?: string;
  newRegoSource?: string;
};

// ---------------------------------------------------------------------------
// Pure diff functions
// ---------------------------------------------------------------------------

function serializeCondition(condition: RuleCondition): string {
  const predicates = Array.isArray(condition) ? condition : [condition];
  return predicates
    .map((p) => `${p.field} ${p.operator} ${Array.isArray(p.value) ? `[${p.value.join(",")}]` : String(p.value)}`)
    .join(" AND ");
}

function rulesAreEqual(a: PolicyRule, b: PolicyRule): boolean {
  return a.effect === b.effect && a.priority === b.priority && serializeCondition(a.condition) === serializeCondition(b.condition);
}

export function diffRules(oldRules: PolicyRule[], newRules: PolicyRule[]): RuleDiff[] {
  const diffs: RuleDiff[] = [];
  const oldById = new Map(oldRules.map((r) => [r.id, r]));
  const newById = new Map(newRules.map((r) => [r.id, r]));
  for (const [id, oldRule] of oldById) {
    const newRule = newById.get(id);
    if (!newRule) diffs.push({ kind: "removed", rule: oldRule });
    else if (!rulesAreEqual(oldRule, newRule)) diffs.push({ kind: "changed", ruleId: id, oldRule, newRule });
  }
  for (const [id, newRule] of newById) {
    if (!oldById.has(id)) diffs.push({ kind: "added", rule: newRule });
  }
  return diffs;
}

export function diffSelector(oldSelector: PolicySelector, newSelector: PolicySelector): FieldChange[] {
  const fields: Array<keyof PolicySelector> = ["workspace", "agent_role", "resource"];
  const changes: FieldChange[] = [];
  for (const field of fields) {
    const oldVal = oldSelector[field] ?? "(none)";
    const newVal = newSelector[field] ?? "(none)";
    if (oldVal !== newVal) changes.push({ field, oldValue: oldVal, newValue: newVal });
  }
  return changes;
}

export function diffMetadata(oldPolicy: DiffablePolicy, newPolicy: DiffablePolicy): FieldChange[] {
  const changes: FieldChange[] = [];
  if (oldPolicy.title !== newPolicy.title) changes.push({ field: "title", oldValue: oldPolicy.title, newValue: newPolicy.title });
  const oldDesc = oldPolicy.description ?? "(none)";
  const newDesc = newPolicy.description ?? "(none)";
  if (oldDesc !== newDesc) changes.push({ field: "description", oldValue: oldDesc, newValue: newDesc });
  if (oldPolicy.human_veto_required !== newPolicy.human_veto_required) changes.push({ field: "human_veto_required", oldValue: String(oldPolicy.human_veto_required), newValue: String(newPolicy.human_veto_required) });
  const oldTtl = oldPolicy.max_ttl ?? "(none)";
  const newTtl = newPolicy.max_ttl ?? "(none)";
  if (oldTtl !== newTtl) changes.push({ field: "max_ttl", oldValue: oldTtl, newValue: newTtl });
  return changes;
}

export function computePolicyDiff(oldPolicy: DiffablePolicy, newPolicy: DiffablePolicy): PolicyDiffResult {
  const regoSourceChanged = (oldPolicy.rego_source ?? "") !== (newPolicy.rego_source ?? "");
  return {
    ruleDiffs: diffRules(oldPolicy.rules, newPolicy.rules),
    selectorChanges: diffSelector(oldPolicy.selector, newPolicy.selector),
    metadataChanges: diffMetadata(oldPolicy, newPolicy),
    regoSourceChanged,
    oldRegoSource: oldPolicy.rego_source,
    newRegoSource: newPolicy.rego_source,
  };
}

function hasDifferences(diff: PolicyDiffResult): boolean {
  return diff.ruleDiffs.length > 0 || diff.selectorChanges.length > 0 || diff.metadataChanges.length > 0 || diff.regoSourceChanged;
}

function formatConditionDisplay(condition: RuleCondition): string {
  return serializeCondition(condition);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function DiffTable({ headers, rows }: { headers: string[]; rows: Array<{ key: string; cells: string[] }> }) {
  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="border-b border-border text-muted-foreground">
          {headers.map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-border">
            {row.cells.map((cell, i) => (
              <td key={i} className={cn("px-2 py-1", i === 1 && "text-destructive line-through", i === 2 && "text-entity-feature-fg")}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function VersionDiffView({
  oldPolicy,
  newPolicy,
  onClose,
}: {
  oldPolicy: DiffablePolicy;
  newPolicy: DiffablePolicy;
  onClose: () => void;
}) {
  const diff = computePolicyDiff(oldPolicy, newPolicy);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Version Diff: v{oldPolicy.version} → v{newPolicy.version}</DialogTitle>
        </DialogHeader>

        {!hasDifferences(diff) ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No structural differences between versions.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {diff.metadataChanges.length > 0 && (
              <div className="flex flex-col gap-1">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Metadata</h4>
                <div className="overflow-x-auto rounded-md border border-border">
                  <DiffTable
                    headers={["Field", `v${oldPolicy.version}`, `v${newPolicy.version}`]}
                    rows={diff.metadataChanges.map((c) => ({ key: c.field, cells: [c.field, c.oldValue, c.newValue] }))}
                  />
                </div>
              </div>
            )}

            {diff.selectorChanges.length > 0 && (
              <div className="flex flex-col gap-1">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Selector</h4>
                <div className="overflow-x-auto rounded-md border border-border">
                  <DiffTable
                    headers={["Field", `v${oldPolicy.version}`, `v${newPolicy.version}`]}
                    rows={diff.selectorChanges.map((c) => ({ key: c.field, cells: [c.field, c.oldValue, c.newValue] }))}
                  />
                </div>
              </div>
            )}

            {diff.regoSourceChanged && (
              <div className="flex flex-col gap-1">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rego Source</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <p className="text-xs text-muted-foreground">v{oldPolicy.version}</p>
                    <RegoEditor value={diff.oldRegoSource ?? ""} onChange={() => undefined} readOnly />
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-xs text-muted-foreground">v{newPolicy.version}</p>
                    <RegoEditor value={diff.newRegoSource ?? ""} onChange={() => undefined} readOnly />
                  </div>
                </div>
              </div>
            )}

            {diff.ruleDiffs.length > 0 && (
              <div className="flex flex-col gap-1">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rules</h4>
                <div className="flex flex-col gap-1.5">
                  {diff.ruleDiffs.map((rd) => {
                    if (rd.kind === "added") {
                      return (
                        <div key={`add-${rd.rule.id}`} className="flex flex-col gap-0.5 rounded-md bg-entity-feature-muted p-2 text-xs">
                          <div className="flex items-center gap-2">
                            <Badge variant="default" className="text-[0.6rem]">Added</Badge>
                            <span className="font-mono text-muted-foreground">{rd.rule.id}</span>
                          </div>
                          <span className="text-entity-feature-fg">
                            {rd.rule.effect} (priority {rd.rule.priority}) -- {formatConditionDisplay(rd.rule.condition)}
                          </span>
                        </div>
                      );
                    }
                    if (rd.kind === "removed") {
                      return (
                        <div key={`rm-${rd.rule.id}`} className="flex flex-col gap-0.5 rounded-md bg-destructive/10 p-2 text-xs">
                          <div className="flex items-center gap-2">
                            <Badge variant="destructive" className="text-[0.6rem]">Removed</Badge>
                            <span className="font-mono text-muted-foreground">{rd.rule.id}</span>
                          </div>
                          <span className="text-destructive">
                            {rd.rule.effect} (priority {rd.rule.priority}) -- {formatConditionDisplay(rd.rule.condition)}
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div key={`chg-${rd.ruleId}`} className="flex flex-col gap-0.5 rounded-md bg-entity-decision-muted p-2 text-xs">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[0.6rem]">Changed</Badge>
                          <span className="font-mono text-muted-foreground">{rd.ruleId}</span>
                        </div>
                        <div className="text-destructive line-through">
                          {rd.oldRule.effect} (priority {rd.oldRule.priority}) -- {formatConditionDisplay(rd.oldRule.condition)}
                        </div>
                        <div className="text-entity-feature-fg">
                          {rd.newRule.effect} (priority {rd.newRule.priority}) -- {formatConditionDisplay(rd.newRule.condition)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

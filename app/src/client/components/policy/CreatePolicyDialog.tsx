/**
 * Dialog for creating a new policy with a Rego source editor.
 */

import { useCallback, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useWorkspaceState } from "../../stores/workspace-state";
import { RegoEditor } from "./RegoEditor";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";

// ---------------------------------------------------------------------------
// Form state types
// ---------------------------------------------------------------------------

type PolicyFormState = {
  title: string;
  description: string;
  agentRole: string;
  humanVetoRequired: boolean;
  maxTtl: string;
  regoSource: string;
};

type FormErrors = {
  title?: string;
  description?: string;
  regoSource?: string;
  submit?: string;
};

// ---------------------------------------------------------------------------
// Intent evaluation context reference fields
// ---------------------------------------------------------------------------

const CONTEXT_FIELDS: Array<{ path: string; type: string; description: string }> = [
  { path: "input.action_spec.action", type: "string", description: "Action being requested" },
  { path: "input.action_spec.provider", type: "string", description: "Provider handling the action" },
  { path: "input.behavior_scores.<name>", type: "number", description: "Behavior score by name" },
  { path: "input.budget_limit.amount", type: "number", description: "Budget amount" },
  { path: "input.budget_limit.currency", type: "string", description: "Budget currency" },
  { path: "input.requester_type", type: "string", description: "Type of requester" },
  { path: "input.requester_role", type: "string", description: "Role of requester" },
  { path: "input.priority", type: "number", description: "Intent priority level" },
];

// ---------------------------------------------------------------------------
// Pure form helpers
// ---------------------------------------------------------------------------

const DEFAULT_REGO_SOURCE = `package policy

import future.keywords.if

default allow := false

allow if {
  # Add conditions here
  true
}
`;

function createInitialFormState(): PolicyFormState {
  return {
    title: "",
    description: "",
    agentRole: "",
    humanVetoRequired: false,
    maxTtl: "",
    regoSource: DEFAULT_REGO_SOURCE,
  };
}

function validateForm(state: PolicyFormState): FormErrors {
  const errors: FormErrors = {};
  if (state.title.trim() === "") errors.title = "Title is required";
  if (state.description.trim() === "") errors.description = "Description is required";
  if (state.regoSource.trim() === "") errors.regoSource = "Rego source is required";
  return errors;
}

function hasErrors(errors: FormErrors): boolean {
  return Object.keys(errors).length > 0;
}

function buildRequestBody(state: PolicyFormState) {
  const body: Record<string, unknown> = {
    title: state.title.trim(),
    description: state.description.trim(),
    rego_source: state.regoSource,
  };
  if (state.agentRole.trim()) body.selector = { agent_role: state.agentRole.trim() };
  if (state.humanVetoRequired) body.human_veto_required = true;
  if (state.maxTtl.trim()) body.max_ttl = state.maxTtl.trim();
  return body;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type CreatePolicyDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function CreatePolicyDialog({ open, onClose }: CreatePolicyDialogProps) {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const navigate = useNavigate();

  const [form, setForm] = useState<PolicyFormState>(createInitialFormState);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showContextRef, setShowContextRef] = useState(false);

  const updateField = useCallback(
    <K extends keyof PolicyFormState>(field: K, value: PolicyFormState[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => {
        const next = { ...prev };
        if (field === "title") delete next.title;
        if (field === "description") delete next.description;
        if (field === "regoSource") delete next.regoSource;
        delete next.submit;
        return next;
      });
    },
    [],
  );

  const handleRegoChange = useCallback(
    (value: string) => { updateField("regoSource", value); },
    [updateField],
  );

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    setForm(createInitialFormState());
    setErrors({});
    onClose();
  }, [isSubmitting, onClose]);

  const handleSubmit = useCallback(async () => {
    const validationErrors = validateForm(form);
    if (hasErrors(validationErrors)) { setErrors(validationErrors); return; }
    if (!workspaceId) return;

    setIsSubmitting(true);
    setErrors({});

    try {
      const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/policies`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(form)),
      });

      if (!response.ok) {
        const text = await response.text();
        let message: string;
        try {
          const parsed = JSON.parse(text) as { error?: string };
          message = parsed.error ?? text;
        } catch { message = text; }
        setErrors({ submit: message || "Failed to create policy" });
        return;
      }

      const data = (await response.json()) as { policy_id: string };
      setForm(createInitialFormState());
      setErrors({});
      onClose();
      void navigate({ to: "/policies/$policyId", params: { policyId: data.policy_id } });
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : "Failed to create policy" });
    } finally {
      setIsSubmitting(false);
    }
  }, [form, workspaceId, onClose, navigate]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Policy</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {errors.submit && (
            <p className="text-sm text-destructive">{errors.submit}</p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="policy-title">Title <span className="text-destructive">*</span></Label>
            <Input
              id="policy-title"
              placeholder="e.g. Restrict code deployment"
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
            />
            {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="policy-description">Description <span className="text-destructive">*</span></Label>
            <Textarea
              id="policy-description"
              placeholder="Describe what this policy governs"
              rows={2}
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
            />
            {errors.description && <p className="text-xs text-destructive">{errors.description}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="policy-agent-role">Agent Role</Label>
              <Input
                id="policy-agent-role"
                placeholder="e.g. coding_agent"
                value={form.agentRole}
                onChange={(e) => updateField("agentRole", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="policy-max-ttl">Max TTL</Label>
              <Input
                id="policy-max-ttl"
                placeholder="e.g. 1h, 30m"
                value={form.maxTtl}
                onChange={(e) => updateField("maxTtl", e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="rounded border-input"
              checked={form.humanVetoRequired}
              onChange={(e) => updateField("humanVetoRequired", e.target.checked)}
            />
            Human veto required
          </label>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Rego Source <span className="text-destructive">*</span></Label>
              <button
                type="button"
                onClick={() => setShowContextRef((prev) => !prev)}
                className="text-xs text-ring hover:underline"
              >
                {showContextRef ? "Hide" : "Show"} field reference
              </button>
            </div>

            {showContextRef && (
              <div className="rounded-md border border-border bg-muted p-2">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">IntentEvaluationContext fields</p>
                <dl className="grid grid-cols-[auto_auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  {CONTEXT_FIELDS.map((field) => (
                    <div key={field.path} className="contents">
                      <dt className="font-mono text-foreground">{field.path}</dt>
                      <dd className="text-muted-foreground">{field.type}</dd>
                      <dd className="text-muted-foreground">{field.description}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            <RegoEditor
              value={form.regoSource}
              onChange={handleRegoChange}
              showValidate
            />
            {errors.regoSource && <p className="text-xs text-destructive">{errors.regoSource}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => { void handleSubmit(); }} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Policy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

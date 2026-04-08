import type { RecordId } from "surrealdb";

// ---------------------------------------------------------------------------
// Policy Domain Types
// ---------------------------------------------------------------------------

export type PolicySelector = {
  workspace?: string;
  agent_role?: string;
  resource?: string;
};

export type PolicyStatus =
  | "draft"
  | "testing"
  | "active"
  | "deprecated"
  | "superseded";

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
  created_at: Date;
  updated_at?: Date;
};

// ---------------------------------------------------------------------------
// Policy Trace (recorded on intent.evaluation)
// ---------------------------------------------------------------------------

export type PolicyTraceEntry = {
  policy_id: string;
  policy_version: number;
  /** For Rego policies: contains policy ID. Field name kept for trace format compatibility. */
  rule_id: string;
  effect: "allow" | "deny" | "evidence_requirement";
  matched: boolean;
  priority: number;
};

// ---------------------------------------------------------------------------
// Policy Gate Result (output of policy evaluation pipeline)
// ---------------------------------------------------------------------------

export type PolicyGateWarning = {
  rule_id: string;
  field: string;
  policy_id: string;
};

export type PolicyEvidenceRequirements = {
  min_count: number;
  required_types?: string[];
};

export type PolicyGateResult =
  | {
      passed: true;
      policy_trace: PolicyTraceEntry[];
      human_veto_required: boolean;
      warnings: PolicyGateWarning[];
      evidence_requirements?: PolicyEvidenceRequirements;
    }
  | {
      passed: false;
      reason: string;
      policy_trace: PolicyTraceEntry[];
      deny_rule_id: string;
      warnings: PolicyGateWarning[];
    };

// ---------------------------------------------------------------------------
// Intent Evaluation Context (input to policy gate)
// ---------------------------------------------------------------------------

export type IntentEvaluationContext = {
  goal: string;
  reasoning: string;
  priority: number;
  action_spec: {
    provider: string;
    action: string;
    params?: Record<string, unknown>;
  };
  budget_limit?: { amount: number; currency: string };
  authorization_details?: Array<{
    type: string;
    action: string;
    resource: string;
    constraints?: Record<string, unknown>;
  }>;
  requester_type: string;
  requester_role?: string;
  /** Behavior scores keyed by metric_type (e.g. Security_First, TDD_Adherence).
   *  Populated by enrichBehaviorScores before policy gate evaluation.
   *  Empty object when no behavior data exists for the agent. */
  behavior_scores?: Record<string, number>;
};

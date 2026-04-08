import type { RecordId, Surreal } from "surrealdb";
import type {
  PolicyRecord,
  PolicyGateResult,
  PolicyTraceEntry,
  PolicyGateWarning,
  PolicyEvidenceRequirements,
  IntentEvaluationContext,
} from "./types";
import {
  evaluateRegoPolicy,
  createEngineCache,
  type RegoEvaluationResult,
} from "./rego-evaluator";
import { loadActivePolicies } from "./policy-queries";

// ---------------------------------------------------------------------------
// Pipeline Types
// ---------------------------------------------------------------------------

type EvaluatedPolicy = {
  policyId: string;
  policyVersion: number;
  humanVetoRequired: boolean;
  denied: boolean;
  denyMessages: string[];
  evidenceRequirement: RegoEvaluationResult["evidence_requirement"];
  warnings: PolicyGateWarning[];
};

// ---------------------------------------------------------------------------
// Pure Pipeline Functions
// ---------------------------------------------------------------------------

export const deduplicatePolicies = (
  policies: PolicyRecord[],
): PolicyRecord[] => {
  const seen = new Set<string>();
  const result: PolicyRecord[] = [];

  for (const policy of policies) {
    const id = policy.id.id as string;
    if (!seen.has(id)) {
      seen.add(id);
      result.push(policy);
    }
  }

  return result;
};

export const buildGateResult = (
  evaluatedPolicies: EvaluatedPolicy[],
  denyMatched: boolean,
  warnings: PolicyGateWarning[],
  evidenceRequirements?: PolicyEvidenceRequirements,
): PolicyGateResult => {
  const policyTrace: PolicyTraceEntry[] = evaluatedPolicies.map((entry) => ({
    policy_id: entry.policyId,
    policy_version: entry.policyVersion,
    // For Rego policies: rule_id contains the policy ID (one entry per policy)
    rule_id: entry.policyId,
    effect: entry.denied ? "deny" : "allow",
    matched: entry.denied,
    priority: 0,
  }));

  if (denyMatched) {
    const denyEntry = evaluatedPolicies.find((entry) => entry.denied);
    return {
      passed: false,
      reason: `Rego policy '${denyEntry!.policyId}' denied: ${denyEntry!.denyMessages.join("; ")}`,
      policy_trace: policyTrace,
      deny_rule_id: denyEntry!.policyId,
      warnings,
    };
  }

  const humanVetoRequired = evaluatedPolicies.some(
    (entry) => entry.humanVetoRequired,
  );

  return {
    passed: true,
    policy_trace: policyTrace,
    human_veto_required: humanVetoRequired,
    warnings,
    ...(evidenceRequirements ? { evidence_requirements: evidenceRequirements } : {}),
  };
};

const extractEvidenceRequirementsFromPolicies = (
  evaluatedPolicies: EvaluatedPolicy[],
): PolicyEvidenceRequirements | undefined => {
  const withRequirement = evaluatedPolicies.find(
    (entry) => !entry.denied && entry.evidenceRequirement !== undefined,
  );

  if (!withRequirement?.evidenceRequirement) return undefined;

  return {
    min_count: withRequirement.evidenceRequirement.min_count,
    ...(withRequirement.evidenceRequirement.required_types
      ? { required_types: withRequirement.evidenceRequirement.required_types }
      : {}),
  };
};

// ---------------------------------------------------------------------------
// Composition Root (single effect boundary)
// ---------------------------------------------------------------------------

export const evaluatePolicyGate = async (
  surreal: Surreal,
  identityId: RecordId<"identity">,
  workspaceId: RecordId<"workspace">,
  intentContext: IntentEvaluationContext,
): Promise<PolicyGateResult> => {
  // Effect boundary: single DB read
  const rawPolicies = await loadActivePolicies(surreal, identityId, workspaceId);

  // Pure deduplication
  const deduplicated = deduplicatePolicies(rawPolicies);

  // Engine cache: per-gate-call (avoids module-level mutable singleton per AGENTS.md)
  const engineCache = createEngineCache();

  const evaluatedPolicies: EvaluatedPolicy[] = [];
  const allWarnings: PolicyGateWarning[] = [];

  // Evaluate each policy via Rego; short-circuit on first deny
  for (const policy of deduplicated) {
    const policyId = policy.id.id as string;

    let result: RegoEvaluationResult;
    try {
      result = await evaluateRegoPolicy(
        policy.rego_source,
        policyId,
        policy.version,
        intentContext,
        engineCache,
      );
    } catch (err: unknown) {
      // Fail-closed: WASM load failure or engine error → deny
      const message = err instanceof Error ? err.message : String(err);
      return {
        passed: false,
        reason: `Policy evaluation error: ${message}`,
        policy_trace: [],
        deny_rule_id: policyId,
        warnings: [{ rule_id: policyId, field: "rego_source", policy_id: policyId }],
      };
    }

    const denied = result.decision === "deny";
    evaluatedPolicies.push({
      policyId,
      policyVersion: policy.version,
      humanVetoRequired: policy.human_veto_required,
      denied,
      denyMessages: result.messages,
      evidenceRequirement: result.evidence_requirement,
      warnings: [],
    });

    if (denied) {
      return buildGateResult(evaluatedPolicies, true, allWarnings);
    }
  }

  const evidenceRequirements = extractEvidenceRequirementsFromPolicies(evaluatedPolicies);

  return buildGateResult(evaluatedPolicies, false, allWarnings, evidenceRequirements);
};

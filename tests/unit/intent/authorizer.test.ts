import { describe, expect, test, mock } from "bun:test";
import { RecordId } from "surrealdb";
import {
  evaluateIntent,
  type EvaluateIntentInput,
  type LlmEvaluator,
} from "../../../app/src/server/intent/authorizer";
import type { EvaluationResult } from "../../../app/src/server/intent/types";

// --- Helpers ---

// Mock Surreal that returns empty policies (policy gate always passes)
const mockSurreal = {
  query: async () => [[{ policies: [] }]],
} as unknown as EvaluateIntentInput["surreal"];

const mockIdentityId = new RecordId("identity", "test-identity");
const mockWorkspaceId = new RecordId("workspace", "test-workspace");

const defaultIntent: EvaluateIntentInput["intent"] = {
  goal: "Send a slack notification",
  reasoning: "User requested notification",
  action_spec: { provider: "slack", action: "send_message", params: {} },
};

const approvedLlmResult: EvaluationResult = {
  decision: "APPROVE",
  risk_score: 15,
  reason: "Low-risk notification action",
};

const rejectedLlmResult: EvaluationResult = {
  decision: "REJECT",
  risk_score: 80,
  reason: "Prompt injection detected",
};

const makeLlmEvaluator = (result: EvaluationResult): LlmEvaluator =>
  async (_intent, _signal) => result;

const failingLlmEvaluator: LlmEvaluator = async () => {
  throw new Error("LLM service unavailable");
};

const slowLlmEvaluator = (delayMs: number): LlmEvaluator =>
  async (_intent, signal) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
    return approvedLlmResult;
  };

const makeInput = (overrides: Partial<EvaluateIntentInput> = {}): EvaluateIntentInput => ({
  intent: defaultIntent,
  surreal: mockSurreal,
  identityId: mockIdentityId,
  workspaceId: mockWorkspaceId,
  requesterType: "agent",
  llmEvaluator: makeLlmEvaluator(approvedLlmResult),
  ...overrides,
});

// --- Tests ---

describe("evaluateIntent", () => {
  describe("happy path: policy passes, LLM returns result", () => {
    test("returns LLM evaluation result with policy_only=false", async () => {
      const result = await evaluateIntent(makeInput({
        llmEvaluator: makeLlmEvaluator(approvedLlmResult),
      }));

      expect(result.decision).toBe("APPROVE");
      expect(result.risk_score).toBe(15);
      expect(result.reason).toBe("Low-risk notification action");
      expect(result.policy_only).toBe(false);
      expect(result.policy_trace).toEqual([]);
      expect(result.human_veto_required).toBe(false);
    });

    test("returns LLM REJECT decision with policy_only=false", async () => {
      const result = await evaluateIntent(makeInput({
        llmEvaluator: makeLlmEvaluator(rejectedLlmResult),
      }));

      expect(result.decision).toBe("REJECT");
      expect(result.risk_score).toBe(80);
      expect(result.reason).toBe("Prompt injection detected");
      expect(result.policy_only).toBe(false);
    });
  });

  describe("policy reject short-circuits before LLM", () => {
    test("rejects when policy gate denies without calling LLM", async () => {
      // Mock Surreal that returns a deny policy from graph traversal
      // loadActivePolicies calls query twice (identity + workspace), accessing result[0]?.policies
      const denyPolicy = {
        id: new RecordId("policy", "deny-test"),
        title: "Block Deploy",
        version: 1,
        status: "active",
        selector: {},
        rego_source: `package osabio.policy
default allow := false
deny contains msg if {
  input.action_spec.action == "deploy"
  msg := "deploy blocked by policy"
}`,
        human_veto_required: false,
        created_by: mockIdentityId,
        workspace: mockWorkspaceId,
        created_at: new Date(),
      };
      const denyPolicySurreal = {
        query: async () => [[{ policies: [denyPolicy] }]],
      } as unknown as EvaluateIntentInput["surreal"];

      let llmCalled = false;
      const spyEvaluator: LlmEvaluator = async () => {
        llmCalled = true;
        return approvedLlmResult;
      };

      const result = await evaluateIntent(makeInput({
        intent: {
          ...defaultIntent,
          action_spec: { provider: "infra", action: "deploy", params: {} },
        },
        surreal: denyPolicySurreal,
        llmEvaluator: spyEvaluator,
      }));

      expect(result.decision).toBe("REJECT");
      expect(result.policy_only).toBe(true);
      expect(result.policy_trace.length).toBeGreaterThan(0);
      expect(llmCalled).toBe(false);
    });
  });

  describe("LLM failure falls back to high-risk approval for human review", () => {
    test("returns APPROVE with risk_score=50 and policy_only=true when LLM throws", async () => {
      const result = await evaluateIntent(makeInput({
        llmEvaluator: failingLlmEvaluator,
      }));

      expect(result.decision).toBe("APPROVE");
      expect(result.policy_only).toBe(true);
      expect(result.risk_score).toBe(50);
      expect(result.reason).toContain("LLM");
    });
  });

  describe("hard enforcement rejects zero-evidence intents before LLM evaluation", () => {
    test("returns REJECT with evidence-related reason when no evidence refs in hard mode", async () => {
      let llmCalled = false;
      const spyEvaluator: LlmEvaluator = async () => {
        llmCalled = true;
        return approvedLlmResult;
      };

      const result = await evaluateIntent(makeInput({
        llmEvaluator: spyEvaluator,
        evidenceRefs: [],
        evidenceEnforcementMode: "hard",
      }));

      expect(result.decision).toBe("REJECT");
      expect(result.reason.toLowerCase()).toContain("evidence");
      expect(result.policy_only).toBe(false);
      expect(llmCalled).toBe(false);
    });

    test("returns REJECT with evidence-related reason when evidenceRefs is undefined in hard mode", async () => {
      let llmCalled = false;
      const spyEvaluator: LlmEvaluator = async () => {
        llmCalled = true;
        return approvedLlmResult;
      };

      const result = await evaluateIntent(makeInput({
        llmEvaluator: spyEvaluator,
        evidenceRefs: undefined,
        evidenceEnforcementMode: "hard",
      }));

      expect(result.decision).toBe("REJECT");
      expect(result.reason.toLowerCase()).toContain("evidence");
      expect(llmCalled).toBe(false);
    });

    test("does NOT reject zero-evidence intents in soft enforcement mode", async () => {
      const result = await evaluateIntent(makeInput({
        llmEvaluator: makeLlmEvaluator(approvedLlmResult),
        evidenceRefs: [],
        evidenceEnforcementMode: "soft",
      }));

      expect(result.decision).toBe("APPROVE");
      expect(result.policy_only).toBe(false);
    });

    test("does NOT reject zero-evidence intents in bootstrap enforcement mode", async () => {
      const result = await evaluateIntent(makeInput({
        llmEvaluator: makeLlmEvaluator(approvedLlmResult),
        evidenceRefs: [],
        evidenceEnforcementMode: "bootstrap",
      }));

      expect(result.decision).toBe("APPROVE");
      expect(result.policy_only).toBe(false);
    });
  });

  describe("human requester satisfies human_veto_required", () => {
    test("human_veto_required is false when requesterType is 'human' even if policy sets it", async () => {
      // Policy with human_veto_required: true
      const vetoPolicy = {
        id: new RecordId("policy", "veto-policy"),
        title: "Require Human Veto",
        version: 1,
        status: "active",
        selector: {},
        rego_source: `package osabio.policy
default allow := true`,
        human_veto_required: true,
        created_by: mockIdentityId,
        workspace: mockWorkspaceId,
        created_at: new Date(),
      };
      const vetoPolicySurreal = {
        query: async () => [[{ policies: [vetoPolicy] }]],
      } as unknown as EvaluateIntentInput["surreal"];

      const result = await evaluateIntent(makeInput({
        surreal: vetoPolicySurreal,
        requesterType: "human",
        llmEvaluator: makeLlmEvaluator(approvedLlmResult),
      }));

      expect(result.decision).toBe("APPROVE");
      expect(result.human_veto_required).toBe(false);
    });

    test("human_veto_required is true when requesterType is 'agent' and policy sets it", async () => {
      const vetoPolicy = {
        id: new RecordId("policy", "veto-policy"),
        title: "Require Human Veto",
        version: 1,
        status: "active",
        selector: {},
        rego_source: `package osabio.policy
default allow := true`,
        human_veto_required: true,
        created_by: mockIdentityId,
        workspace: mockWorkspaceId,
        created_at: new Date(),
      };
      const vetoPolicySurreal = {
        query: async () => [[{ policies: [vetoPolicy] }]],
      } as unknown as EvaluateIntentInput["surreal"];

      const result = await evaluateIntent(makeInput({
        surreal: vetoPolicySurreal,
        requesterType: "agent",
        llmEvaluator: makeLlmEvaluator(approvedLlmResult),
      }));

      expect(result.decision).toBe("APPROVE");
      expect(result.human_veto_required).toBe(true);
    });
  });

  describe("evaluation timeout produces high-risk fallback for human review", () => {
    test("returns APPROVE with risk_score=50 and policy_only=true on timeout", async () => {
      const result = await evaluateIntent(makeInput({
        llmEvaluator: slowLlmEvaluator(5000),
        timeoutMs: 50,
      }));

      expect(result.decision).toBe("APPROVE");
      expect(result.policy_only).toBe(true);
      expect(result.risk_score).toBe(50);
      expect(result.reason).toContain("timeout");
    });
  });
});

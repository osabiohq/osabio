/**
 * PolicyTestPanel: lets admins test a policy against a mock IntentEvaluationContext.
 * Posts to POST /api/workspaces/:workspaceId/policies/:policyId/test and displays
 * the allow/deny decision with messages.
 */

import { useState } from "react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TestDecision = "allow" | "deny";

type PolicyTestResult = {
  decision: TestDecision;
  messages: string[];
  evidence_requirement?: {
    min_count: number;
    required_types: string[];
  };
};

type TestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "result"; result: PolicyTestResult }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONTEXT = JSON.stringify(
  {
    action_spec: { action: "deploy", provider: "infra", params: {} },
    behavior_scores: {},
    budget_limit: { amount: 100, currency: "USD" },
  },
  undefined,
  2,
);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function buildTestUrl(workspaceId: string, policyId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/policies/${encodeURIComponent(policyId)}/test`;
}

function parseJsonInput(raw: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, message: "Invalid JSON — please check the input and try again." };
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DecisionBadge({ decision }: { decision: TestDecision }) {
  return (
    <Badge variant={decision === "allow" ? "default" : "destructive"}>
      {decision === "allow" ? "ALLOW" : "DENY"}
    </Badge>
  );
}

function TestResultView({ result }: { result: PolicyTestResult }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">Decision:</span>
        <DecisionBadge decision={result.decision} />
      </div>

      {result.messages.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Messages</span>
          <ul className="flex flex-col gap-1">
            {result.messages.map((message, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list from server
              <li key={index} className="rounded-md bg-background px-3 py-1.5 text-xs text-foreground">
                {message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.evidence_requirement && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Evidence Requirement</span>
          <div className="rounded-md bg-background px-3 py-1.5 text-xs text-foreground">
            <span>Min count: {result.evidence_requirement.min_count}</span>
            {result.evidence_requirement.required_types.length > 0 && (
              <span className="ml-2 text-muted-foreground">
                Types: {result.evidence_requirement.required_types.join(", ")}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PolicyTestPanel({ policyId, workspaceId }: { policyId: string; workspaceId: string }) {
  const [contextJson, setContextJson] = useState(DEFAULT_CONTEXT);
  const [testState, setTestState] = useState<TestState>({ kind: "idle" });

  const isLoading = testState.kind === "loading";

  async function handleTest() {
    const parsed = parseJsonInput(contextJson);
    if (!parsed.ok) {
      setTestState({ kind: "error", message: parsed.message });
      return;
    }

    setTestState({ kind: "loading" });

    try {
      const response = await fetch(buildTestUrl(workspaceId, policyId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: parsed.value }),
      });

      if (!response.ok) {
        let errorMessage: string;
        const body = await response.text();
        try {
          const parsed = JSON.parse(body) as { error?: string };
          errorMessage = parsed.error ?? body;
        } catch {
          errorMessage = body || `Request failed (${response.status})`;
        }
        setTestState({ kind: "error", message: errorMessage });
        return;
      }

      const result = (await response.json()) as PolicyTestResult;
      setTestState({ kind: "result", result });
    } catch {
      setTestState({ kind: "error", message: "Network error — check your connection and try again." });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-foreground">Test Policy</h3>

      <div className="flex flex-col gap-2">
        <label htmlFor="policy-test-context" className="text-xs font-medium text-muted-foreground">
          IntentEvaluationContext (JSON)
        </label>
        <textarea
          id="policy-test-context"
          value={contextJson}
          onChange={(e) => setContextJson(e.target.value)}
          rows={10}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          disabled={isLoading}
          spellCheck={false}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={() => void handleTest()}
          disabled={isLoading || contextJson.trim().length === 0}
        >
          {isLoading ? "Testing..." : "Run Test"}
        </Button>
        {testState.kind !== "idle" && !isLoading && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTestState({ kind: "idle" })}
          >
            Clear
          </Button>
        )}
      </div>

      {testState.kind === "error" && (
        <p className="text-sm text-destructive">{testState.message}</p>
      )}

      {testState.kind === "result" && (
        <TestResultView result={testState.result} />
      )}
    </div>
  );
}

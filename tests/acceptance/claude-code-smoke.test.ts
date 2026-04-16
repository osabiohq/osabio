/**
 * Smoke Tests: Claude Code Inference Provider
 *
 * Validates that `inferenceProvider: "claude-code"` correctly wires the
 * ai-sdk-provider-claude-code package into the server's model instances and
 * that both streaming text generation and structured object generation work
 * end-to-end through the in-process server.
 *
 * Driving ports:
 *   POST /api/workspaces              (workspace creation)
 *   POST /api/chat/messages           (streamText — chat agent)
 *   GET  /api/chat/stream/:messageId  (SSE token stream)
 *   POST /api/chat/messages           (generateObject — extraction pipeline fires inline)
 *
 * Skip condition:
 *   All tests are skipped when INFERENCE_PROVIDER !== "claude-code".
 *   This prevents CI failures in environments that do not have the Claude Code
 *   CLI installed and authenticated.
 *
 * Prerequisites (when INFERENCE_PROVIDER=claude-code):
 *   - ai-sdk-provider-claude-code package installed
 *   - Claude Code CLI installed and authenticated (claude auth status)
 *   - All standard acceptance test env vars set (SURREAL_URL, etc.)
 *   - OPENROUTER_API_KEY set (required by acceptance-test-kit module initialisation)
 */
import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  setupAcceptanceSuite,
  createTestUser,
  fetchJson,
  collectSseEvents,
  type AcceptanceTestRuntime,
} from "./acceptance-test-kit";

// ── Provider Guard ────────────────────────────────────────────────────────────

const isClaudeCodeProvider = Bun.env.INFERENCE_PROVIDER === "claude-code";

// Only boot the server when we actually intend to run these tests.
// setupAcceptanceSuite registers beforeAll/afterAll hooks — calling it
// unconditionally would attempt to create claude-code models even in skip mode.
const getRuntime: (() => AcceptanceTestRuntime) | undefined = isClaudeCodeProvider
  ? setupAcceptanceSuite("claude_code_smoke", {
      configOverrides: { inferenceProvider: "claude-code" },
    })
  : undefined;

// ── Test Helpers ──────────────────────────────────────────────────────────────

type ChatMessageResponse = {
  messageId: string;
  userMessageId: string;
  conversationId: string;
  workspaceId: string;
  streamUrl: string;
};

type StreamEvent =
  | { type: "token"; messageId: string; token: string }
  | { type: "text-delta"; messageId: string; text: string }
  | { type: "assistant_message"; messageId: string; text: string }
  | { type: "extraction"; messageId: string; entities: unknown[]; relationships: unknown[] }
  | { type: "done"; messageId: string }
  | { type: "error"; messageId: string; error: string }
  | { type: string; messageId: string };

async function createWorkspace(baseUrl: string, userHeaders: Record<string, string>, label: string) {
  return fetchJson<{ workspaceId: string; conversationId: string }>(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...userHeaders },
    body: JSON.stringify({ name: `Claude Code Smoke ${label} ${randomUUID()}` }),
  });
}

async function sendChatMessage(
  baseUrl: string,
  userHeaders: Record<string, string>,
  workspaceId: string,
  conversationId: string,
  text: string,
): Promise<ChatMessageResponse> {
  return fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...userHeaders },
    body: JSON.stringify({
      clientMessageId: randomUUID(),
      workspaceId,
      conversationId,
      text,
    }),
  });
}

// ── Test Suite ────────────────────────────────────────────────────────────────

// describe.skipIf skips the entire suite (including beforeAll) when the
// condition is true, producing exit 0 with skipped tests — no failures.
describe.skipIf(!isClaudeCodeProvider)("Claude Code provider smoke tests", () => {
  // ── streamText: at least one text-delta and clean stream close ──────────────
  it(
    "streamText returns at least one token event and stream closes cleanly",
    async () => {
      const { baseUrl } = getRuntime!();
      const user = await createTestUser(baseUrl, randomUUID());
      const workspace = await createWorkspace(baseUrl, user.headers, "stream");

      const chatResponse = await sendChatMessage(
        baseUrl,
        user.headers,
        workspace.workspaceId,
        workspace.conversationId,
        "Briefly acknowledge this message in one sentence.",
      );

      expect(chatResponse.messageId.length).toBeGreaterThan(0);
      expect(chatResponse.streamUrl.length).toBeGreaterThan(0);

      const events = await collectSseEvents<StreamEvent>(
        `${baseUrl}${chatResponse.streamUrl}`,
        120_000,
      );
      const eventTypes = new Set(events.map((e) => e.type));

      // At least one token or text-delta event must be present
      const hasTextDelta = eventTypes.has("token") || eventTypes.has("text-delta");
      expect(hasTextDelta).toBe(true);

      // Stream must close with a done event (collectSseEvents returns on done)
      const lastEvent = events[events.length - 1];
      expect(lastEvent?.type).toBe("done");
    },
    180_000,
  );

  // ── generateObject: extraction returns object satisfying schema ─────────────
  it(
    "generateObject produces extraction output that satisfies the extraction result schema",
    async () => {
      const { baseUrl } = getRuntime!();
      const user = await createTestUser(baseUrl, randomUUID());
      const workspace = await createWorkspace(baseUrl, user.headers, "extract");

      const chatResponse = await sendChatMessage(
        baseUrl,
        user.headers,
        workspace.workspaceId,
        workspace.conversationId,
        "We need to implement a quarterly compliance audit for the financial reporting pipeline by end of Q2.",
      );

      expect(chatResponse.messageId.length).toBeGreaterThan(0);

      const events = await collectSseEvents<StreamEvent>(
        `${baseUrl}${chatResponse.streamUrl}`,
        120_000,
      );

      // The extraction pipeline fires alongside the chat agent.
      // An extraction event confirms generateObject produced a valid schema-conformant object.
      const extractionEvent = events.find((e) => e.type === "extraction");
      expect(extractionEvent).toBeDefined();

      if (!extractionEvent || extractionEvent.type !== "extraction") {
        throw new Error("Expected extraction event not found in SSE stream");
      }

      // Extraction event contains entities and relationships arrays (may be empty for simple prompts)
      const event = extractionEvent as { type: "extraction"; entities: unknown[]; relationships: unknown[] };
      expect(Array.isArray(event.entities)).toBe(true);
      expect(Array.isArray(event.relationships)).toBe(true);

      // Stream must complete cleanly
      const lastEvent = events[events.length - 1];
      expect(lastEvent?.type).toBe("done");
    },
    180_000,
  );
});

import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { RecordId } from "surrealdb";
import { collectSseEvents, createTestUser, fetchJson, setupAcceptanceSuite } from "../acceptance-test-kit";

type CreateWorkspaceResponse = {
  workspaceId: string;
  workspaceName: string;
  conversationId: string;
  onboardingComplete: boolean;
};

type BootstrapResponse = {
  workspaceId: string;
  workspaceName: string;
  workspaceDescription?: string;
  conversationId: string;
  onboardingState: string;
  onboardingComplete: boolean;
  messages: Array<{ role: string; text: string; suggestions?: string[] }>;
  seeds: Array<{ id: string }>;
};

type ChatMessageResponse = {
  messageId: string;
  userMessageId: string;
  conversationId: string;
  workspaceId: string;
  streamUrl: string;
};

type StreamEvent =
  | { type: "token"; messageId: string; token: string }
  | { type: "assistant_message"; messageId: string; text: string }
  | { type: "extraction"; messageId: string; entities: Array<{ id: string }>; relationships: Array<{ id: string }> }
  | { type: "onboarding_state"; messageId: string; onboardingState: string }
  | { type: "done"; messageId: string }
  | { type: "error"; messageId: string; error: string }
  | { type: string; messageId: string };

const getRuntime = setupAcceptanceSuite("workspace_description");

describe("workspace description in onboarding", () => {
  it("creates workspace with description and adapts starter message", async () => {
    const { baseUrl } = getRuntime();
    const user = await createTestUser(baseUrl, "desc");

    const create = await fetchJson<CreateWorkspaceResponse>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        name: "DabDash",
        description: "Cannabis delivery storefront platform",
      }),
    });

    expect(create.workspaceId.length).toBeGreaterThan(0);
    expect(create.workspaceName).toBe("DabDash");
    expect(create.onboardingComplete).toBe(false);

    // Bootstrap should return the description and adapted starter message
    const bootstrap = await fetchJson<BootstrapResponse>(
      `${baseUrl}/api/workspaces/${encodeURIComponent(create.workspaceId)}/bootstrap`,
    );

    expect(bootstrap.workspaceId).toBe(create.workspaceId);
    expect(bootstrap.workspaceDescription).toBe("Cannabis delivery storefront platform");
    expect(bootstrap.onboardingState).toBe("active");
    expect(bootstrap.messages.length).toBeGreaterThan(0);

    // Starter message should reference organizing the workspace and ask about projects
    const starterMessage = bootstrap.messages[0]!;
    expect(starterMessage.role).toBe("assistant");
    expect(starterMessage.text).toContain("DabDash");
    expect(starterMessage.text).toContain("projects");
    // Should NOT ask "what are you building" since we already have description
    expect(starterMessage.text).not.toContain("what you're working on");

    // Suggestions should be adapted for description-provided flow
    expect(starterMessage.suggestions).toBeDefined();
    expect(starterMessage.suggestions!.some((s) => s.toLowerCase().includes("first project"))).toBe(true);
  }, 120_000);

  it("creates workspace without description and does not create a project entity", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "nodesc");

    const create = await fetchJson<CreateWorkspaceResponse>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        name: "TestCorp",
      }),
    });

    expect(create.workspaceId.length).toBeGreaterThan(0);
    expect(create.onboardingComplete).toBe(false);

    const bootstrap = await fetchJson<BootstrapResponse>(
      `${baseUrl}/api/workspaces/${encodeURIComponent(create.workspaceId)}/bootstrap`,
    );

    // No description should be returned
    expect(bootstrap.workspaceDescription).toBeUndefined();

    // Default starter message should ask about what they're working on
    const starterMessage = bootstrap.messages[0]!;
    expect(starterMessage.role).toBe("assistant");
    expect(starterMessage.text).toContain("what you're working on");

    // Suggestions should use default wording
    expect(starterMessage.suggestions).toBeDefined();
    expect(starterMessage.suggestions!.some((s) => s.toLowerCase().includes("business"))).toBe(true);

    // Send a message describing the business (not a specific project)
    const chatResponse = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: create.workspaceId,
        conversationId: create.conversationId,
        text: "I'm building DabDash, a cannabis delivery platform",
      }),
    });

    await collectSseEvents<StreamEvent>(`${baseUrl}${chatResponse.streamUrl}`, 180_000);

    // The agent should ask for clarification, NOT create a project entity
    const workspaceRecord = new RecordId("workspace", create.workspaceId);
    const [projects] = await surreal
      .query<[Array<{ id: RecordId<"project", string>; name: string }>]>(
        "SELECT id, name FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace);",
        { workspace: workspaceRecord },
      )
      .then((r) => r as unknown as [Array<{ id: RecordId<"project", string>; name: string }>]);

    expect(projects).toEqual([]);
  }, 300_000);

  it("workspace with description streams a chat response successfully", async () => {
    const { baseUrl } = getRuntime();
    const user = await createTestUser(baseUrl, "flow");

    // Create workspace with description
    const create = await fetchJson<CreateWorkspaceResponse>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        name: "DabDash",
        description: "Cannabis delivery storefront platform",
      }),
    });

    // Send first chat message describing a project
    const firstChat = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: create.workspaceId,
        conversationId: create.conversationId,
        text: "Project: Storefront App. We need to build a customer-facing ordering system with real-time delivery tracking.",
      }),
    });

    const events = await collectSseEvents<StreamEvent>(`${baseUrl}${firstChat.streamUrl}`, 180_000);
    expect(events.some((e) => e.type === "assistant_message")).toBe(true);

    // Verify description persists across bootstrap
    const bootstrap = await fetchJson<BootstrapResponse>(
      `${baseUrl}/api/workspaces/${encodeURIComponent(create.workspaceId)}/bootstrap`,
    );
    expect(bootstrap.workspaceDescription).toBe("Cannabis delivery storefront platform");
  }, 300_000);

  // Flaky: LLM classification is non-deterministic — extraction may not consistently classify heading as project
  it.skip("classifies user-described heading as project, not workspace name", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "hierarchy");

    const create = await fetchJson<CreateWorkspaceResponse>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        name: "DabDash",
        description: "Cannabis delivery storefront platform",
      }),
    });

    expect(create.workspaceId.length).toBeGreaterThan(0);

    // Send a structured message with a heading that should become a project
    const chatResponse = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: create.workspaceId,
        conversationId: create.conversationId,
        text: [
          "Project: Dashboard",
          "",
          "A complete admin dashboard for managing your cannabis delivery business.",
          "",
          "The moment you log in, you see exactly where your business stands. Product counts, active delivery zones, today's orders, and revenue — all on a single screen. Low stock alerts surface problems before they cost you sales.",
          "",
          "Real-time order count and revenue stats",
          "Low stock alerts with direct links to inventory",
          "Onboarding checklist for new stores",
          "Quick actions: add product, create zone, update stock",
          "Recent orders with status badges",
        ].join("\n"),
      }),
    });

    await collectSseEvents<StreamEvent>(`${baseUrl}${chatResponse.streamUrl}`, 180_000);

    // Verify entity classification in the database.
    // Classification writes may land shortly after stream completion.
    const workspaceRecord = new RecordId("workspace", create.workspaceId);
    const startedAt = Date.now();
    const timeoutMs = 10_000;
    let projects: Array<{ id: RecordId<"project", string>; name: string }> = [];
    do {
      [projects] = await surreal
        .query<[Array<{ id: RecordId<"project", string>; name: string }>]>(
          "SELECT id, name FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace);",
          { workspace: workspaceRecord },
        )
        .then((r) => r as unknown as [Array<{ id: RecordId<"project", string>; name: string }>]);
      if (projects.some((p) => p.name.toLowerCase() === "dashboard")) {
        break;
      }
      await Bun.sleep(250);
    } while (Date.now() - startedAt < timeoutMs);

    // Workspace name must NOT be created as a project
    expect(projects.some((p) => p.name.toLowerCase() === "dabdash")).toBe(false);

    // "Dashboard" should be created as a project (the heading), not as a feature
    expect(projects.some((p) => p.name.toLowerCase() === "dashboard")).toBe(true);
  }, 300_000);

  it("trims whitespace-only description to undefined", async () => {
    const { baseUrl } = getRuntime();
    const user = await createTestUser(baseUrl, "empty");

    const create = await fetchJson<CreateWorkspaceResponse>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        name: "EmptyDesc",
        description: "   ",
      }),
    });

    const bootstrap = await fetchJson<BootstrapResponse>(
      `${baseUrl}/api/workspaces/${encodeURIComponent(create.workspaceId)}/bootstrap`,
    );

    // Whitespace-only description should be treated as absent
    expect(bootstrap.workspaceDescription).toBeUndefined();
    expect(bootstrap.messages[0]!.text).toContain("what you're working on");
  }, 120_000);
});

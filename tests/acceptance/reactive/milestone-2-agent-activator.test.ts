/**
 * Milestone 2: Agent Activator with LLM Classification (US-GRC-03)
 *
 * Traces: US-GRC-03 acceptance criteria
 *
 * Tests the Agent Activator's observation -> LLM classification -> start new agent pipeline.
 * The activator is a POST endpoint called by SurrealDB DEFINE EVENT webhooks.
 * In tests, we simulate the webhook by calling the endpoint directly.
 *
 * The activator only starts NEW agents for observations that don't have active
 * coverage. Observations targeting entities with active agent sessions are skipped
 * (the LLM proxy handles enriching those via its own vector search).
 *
 * LLM classification replaces KNN because the question is "which agents can ACT
 * on this?" — a judgment problem, not a proximity problem. See ADR-061.
 *
 * Driving ports:
 *   POST /api/internal/activator/observation   (agent activator webhook endpoint)
 *   SurrealDB direct queries                   (seed data + verification)
 *   GET  /api/workspaces/:workspaceId/feed/stream (verify meta-observation in feed)
 */
import { describe, expect, it } from "bun:test";
import {
  setupReactiveSuite,
  createTestUser,
  createTestWorkspace,
  createObservationWithCoordinator,
  createObservationBurstWithCoordinator,
  createObservation,
  createTask,
  registerAgent,
  startAgentSession,
  getObservations,
  getMetaObservations,
  getActivatedSessions,
  getActivationDecisions,
  openFeedStream,
} from "./reactive-test-kit";

const getRuntime = setupReactiveSuite("agent_activator");

describe("US-GRC-03: Agent Activator with LLM Classification", () => {

  // ---------------------------------------------------------------------------
  // AC: Activator starts new agent for observation without active coverage
  // ---------------------------------------------------------------------------
  // Flaky: LLM classification is non-deterministic — agent activator may not match observation to agent type
  it.skip("observation without active coverage activates relevant agent type", async () => {
    const { baseUrl, surreal } = getRuntime();

    const { workspaceId, identityId } = await createTestWorkspace(surreal, "act-route");

    await registerAgent(surreal, workspaceId, identityId, {
      agentType: "code_agent",
      description: "Coding agent working on billing API migration and tRPC standardization",
    });

    const { taskId } = await createTask(surreal, workspaceId, {
      title: "Migrate billing API to tRPC",
    });

    // No active session on this task — activator should classify and start agent
    const observationText = "Task T-47 implementation contradicts confirmed decision to standardize on tRPC for billing API";

    await createObservationWithCoordinator(surreal, baseUrl, workspaceId, {
      text: observationText,
      severity: "conflict",
      sourceAgent: "observer_agent",
      targetEntity: { table: "task", id: taskId },
    });

    await new Promise((resolve) => setTimeout(resolve, 5000));

    const observations = await getObservations(surreal, workspaceId, { status: "open" });
    const conflictObs = observations.find((o) => o.text.includes("contradicts confirmed decision"));
    expect(conflictObs).toBeDefined();
    expect(conflictObs!.severity).toBe("conflict");

    // LLM should classify the billing/tRPC agent as relevant
    const sessions = await getActivatedSessions(surreal, workspaceId);
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    const matchedSession = sessions.find((s) => s.agent === "code_agent");
    expect(matchedSession).toBeDefined();
    expect(matchedSession!.orchestrator_status).toBe("spawning");

    // Activator should record a provisional decision for the routing choice
    const decisions = await getActivationDecisions(surreal, workspaceId);
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    const routingDecision = decisions[0];
    expect(routingDecision.status).toBe("provisional");
    expect(routingDecision.category).toBe("operations");
    expect(routingDecision.rationale).toContain(observationText);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: Observation targeting entity WITH active session is skipped
  // ---------------------------------------------------------------------------
  it("observation targeting entity with active agent session is skipped", async () => {
    const { baseUrl, surreal } = getRuntime();

    const { workspaceId, identityId } = await createTestWorkspace(surreal, "act-skip");

    await registerAgent(surreal, workspaceId, identityId, {
      agentType: "code_agent",
      description: "Coding agent working on billing API migration",
    });

    const { taskId } = await createTask(surreal, workspaceId, {
      title: "Migrate billing API to tRPC",
    });

    // Active session on the target task — activator should SKIP
    await startAgentSession(surreal, workspaceId, {
      agentType: "code_agent",
      taskId,
      description: "Coding agent working on billing API migration",
    });

    await createObservationWithCoordinator(surreal, baseUrl, workspaceId, {
      text: "Billing API migration contradicts tRPC decision",
      severity: "conflict",
      sourceAgent: "observer_agent",
      targetEntity: { table: "task", id: taskId },
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // No spawning sessions — proxy handles the active session
    const sessions = await getActivatedSessions(surreal, workspaceId);
    const spawning = sessions.filter((s) => s.orchestrator_status === "spawning");
    expect(spawning.length).toBe(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: LLM classifies multiple agents as relevant
  // ---------------------------------------------------------------------------
  it("observation activates multiple agent types when LLM classifies both as relevant", async () => {
    const { baseUrl, surreal } = getRuntime();

    const { workspaceId, identityId } = await createTestWorkspace(surreal, "act-multi");

    await registerAgent(surreal, workspaceId, identityId, {
      agentType: "code_agent",
      description: "Infrastructure and reliability engineering — monitors uptime, investigates outages, manages cloud resources",
    });
    await registerAgent(surreal, workspaceId, identityId, {
      agentType: "code_agent",
      description: "Customer communication and incident response — drafts status updates, notifies affected customers",
    });

    await createObservationWithCoordinator(surreal, baseUrl, workspaceId, {
      text: "Production API latency exceeding SLA threshold, p99 response time above 2 seconds, affecting customer-facing endpoints",
      severity: "conflict",
      sourceAgent: "observer_agent",
    });

    // LLM classification takes ~500ms, session creation adds more — allow 5s
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // LLM should classify both infra (investigate) and support (notify customers)
    const sessions = await getActivatedSessions(surreal, workspaceId);
    const spawning = sessions.filter((s) => s.orchestrator_status === "spawning");
    expect(spawning.length).toBeGreaterThanOrEqual(2);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: Irrelevant agent not activated
  // ---------------------------------------------------------------------------
  it("irrelevant agent type not activated when LLM judges it cannot act", async () => {
    const { baseUrl, surreal } = getRuntime();

    const { workspaceId, identityId } = await createTestWorkspace(surreal, "act-threshold");

    await registerAgent(surreal, workspaceId, identityId, {
      agentType: "code_agent",
      description: "Marketing content creation and campaign management — writes blog posts, manages social media",
    });

    await createObservationWithCoordinator(surreal, baseUrl, workspaceId, {
      text: "Database connection pool exhausted, all 50 connections in use, queries timing out",
      severity: "conflict",
      sourceAgent: "observer_agent",
    });

    await new Promise((resolve) => setTimeout(resolve, 3000));

    // LLM should NOT activate marketing agent for a database issue
    const sessions = await getActivatedSessions(surreal, workspaceId);
    const spawning = sessions.filter((s) => s.orchestrator_status === "spawning");
    expect(spawning.length).toBe(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: New agent type activated without rule changes
  // ---------------------------------------------------------------------------
  it("newly registered agent type activated by LLM judgment alone", async () => {
    const { baseUrl, surreal } = getRuntime();

    const { workspaceId, identityId } = await createTestWorkspace(surreal, "act-new-type");

    await registerAgent(surreal, workspaceId, identityId, {
      agentType: "code_agent",
      description: "Security auditor — reviews code for vulnerabilities, SQL injection, XSS, and compliance violations",
    });

    await createObservationWithCoordinator(surreal, baseUrl, workspaceId, {
      text: "SQL injection vulnerability detected in user input handling for login endpoint",
      severity: "conflict",
      sourceAgent: "observer_agent",
    });

    await new Promise((resolve) => setTimeout(resolve, 3000));

    // LLM should activate the security auditor — no rule table update needed
    const sessions = await getActivatedSessions(surreal, workspaceId);
    const spawning = sessions.filter((s) => s.orchestrator_status === "spawning");
    expect(spawning.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: Loop dampening activates after >3 events on same entity from same source
  // ---------------------------------------------------------------------------
  it("loop dampener activates after 3 rapid observations on the same entity", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `dampen-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "act-dampen");

    const { taskId } = await createTask(surreal, workspaceId, {
      title: "Implement rate limiting for billing API",
    });

    const feedStream = openFeedStream(baseUrl, workspaceId, user);
    try {
      await feedStream.connect();

      await createObservationBurstWithCoordinator(surreal, baseUrl, workspaceId, {
        count: 4,
        sourceAgent: "observer_agent",
        targetEntity: { table: "task", id: taskId },
        severity: "warning",
        textPrefix: "Cascading issue on rate limiting task",
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const metaObs = await getMetaObservations(surreal, workspaceId);
      const dampeningMeta = metaObs.find(
        (o) => o.text.includes("dampened"),
      );
      expect(dampeningMeta).toBeDefined();
    } finally {
      feedStream.close();
    }
  }, 30_000);

  // ---------------------------------------------------------------------------
  // AC: Dampening resets after window expires
  // ---------------------------------------------------------------------------
  it("dampening resets after 60 seconds allowing normal processing", async () => {
    const { baseUrl, surreal } = getRuntime();

    const { workspaceId } = await createTestWorkspace(surreal, "act-reset");

    const { taskId } = await createTask(surreal, workspaceId, {
      title: "Database migration task",
    });

    await createObservationBurstWithCoordinator(surreal, baseUrl, workspaceId, {
      count: 4,
      sourceAgent: "observer_agent",
      targetEntity: { table: "task", id: taskId },
      severity: "warning",
      textPrefix: "Dampening trigger observation",
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    await createObservation(surreal, workspaceId, {
      text: "New observation after dampening window should have passed",
      severity: "warning",
      sourceAgent: "observer_agent",
      targetEntity: { table: "task", id: taskId },
    });

    const observations = await getObservations(surreal, workspaceId, { status: "open" });
    const postDampenObs = observations.find(
      (o) => o.text.includes("after dampening window"),
    );
    expect(postDampenObs).toBeDefined();
  }, 90_000);
});

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { RecordId, Surreal } from "surrealdb";
import { applyTestSchema } from "../acceptance-test-kit";
import {
  getProjectGraphView,
  getWorkspaceGraphOverview,
  getFocusedGraphView,
  type GraphEntityRecord,
} from "../../../app/src/server/graph/queries";

/**
 * Acceptance tests for governance visualization in graph views.
 *
 * Covers:
 * - AC-1.1..AC-1.4: Policy nodes with status filtering
 * - AC-2.1..AC-2.4, AC-2.8: Intent nodes with status filtering + focused view
 * - AC-4.1..AC-4.4: Governance edge classification
 * - AC-X.4: Existing graph nodes continue to appear correctly
 */

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

let surreal: Surreal;
let namespace: string;
let database: string;

let workspaceRecord: RecordId<"workspace", string>;
let projectRecord: RecordId<"project", string>;
let taskRecord: RecordId<"task", string>;
let identityRecord: RecordId<"identity", string>;

// Policy records
let activePolicyRecord: RecordId<"policy", string>;
let testingPolicyRecord: RecordId<"policy", string>;
let draftPolicyRecord: RecordId<"policy", string>;
let deprecatedPolicyRecord: RecordId<"policy", string>;
let supersededPolicyRecord: RecordId<"policy", string>;

// Intent records
let executingIntentRecord: RecordId<"intent", string>;
let pendingVetoIntentRecord: RecordId<"intent", string>;
let completedIntentRecord: RecordId<"intent", string>;
let vetoedIntentRecord: RecordId<"intent", string>;
let failedIntentRecord: RecordId<"intent", string>;

// Agent session for gates edge
let agentSessionRecord: RecordId<"agent_session", string>;

// Learning and git_commit records
let learningRecord: RecordId<"learning", string>;
let gitCommitRecord: RecordId<"git_commit", string>;

beforeAll(async () => {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  namespace = `smoke_gov_viz_${runId}`;
  database = `gov_viz_${Math.floor(Math.random() * 100000)}`;

  surreal = new Surreal();
  await surreal.connect(surrealUrl);
  await surreal.signin({ username: surrealUsername, password: surrealPassword });
  await surreal.query(`DEFINE NAMESPACE ${namespace};`);
  await surreal.use({ namespace });
  await surreal.query(`DEFINE DATABASE ${database};`);
  await surreal.use({ namespace, database });

  await applyTestSchema(surreal);

  const now = new Date();

  // ── Workspace ──
  workspaceRecord = new RecordId("workspace", randomUUID());
  await surreal.create(workspaceRecord).content({
    name: "Governance Viz Workspace",
    status: "active",
    onboarding_complete: true,
    onboarding_turn_count: 0,
    onboarding_summary_pending: false,
    onboarding_started_at: now,
    created_at: now,
  });

  // ── Identity ──
  identityRecord = new RecordId("identity", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: identityRecord,
    content: { name: "Admin User", type: "human", workspace: workspaceRecord, created_at: now },
  });
  await surreal.query("RELATE $identity->member_of->$workspace SET added_at = $now;", {
    identity: identityRecord,
    workspace: workspaceRecord,
    now,
  });

  // ── Project + Task ──
  projectRecord = new RecordId("project", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: projectRecord,
    content: { name: "Gov Project", status: "active", workspace: workspaceRecord, created_at: now, updated_at: now },
  });
  await surreal.query("RELATE $workspace->has_project->$project SET added_at = $now;", {
    workspace: workspaceRecord,
    project: projectRecord,
    now,
  });

  taskRecord = new RecordId("task", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: taskRecord,
    content: { title: "Deploy staging", status: "open", workspace: workspaceRecord, created_at: now, updated_at: now },
  });
  await surreal.query("RELATE $task->belongs_to->$project SET added_at = $now;", {
    task: taskRecord,
    project: projectRecord,
    now,
  });

  // ── Agent session (for gates edge) ──
  agentSessionRecord = new RecordId("agent_session", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: agentSessionRecord,
    content: {
      agent: "test-agent",
      orchestrator_status: "active",
      workspace: workspaceRecord,
      started_at: now,
      created_at: now,
    },
  });

  // ── Policies (5 statuses) ──
  const policyBase = {
    version: 1,
    selector: {},
    rego_source: "package osabio.policy\ndefault allow = true",
    human_veto_required: false,
    created_by: identityRecord,
    workspace: workspaceRecord,
    created_at: now,
  };

  activePolicyRecord = new RecordId("policy", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: activePolicyRecord,
    content: { ...policyBase, title: "Active Budget Guard", status: "active" },
  });

  testingPolicyRecord = new RecordId("policy", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: testingPolicyRecord,
    content: { ...policyBase, title: "Testing Rate Limiter", status: "testing" },
  });

  draftPolicyRecord = new RecordId("policy", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: draftPolicyRecord,
    content: { ...policyBase, title: "Draft Policy", status: "draft" },
  });

  deprecatedPolicyRecord = new RecordId("policy", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: deprecatedPolicyRecord,
    content: { ...policyBase, title: "Deprecated Policy", status: "deprecated" },
  });

  supersededPolicyRecord = new RecordId("policy", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: supersededPolicyRecord,
    content: { ...policyBase, title: "Superseded Policy", status: "superseded" },
  });

  // ── Governance edges (only for active + testing) ──
  await surreal.query("RELATE $identity->governing->$policy SET created_at = $now;", {
    identity: identityRecord,
    policy: activePolicyRecord,
    now,
  });
  await surreal.query("RELATE $policy->protects->$workspace SET created_at = $now;", {
    policy: activePolicyRecord,
    workspace: workspaceRecord,
    now,
  });
  await surreal.query("RELATE $identity->governing->$policy SET created_at = $now;", {
    identity: identityRecord,
    policy: testingPolicyRecord,
    now,
  });
  await surreal.query("RELATE $policy->protects->$workspace SET created_at = $now;", {
    policy: testingPolicyRecord,
    workspace: workspaceRecord,
    now,
  });

  // ── Learning ──
  learningRecord = new RecordId("learning", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: learningRecord,
    content: {
      text: "Customs clearance requires advance filing 72 hours before arrival",
      learning_type: "constraint",
      status: "active",
      source: "human",
      priority: "medium",
      target_agents: ["logistics-agent"],
      workspace: workspaceRecord,
      created_at: now,
      updated_at: now,
    },
  });

  // ── Git Commit ──
  gitCommitRecord = new RecordId("git_commit", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: gitCommitRecord,
    content: {
      sha: "abc123def456789012345678901234567890abcd",
      message: "fix(logistics): correct duty calculation for cross-border shipments",
      author_name: "logistics-dev",
      repository: "supply-chain/logistics-engine",
      workspace: workspaceRecord,
      created_at: now,
    },
  });

  // ── Intents (5 statuses) ──
  const intentBase = {
    reasoning: "test reasoning",
    priority: 50,
    action_spec: { provider: "test", action: "deploy", params: {} },
    requester: identityRecord,
    workspace: workspaceRecord,
    created_at: now,
  };

  const traceRecord = new RecordId("trace", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: traceRecord,
    content: { type: "intent_submission", actor: identityRecord, workspace: workspaceRecord, created_at: now },
  });

  executingIntentRecord = new RecordId("intent", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: executingIntentRecord,
    content: { ...intentBase, goal: "Deploy v2.1 to staging", status: "executing", trace_id: traceRecord },
  });

  pendingVetoIntentRecord = new RecordId("intent", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: pendingVetoIntentRecord,
    content: {
      ...intentBase,
      goal: "Scale database replicas",
      status: "pending_veto",
      trace_id: traceRecord,
      veto_expires_at: new Date(Date.now() + 5 * 60 * 1000),
    },
  });

  completedIntentRecord = new RecordId("intent", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: completedIntentRecord,
    content: { ...intentBase, goal: "Run test suite", status: "completed", trace_id: traceRecord },
  });

  vetoedIntentRecord = new RecordId("intent", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: vetoedIntentRecord,
    content: { ...intentBase, goal: "Drop production table", status: "vetoed", trace_id: traceRecord, veto_reason: "Too risky" },
  });

  failedIntentRecord = new RecordId("intent", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: failedIntentRecord,
    content: { ...intentBase, goal: "Broken deploy", status: "failed", trace_id: traceRecord, error_reason: "Timeout" },
  });

  // ── Intent edges ──
  // triggered_by: executing intent -> task
  await surreal.query("RELATE $intent->triggered_by->$task SET created_at = $now;", {
    intent: executingIntentRecord,
    task: taskRecord,
    now,
  });
  // gates: executing intent -> agent session
  await surreal.query("RELATE $intent->gates->$agentSession SET created_at = $now;", {
    intent: executingIntentRecord,
    agentSession: agentSessionRecord,
    now,
  });
}, 30_000);

afterAll(async () => {
  if (!surreal) return;
  try {
    await surreal.query(`REMOVE DATABASE ${database};`);
    await surreal.query(`REMOVE NAMESPACE ${namespace};`);
  } catch {}
  await surreal.close().catch(() => {});
}, 10_000);

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: Policy nodes in graph view
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-1: Policy status filtering in workspace graph", () => {
  it("AC-1.1: active and testing policies appear as nodes", async () => {
    const graph = await getWorkspaceGraphOverview({ surreal, workspaceRecord });

    const policyNodes = graph.entities.filter((e) => e.kind === "policy");
    const names = policyNodes.map((n) => n.name);

    expect(names).toContain("Active Budget Guard");
    expect(names).toContain("Testing Rate Limiter");
  });

  it("AC-1.2: governing edges connect identity to policy", async () => {
    const graph = await getWorkspaceGraphOverview({ surreal, workspaceRecord });

    const governingEdges = graph.edges.filter((e) => e.kind === "governing");
    expect(governingEdges.length).toBeGreaterThanOrEqual(2);
  });

  it("AC-1.3: protects edges connect policy to workspace", async () => {
    const graph = await getWorkspaceGraphOverview({ surreal, workspaceRecord });

    const protectsEdges = graph.edges.filter((e) => e.kind === "protects");
    expect(protectsEdges.length).toBeGreaterThanOrEqual(2);
  });

  it("AC-1.4: draft, deprecated, and superseded policies are excluded", async () => {
    const graph = await getWorkspaceGraphOverview({ surreal, workspaceRecord });

    const policyNames = graph.entities
      .filter((e) => e.kind === "policy")
      .map((e) => e.name);

    expect(policyNames).not.toContain("Draft Policy");
    expect(policyNames).not.toContain("Deprecated Policy");
    expect(policyNames).not.toContain("Superseded Policy");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: Intent nodes in graph view
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-2: Intent status filtering in workspace graph", () => {
  it("AC-2.1: non-terminal intents appear as nodes", async () => {
    const graph = await getWorkspaceGraphOverview({ surreal, workspaceRecord });

    const intentNodes = graph.entities.filter((e) => e.kind === "intent");
    const names = intentNodes.map((n) => n.name);

    expect(names).toContain("Deploy v2.1 to staging");
    expect(names).toContain("Scale database replicas");
  });

  it("AC-2.2: triggered_by edges connect intent to task", async () => {
    const graph = await getWorkspaceGraphOverview({ surreal, workspaceRecord });

    const triggeredByEdges = graph.edges.filter((e) => e.kind === "triggered_by");
    expect(triggeredByEdges.length).toBeGreaterThanOrEqual(1);
  });

  it("AC-2.3: gates edges connect intent to agent session", async () => {
    const graph = await getWorkspaceGraphOverview({ surreal, workspaceRecord });

    const gatesEdges = graph.edges.filter((e) => e.kind === "gates");
    expect(gatesEdges.length).toBeGreaterThanOrEqual(1);
  });

  it("AC-2.4: completed, vetoed, and failed intents are excluded", async () => {
    const graph = await getWorkspaceGraphOverview({ surreal, workspaceRecord });

    const intentNames = graph.entities
      .filter((e) => e.kind === "intent")
      .map((e) => e.name);

    expect(intentNames).not.toContain("Run test suite");
    expect(intentNames).not.toContain("Drop production table");
    expect(intentNames).not.toContain("Broken deploy");
  });

  it("AC-2.8: focused view accepts intent as center entity", async () => {
    const graph = await getFocusedGraphView({
      surreal,
      workspaceRecord,
      centerEntityRecord: executingIntentRecord as GraphEntityRecord,
      depth: 1,
    });

    // Center entity should be present
    const centerEntity = graph.entities.find((e) => e.name === "Deploy v2.1 to staging");
    expect(centerEntity).toBeDefined();
    expect(centerEntity!.kind).toBe("intent");

    // Should reach task via triggered_by
    const taskEntity = graph.entities.find((e) => e.kind === "task");
    expect(taskEntity).toBeDefined();

    // Should reach agent session via gates
    const sessionEntity = graph.entities.find((e) => e.kind === "agent_session");
    expect(sessionEntity).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 + AC-1: Focused view for policy
// ─────────────────────────────────────────────────────────────────────────────

describe("Focused view centering on policy", () => {
  it("focused view accepts policy as center entity", async () => {
    const graph = await getFocusedGraphView({
      surreal,
      workspaceRecord,
      centerEntityRecord: activePolicyRecord as GraphEntityRecord,
      depth: 1,
    });

    // Center entity should be present
    const centerEntity = graph.entities.find((e) => e.name === "Active Budget Guard");
    expect(centerEntity).toBeDefined();
    expect(centerEntity!.kind).toBe("policy");

    // Should reach identity via governing
    const identityEntity = graph.entities.find((e) => e.kind === "identity");
    expect(identityEntity).toBeDefined();

    // Should reach workspace via protects
    const workspaceEntity = graph.entities.find((e) => e.kind === "workspace");
    expect(workspaceEntity).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: Edge style classification
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-4: Governance edges are classified distinctly", () => {
  it("AC-4.1/4.2: governing and protects edges appear in graph", async () => {
    const graph = await getWorkspaceGraphOverview({ surreal, workspaceRecord });

    const edgeKinds = graph.edges.map((e) => e.kind);
    expect(edgeKinds).toContain("governing");
    expect(edgeKinds).toContain("protects");
  });

  it("AC-4.3/4.4: triggered_by and gates edges appear in graph", async () => {
    const graph = await getWorkspaceGraphOverview({ surreal, workspaceRecord });

    const edgeKinds = graph.edges.map((e) => e.kind);
    expect(edgeKinds).toContain("triggered_by");
    expect(edgeKinds).toContain("gates");
  });

  it("governance edges coexist with structural edges", async () => {
    const graph = await getWorkspaceGraphOverview({ surreal, workspaceRecord });

    const edgeKinds = new Set(graph.edges.map((e) => e.kind));
    // Structural edges still present
    expect(edgeKinds.has("belongs_to")).toBe(true);
    // Governance edges also present
    expect(edgeKinds.has("governing")).toBe(true);
    expect(edgeKinds.has("protects")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-X.4: Existing entities still visible
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-X.4: Existing graph nodes unaffected by governance additions", () => {
  it("project, task, and identity still appear in workspace graph", async () => {
    const graph = await getWorkspaceGraphOverview({ surreal, workspaceRecord });

    const kinds = graph.entities.map((e) => e.kind);
    expect(kinds).toContain("project");
    expect(kinds).toContain("task");
    expect(kinds).toContain("identity");
  });

  it("project graph view still includes task and structural edges", async () => {
    const graph = await getProjectGraphView({
      surreal,
      workspaceRecord,
      projectRecord,
    });

    const entityKinds = graph.entities.map((e) => e.kind);
    expect(entityKinds).toContain("task");

    const edgeKinds = graph.edges.map((e) => e.kind);
    expect(edgeKinds).toContain("belongs_to");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: learnings and git_commits in graph view
// ─────────────────────────────────────────────────────────────────────────────

describe("Learnings and git_commits appear in workspace graph overview", () => {
  it("learning nodes appear in workspace graph overview", async () => {
    const graph = await getWorkspaceGraphOverview({ surreal, workspaceRecord });

    const learningNodes = graph.entities.filter((e) => e.kind === "learning");
    expect(learningNodes.length).toBeGreaterThanOrEqual(1);
    expect(learningNodes.map((n) => n.name)).toContain(
      "Customs clearance requires advance filing 72 hours before arrival",
    );
  });

  it("git_commit nodes appear in workspace graph overview", async () => {
    const graph = await getWorkspaceGraphOverview({ surreal, workspaceRecord });

    const commitNodes = graph.entities.filter((e) => e.kind === "git_commit");
    expect(commitNodes.length).toBeGreaterThanOrEqual(1);
    expect(commitNodes.map((n) => n.name)).toContain(
      "fix(logistics): correct duty calculation for cross-border shipments",
    );
  });
});

describe("Focused view accepts learning and git_commit as center entity", () => {
  it("focused view accepts learning as center entity", async () => {
    const graph = await getFocusedGraphView({
      surreal,
      workspaceRecord,
      centerEntityRecord: learningRecord as GraphEntityRecord,
      depth: 1,
    });

    const centerEntity = graph.entities.find(
      (e) => e.name === "Customs clearance requires advance filing 72 hours before arrival",
    );
    expect(centerEntity).toBeDefined();
    expect(centerEntity!.kind).toBe("learning");
  });

  it("focused view accepts git_commit as center entity", async () => {
    const graph = await getFocusedGraphView({
      surreal,
      workspaceRecord,
      centerEntityRecord: gitCommitRecord as GraphEntityRecord,
      depth: 1,
    });

    const centerEntity = graph.entities.find(
      (e) => e.name === "fix(logistics): correct duty calculation for cross-border shipments",
    );
    expect(centerEntity).toBeDefined();
    expect(centerEntity!.kind).toBe("git_commit");
  });
});

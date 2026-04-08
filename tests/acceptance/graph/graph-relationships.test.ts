import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { RecordId, Surreal } from "surrealdb";
import { applyTestSchema } from "../acceptance-test-kit";
import {
  getEntityDetail,
  getProjectGraphView,
  getWorkspaceGraphOverview,
  getFocusedGraphView,
  listEntityNeighbors,
  type GraphEntityRecord,
} from "../../../app/src/server/graph/queries";

/**
 * Regression tests for three root causes:
 * RC1: listEntityNeighbors / entity detail ignores structural relation tables (belongs_to, has_feature, etc.)
 * RC2: getWorkspaceGraphOverview omits tasks, decisions, questions, persons
 * RC3: collectEntityRelationEdges ignores structural edges in graph views
 */

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

let surreal: Surreal;
let namespace: string;
let database: string;

let workspaceRecord: RecordId<"workspace", string>;
let projectRecord: RecordId<"project", string>;
let featureRecord: RecordId<"feature", string>;
let taskRecord: RecordId<"task", string>;
let standaloneFeatureRecord: RecordId<"feature", string>;
let standaloneFeatureTaskRecord: RecordId<"task", string>;
let relatedTaskRecord: RecordId<"task", string>;
let legacyFeatureRecord: RecordId<"feature", string>;
let legacyFeatureTaskRecord: RecordId<"task", string>;
let decisionRecord: RecordId<"decision", string>;
let questionRecord: RecordId<"question", string>;
let personRecord: RecordId<"person", string>;
let identityRecord: RecordId<"identity", string>;
let policyRecord: RecordId<"policy", string>;
let intentRecord: RecordId<"intent", string>;

beforeAll(async () => {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  namespace = `smoke_graph_rel_${runId}`;
  database = `graph_rel_${Math.floor(Math.random() * 100000)}`;

  surreal = new Surreal();
  await surreal.connect(surrealUrl);
  await surreal.signin({ username: surrealUsername, password: surrealPassword });
  await surreal.query(`DEFINE NAMESPACE ${namespace};`);
  await surreal.use({ namespace });
  await surreal.query(`DEFINE DATABASE ${database};`);
  await surreal.use({ namespace, database });

  await applyTestSchema(surreal);



  const now = new Date();

  // Create workspace
  workspaceRecord = new RecordId("workspace", randomUUID());
  await surreal.create(workspaceRecord).content({
    name: "Graph Relationships Test Workspace",
    status: "active",
    onboarding_complete: true,
    onboarding_turn_count: 0,
    onboarding_summary_pending: false,
    onboarding_started_at: now,
    created_at: now,
  });

  // Create project linked to workspace
  projectRecord = new RecordId("project", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: projectRecord,
    content: { name: "Test Project", status: "active", workspace: workspaceRecord, created_at: now, updated_at: now },
  });
  await surreal.query("RELATE $workspace->has_project->$project SET added_at = $now;", {
    workspace: workspaceRecord,
    project: projectRecord,
    now,
  });

  // Create feature linked to project
  featureRecord = new RecordId("feature", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: featureRecord,
    content: { name: "Test Feature", status: "active", workspace: workspaceRecord, created_at: now, updated_at: now },
  });
  await surreal.query("RELATE $project->has_feature->$feature SET added_at = $now;", {
    project: projectRecord,
    feature: featureRecord,
    now,
  });

  // Create task belonging to project (via belongs_to)
  taskRecord = new RecordId("task", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: taskRecord,
    content: { title: "Test Task", status: "open", workspace: workspaceRecord, created_at: now, updated_at: now },
  });
  await surreal.query("RELATE $task->belongs_to->$project SET added_at = $now;", {
    task: taskRecord,
    project: projectRecord,
    now,
  });

  // Create a workspace-scoped feature and a task that belongs to that feature,
  // without linking the feature to a project.
  standaloneFeatureRecord = new RecordId("feature", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: standaloneFeatureRecord,
    content: {
      name: "Standalone Feature",
      status: "active",
      workspace: workspaceRecord,
      created_at: now,
      updated_at: now,
    },
  });

  standaloneFeatureTaskRecord = new RecordId("task", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: standaloneFeatureTaskRecord,
    content: {
      title: "Task Under Standalone Feature",
      status: "open",
      workspace: workspaceRecord,
      created_at: now,
      updated_at: now,
    },
  });
  await surreal.query("RELATE $task->belongs_to->$feature SET added_at = $now;", {
    task: standaloneFeatureTaskRecord,
    feature: standaloneFeatureRecord,
    now,
  });

  // Create an additional task not structurally linked to the project.
  relatedTaskRecord = new RecordId("task", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: relatedTaskRecord,
    content: {
      title: "Related External Task",
      status: "open",
      workspace: workspaceRecord,
      created_at: now,
      updated_at: now,
    },
  });
  // Link project task -> related task through a task-to-task dependency edge.
  await surreal.query("RELATE $task->depends_on->$related SET type = 'needs', added_at = $now;", {
    task: taskRecord,
    related: relatedTaskRecord,
    now,
  });

  // Feature linked to project — used to verify task detail prefers feature over project.
  legacyFeatureRecord = new RecordId("feature", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: legacyFeatureRecord,
    content: {
      name: "Feature Linked Via Project",
      status: "active",
      workspace: workspaceRecord,
      created_at: now,
      updated_at: now,
    },
  });
  await surreal.query("RELATE $project->has_feature->$feature SET added_at = $now;", {
    project: projectRecord,
    feature: legacyFeatureRecord,
    now,
  });

  legacyFeatureTaskRecord = new RecordId("task", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: legacyFeatureTaskRecord,
    content: {
      title: "Task Under Feature Linked Via Project",
      status: "open",
      workspace: workspaceRecord,
      created_at: now,
      updated_at: now,
    },
  });
  await surreal.query("RELATE $task->belongs_to->$feature SET added_at = $now;", {
    task: legacyFeatureTaskRecord,
    feature: legacyFeatureRecord,
    now,
  });
  await surreal.query("RELATE $task->belongs_to->$project SET added_at = $now;", {
    task: legacyFeatureTaskRecord,
    project: projectRecord,
    now,
  });

  // Create decision belonging to project
  decisionRecord = new RecordId("decision", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: decisionRecord,
    content: { summary: "Test Decision", status: "proposed", workspace: workspaceRecord, created_at: now, updated_at: now },
  });
  await surreal.query("RELATE $decision->belongs_to->$project SET added_at = $now;", {
    decision: decisionRecord,
    project: projectRecord,
    now,
  });

  // Create question belonging to project
  questionRecord = new RecordId("question", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: questionRecord,
    content: { text: "Test Question?", status: "open", workspace: workspaceRecord, created_at: now, updated_at: now },
  });
  await surreal.query("RELATE $question->belongs_to->$project SET added_at = $now;", {
    question: questionRecord,
    project: projectRecord,
    now,
  });

  // Create person and identity linked to workspace
  personRecord = new RecordId("person", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: personRecord,
    content: { name: "Test Person", contact_email: "test@test.local", created_at: now, updated_at: now },
  });
  identityRecord = new RecordId("identity", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: identityRecord,
    content: { name: "Test Person", type: "human", workspace: workspaceRecord, created_at: now },
  });
  await surreal.query("RELATE $identity->identity_person->$person SET added_at = $now;", {
    identity: identityRecord,
    person: personRecord,
    now,
  });
  await surreal.query("RELATE $identity->member_of->$workspace SET added_at = $now;", {
    identity: identityRecord,
    workspace: workspaceRecord,
    now,
  });

  // Create an owns edge (identity -> task)
  await surreal.query("RELATE $identity->owns->$task SET assigned_at = $now;", {
    identity: identityRecord,
    task: taskRecord,
    now,
  });

  // Create a depends_on edge (task -> feature)
  await surreal.query("RELATE $task->depends_on->$feature SET type = 'needs', added_at = $now;", {
    task: taskRecord,
    feature: featureRecord,
    now,
  });

  // Create active policy linked to workspace via governing + protects
  policyRecord = new RecordId("policy", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: policyRecord,
    content: {
      title: "Test Policy",
      version: 1,
      status: "active",
      selector: {},
      rego_source: "package osabio.policy\ndefault allow = true",
      human_veto_required: false,
      created_by: identityRecord,
      workspace: workspaceRecord,
      created_at: now,
    },
  });
  await surreal.query("RELATE $identity->governing->$policy SET created_at = $now;", {
    identity: identityRecord,
    policy: policyRecord,
    now,
  });
  await surreal.query("RELATE $policy->protects->$workspace SET created_at = $now;", {
    policy: policyRecord,
    workspace: workspaceRecord,
    now,
  });

  // Create executing intent linked to task via triggered_by
  intentRecord = new RecordId("intent", randomUUID());
  const traceRecord = new RecordId("trace", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: traceRecord,
    content: { type: "intent_submission", actor: identityRecord, workspace: workspaceRecord, created_at: now },
  });
  await surreal.query("CREATE $record CONTENT $content;", {
    record: intentRecord,
    content: {
      goal: "Test Intent",
      reasoning: "test",
      status: "executing",
      priority: 50,
      action_spec: { provider: "test", action: "deploy", params: {} },
      trace_id: traceRecord,
      requester: identityRecord,
      workspace: workspaceRecord,
      created_at: now,
    },
  });
  await surreal.query("RELATE $intent->triggered_by->$task SET created_at = $now;", {
    intent: intentRecord,
    task: taskRecord,
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

describe("RC1: entity detail shows structural relationships", () => {
  it("task detail includes belongs_to relationship to project", async () => {
    const detail = await getEntityDetail({
      surreal,
      workspaceRecord,
      entityRecord: taskRecord as GraphEntityRecord,
    });

    const projectRel = detail.relationships.find(
      (r) => r.kind === "project" && r.name === "Test Project",
    );
    expect(projectRel).toBeDefined();
    expect(projectRel!.relationKind).toBe("belongs_to");
    expect(projectRel!.direction).toBe("outgoing");
  });

  it("project detail includes belongs_to relationships from task, decision, question", async () => {
    const detail = await getEntityDetail({
      surreal,
      workspaceRecord,
      entityRecord: projectRecord as GraphEntityRecord,
    });

    const taskRel = detail.relationships.find((r) => r.kind === "task" && r.name === "Test Task");
    const decisionRel = detail.relationships.find((r) => r.kind === "decision" && r.name === "Test Decision");
    const questionRel = detail.relationships.find((r) => r.kind === "question" && r.name === "Test Question?");

    expect(taskRel).toBeDefined();
    expect(taskRel!.relationKind).toBe("belongs_to");
    expect(taskRel!.direction).toBe("incoming");

    expect(decisionRel).toBeDefined();
    expect(questionRel).toBeDefined();
  });

  it("project detail includes has_feature relationship", async () => {
    const detail = await getEntityDetail({
      surreal,
      workspaceRecord,
      entityRecord: projectRecord as GraphEntityRecord,
    });

    const featureRel = detail.relationships.find(
      (r) => r.kind === "feature" && r.name === "Test Feature",
    );
    expect(featureRel).toBeDefined();
    expect(featureRel!.relationKind).toBe("has_feature");
    expect(featureRel!.direction).toBe("outgoing");
  });

  it("task detail includes owns relationship from identity", async () => {
    const detail = await getEntityDetail({
      surreal,
      workspaceRecord,
      entityRecord: taskRecord as GraphEntityRecord,
    });

    const ownerRel = detail.relationships.find(
      (r) => r.kind === "identity" && r.name === "Test Person",
    );
    expect(ownerRel).toBeDefined();
    expect(ownerRel!.relationKind).toBe("owns");
    expect(ownerRel!.direction).toBe("incoming");
  });

  it("task detail includes depends_on relationship to feature", async () => {
    const detail = await getEntityDetail({
      surreal,
      workspaceRecord,
      entityRecord: taskRecord as GraphEntityRecord,
    });

    const depRel = detail.relationships.find(
      (r) => r.kind === "feature" && r.name === "Test Feature" && r.relationKind === "depends_on",
    );
    expect(depRel).toBeDefined();
    expect(depRel!.direction).toBe("outgoing");
  });

  it("policy detail includes governing relationship from identity", async () => {
    const detail = await getEntityDetail({
      surreal,
      workspaceRecord,
      entityRecord: policyRecord as GraphEntityRecord,
    });

    const governingRel = detail.relationships.find(
      (r) => r.kind === "identity" && r.relationKind === "governing",
    );
    expect(governingRel).toBeDefined();
    expect(governingRel!.direction).toBe("incoming");
  });

  it("policy detail includes protects relationship to workspace", async () => {
    const detail = await getEntityDetail({
      surreal,
      workspaceRecord,
      entityRecord: policyRecord as GraphEntityRecord,
    });

    const protectsRel = detail.relationships.find(
      (r) => r.kind === "workspace" && r.relationKind === "protects",
    );
    expect(protectsRel).toBeDefined();
    expect(protectsRel!.direction).toBe("outgoing");
  });

  it("intent detail includes triggered_by relationship to task", async () => {
    const detail = await getEntityDetail({
      surreal,
      workspaceRecord,
      entityRecord: intentRecord as GraphEntityRecord,
    });

    const triggeredByRel = detail.relationships.find(
      (r) => r.kind === "task" && r.relationKind === "triggered_by",
    );
    expect(triggeredByRel).toBeDefined();
    expect(triggeredByRel!.direction).toBe("outgoing");
  });

  it("listEntityNeighbors returns structural neighbors", async () => {
    const neighbors = await listEntityNeighbors({
      surreal,
      workspaceRecord,
      entityRecord: taskRecord as GraphEntityRecord,
      limit: 40,
    });

    const kinds = neighbors.map((n) => n.relationKind);
    expect(kinds).toContain("belongs_to");
    expect(kinds).toContain("owns");
    expect(kinds).toContain("depends_on");
  });

  it("task detail prefers feature relationship over project belongs_to", async () => {
    const detail = await getEntityDetail({
      surreal,
      workspaceRecord,
      entityRecord: legacyFeatureTaskRecord as GraphEntityRecord,
    });

    const featureRel = detail.relationships.find((r) => r.kind === "feature" && r.name === "Feature Linked Via Project");
    const projectBelongsToRel = detail.relationships.find(
      (r) => r.kind === "project" && r.relationKind === "belongs_to" && r.direction === "outgoing",
    );

    expect(featureRel).toBeDefined();
    expect(projectBelongsToRel).toBeUndefined();
  });
});

describe("RC2: workspace graph overview includes all entity types", () => {
  it("workspace graph overview includes tasks", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    const taskEntity = graph.entities.find((e) => e.id === (taskRecord.id as string));
    expect(taskEntity).toBeDefined();
    expect(taskEntity!.name).toBe("Test Task");
  });

  it("workspace graph overview includes tasks belonging to workspace features", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    const featureEntity = graph.entities.find((e) => e.id === (standaloneFeatureRecord.id as string));
    const taskEntity = graph.entities.find((e) => e.id === (standaloneFeatureTaskRecord.id as string));
    const relationEdge = graph.edges.find(
      (e) =>
        e.kind === "belongs_to"
        && e.fromId === (standaloneFeatureTaskRecord.id as string)
        && e.toId === (standaloneFeatureRecord.id as string),
    );

    expect(featureEntity).toBeDefined();
    expect(taskEntity).toBeDefined();
    expect(relationEdge).toBeDefined();
  });

  it("workspace graph overview includes decisions", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    const decisionEntity = graph.entities.find((e) => e.kind === "decision");
    expect(decisionEntity).toBeDefined();
    expect(decisionEntity!.name).toBe("Test Decision");
  });

  it("workspace graph overview includes questions", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    const questionEntity = graph.entities.find((e) => e.kind === "question");
    expect(questionEntity).toBeDefined();
    expect(questionEntity!.name).toBe("Test Question?");
  });

  it("workspace graph overview includes policies", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    const policyEntity = graph.entities.find((e) => e.kind === "policy");
    expect(policyEntity).toBeDefined();
    expect(policyEntity!.name).toBe("Test Policy");
  });

  it("workspace graph overview includes intents", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    const intentEntity = graph.entities.find((e) => e.kind === "intent");
    expect(intentEntity).toBeDefined();
    expect(intentEntity!.name).toBe("Test Intent");
  });

  it("workspace graph overview includes identities", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    // The graph may show identity or person depending on traversal; check for identity (hub-spoke model)
    const identityEntity = graph.entities.find((e) => e.kind === "identity");
    const personEntity = graph.entities.find((e) => e.kind === "person");
    const found = identityEntity ?? personEntity;
    expect(found).toBeDefined();
    expect(found!.name).toBe("Test Person");
  });
});

describe("RC3: graph edges include structural relationships", () => {
  it("workspace graph overview includes belongs_to edges", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    const belongsToEdge = graph.edges.find((e) => e.kind === "belongs_to");
    expect(belongsToEdge).toBeDefined();
  });

  it("workspace graph overview includes governing edges", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    const governingEdge = graph.edges.find((e) => e.kind === "governing");
    expect(governingEdge).toBeDefined();
  });

  it("workspace graph overview includes protects edges", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    const protectsEdge = graph.edges.find((e) => e.kind === "protects");
    expect(protectsEdge).toBeDefined();
  });

  it("workspace graph overview includes triggered_by edges", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    const triggeredByEdge = graph.edges.find((e) => e.kind === "triggered_by");
    expect(triggeredByEdge).toBeDefined();
  });

  it("workspace graph overview includes has_feature edges", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    const hasFeatureEdge = graph.edges.find((e) => e.kind === "has_feature");
    expect(hasFeatureEdge).toBeDefined();
  });

  it("project graph view includes structural edges between entities", async () => {
    const graph = await getProjectGraphView({
      surreal,
      workspaceRecord,
      projectRecord,
    });

    const edgeKinds = graph.edges.map((e) => e.kind);
    expect(edgeKinds).toContain("belongs_to");
    expect(edgeKinds).toContain("has_feature");
  });

  it("project graph view includes owns edges", async () => {
    const graph = await getProjectGraphView({
      surreal,
      workspaceRecord,
      projectRecord,
    });

    const ownsEdge = graph.edges.find((e) => e.kind === "owns");
    expect(ownsEdge).toBeDefined();
  });

  it("project graph view includes depends_on edges", async () => {
    const graph = await getProjectGraphView({
      surreal,
      workspaceRecord,
      projectRecord,
    });

    const depsEdge = graph.edges.find((e) => e.kind === "depends_on");
    expect(depsEdge).toBeDefined();
  });

  it("project graph view includes related task neighbors for task-to-task edges", async () => {
    const graph = await getProjectGraphView({
      surreal,
      workspaceRecord,
      projectRecord,
    });

    const relatedTask = graph.entities.find((e) => e.id === (relatedTaskRecord.id as string));
    const relationEdge = graph.edges.find(
      (e) =>
        e.kind === "depends_on"
        && e.fromId === (taskRecord.id as string)
        && e.toId === (relatedTaskRecord.id as string),
    );

    expect(relatedTask).toBeDefined();
    expect(relationEdge).toBeDefined();
  });

  it("project graph view includes triggered_by edges from intents", async () => {
    const graph = await getProjectGraphView({
      surreal,
      workspaceRecord,
      projectRecord,
    });

    const triggeredByEdge = graph.edges.find((e) => e.kind === "triggered_by");
    expect(triggeredByEdge).toBeDefined();
  });

  it("focused graph view traverses structural edges", async () => {
    const graph = await getFocusedGraphView({
      surreal,
      workspaceRecord,
      centerEntityRecord: taskRecord as GraphEntityRecord,
      depth: 2,
    });

    // Starting from task, should reach project via belongs_to
    const projectEntity = graph.entities.find((e) => e.kind === "project");
    expect(projectEntity).toBeDefined();

    // Should also reach feature via depends_on
    const featureEntity = graph.entities.find((e) => e.kind === "feature");
    expect(featureEntity).toBeDefined();

    // Should also reach identity via owns
    const identityEntity = graph.entities.find((e) => e.kind === "identity");
    const personEntity = graph.entities.find((e) => e.kind === "person");
    expect(identityEntity ?? personEntity).toBeDefined();
  });

  it("focused graph view from intent reaches task via triggered_by", async () => {
    const graph = await getFocusedGraphView({
      surreal,
      workspaceRecord,
      centerEntityRecord: intentRecord as GraphEntityRecord,
      depth: 1,
    });

    const taskEntity = graph.entities.find((e) => e.kind === "task");
    expect(taskEntity).toBeDefined();
    expect(taskEntity!.name).toBe("Test Task");
  });

  it("focused graph view from policy reaches identity via governing", async () => {
    const graph = await getFocusedGraphView({
      surreal,
      workspaceRecord,
      centerEntityRecord: policyRecord as GraphEntityRecord,
      depth: 1,
    });

    const identityEntity = graph.entities.find((e) => e.kind === "identity");
    expect(identityEntity).toBeDefined();
  });
});

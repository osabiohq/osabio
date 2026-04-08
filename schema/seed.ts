/**
 * Seed script — populates a single "Acme Analytics" workspace with every entity
 * type, every status enum value, and every relationship edge so all UI flows
 * can be explored visually.
 *
 * Usage: bun run seed  (reads .env for SurrealDB connection)
 */
import { createHash } from "node:crypto";
import { RecordId, Surreal } from "surrealdb";

// ---------------------------------------------------------------------------
// Env + connection (mirrors schema/migrate.ts)
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function rid<T extends string>(table: T, id?: string): RecordId<T> {
  return new RecordId(table, id ?? crypto.randomUUID());
}

const now = new Date();
function ago(minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}
function future(minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

// ---------------------------------------------------------------------------
// Seed context — accumulates record IDs across sections
// ---------------------------------------------------------------------------

type Ref<T extends string = string> = { id: string; record: RecordId<T> };

type SeedCtx = {
  db: Surreal;
  ws: Ref<"workspace">;
  person: Ref<"person">;
  human: Ref<"identity">;
  coder: Ref<"identity">;
  architect: Ref<"identity">;
  observer: Ref<"identity">;
  projects: Record<string, Ref<"project">>;
  features: Record<string, Ref<"feature">>;
  tasks: Record<string, Ref<"task">>;
  decisions: Record<string, Ref<"decision">>;
  questions: Record<string, Ref<"question">>;
  conversations: Record<string, Ref<"conversation">>;
  messages: Record<string, Ref<"message">>;
  sessions: Record<string, Ref<"agent_session">>;
  traces: Record<string, Ref<"trace">>;
  observations: Record<string, Ref<"observation">>;
  suggestions: Record<string, Ref<"suggestion">>;
  learnings: Record<string, Ref<"learning">>;
  policies: Record<string, Ref<"policy">>;
  objectives: Record<string, Ref<"objective">>;
  behaviorDefs: Record<string, Ref<"behavior_definition">>;
  behaviors: Record<string, Ref<"behavior">>;
  intents: Record<string, Ref<"intent">>;
  commits: Record<string, Ref<"git_commit">>;
  mcpTools: Record<string, Ref<"mcp_tool">>;
  mcpServers: Record<string, Ref<"mcp_server">>;
  documents: Record<string, Ref<"document">>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function create<T extends string>(
  db: Surreal,
  table: T,
  content: Record<string, unknown>,
  id?: string,
): Promise<Ref<T>> {
  const recordId = id ?? crypto.randomUUID();
  const record = new RecordId(table, recordId);
  await db.query(`CREATE $record CONTENT $content;`, { record, content });
  return { id: recordId, record };
}

async function relate(
  db: Surreal,
  from: RecordId,
  edge: string,
  to: RecordId,
  fields: Record<string, unknown> = {},
): Promise<void> {
  const bindings: Record<string, unknown> = { from, to, ...fields };
  const setClause = Object.keys(fields).length
    ? " SET " + Object.keys(fields).map((k) => `${k} = $${k}`).join(", ")
    : "";
  await db.query(`RELATE $from->${edge}->$to${setClause};`, bindings);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

const WORKSPACE_NAME = "Acme Analytics";

const TABLES_WITH_WORKSPACE = [
  "conversation", "message", "project", "feature", "task", "decision",
  "question", "observation", "suggestion", "identity", "agent_session",
  "trace", "intent", "policy", "learning", "objective", "behavior",
  "behavior_definition", "git_commit", "mcp_tool", "mcp_server",
  "credential_provider", "document", "document_chunk", "audit_event",
  "proxy_token", "authority_scope",
];

async function cleanup(db: Surreal): Promise<void> {
  const [rows] = await db.query<[Array<{ id: RecordId }>]>(
    `SELECT id FROM workspace WHERE name = $name LIMIT 1;`,
    { name: WORKSPACE_NAME },
  );
  if (!rows.length) return;

  const wsRecord = rows[0].id;
  console.log(`  Cleaning up existing "${WORKSPACE_NAME}" workspace...`);

  // Delete workspace-scoped entities
  for (const table of TABLES_WITH_WORKSPACE) {
    await db.query(`DELETE FROM ${table} WHERE workspace = $ws;`, { ws: wsRecord });
  }

  // Delete person + account (by email)
  await db.query(`DELETE FROM account WHERE person_id IN (SELECT id FROM person WHERE contact_email = $email);`, {
    email: "jordan@acme-analytics.com",
  });
  await db.query(`DELETE FROM person WHERE contact_email = $email;`, { email: "jordan@acme-analytics.com" });

  // Delete agent records managed by identities in this workspace (already deleted above)
  // Delete the workspace itself
  await db.query(`DELETE $ws;`, { ws: wsRecord });
}

// ---------------------------------------------------------------------------
// 1. Workspace
// ---------------------------------------------------------------------------

async function seedWorkspace(db: Surreal): Promise<Ref<"workspace">> {
  const ws = await create(db, "workspace", {
    name: WORKSPACE_NAME,
    status: "active",
    description: "Analytics SaaS platform — dashboards, APIs, billing, and compliance.",
    onboarding_complete: true,
    onboarding_turn_count: 5,
    onboarding_summary_pending: false,
    onboarding_started_at: ago(10080), // 7 days
    onboarding_completed_at: ago(9000),
    created_at: ago(10080),
    updated_at: ago(60),
    evidence_enforcement: "soft",
    evidence_enforcement_threshold: { min_decisions: 2, min_tasks: 3 },
    min_evidence_age_minutes: 30,
    evidence_enforcement_transitions: [
      { from: "bootstrap", to: "soft", trigger: "auto", timestamp: ago(4320) }, // 3 days ago
    ],
  });
  console.log("  ✓ Workspace");
  return ws;
}

// ---------------------------------------------------------------------------
// 2. Identities
// ---------------------------------------------------------------------------

async function seedIdentities(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  // Person (Better Auth)
  const personId = crypto.randomUUID();
  const personRecord = rid("person", personId);
  const hashedPassword = await Bun.password.hash("seed-password-2026", "argon2id");
  await db.query(`CREATE $record CONTENT $content;`, {
    record: personRecord,
    content: {
      name: "Jordan Rivera",
      contact_email: "jordan@acme-analytics.com",
      email_verified: true,
      created_at: ago(10080),
      updated_at: ago(60),
    },
  });

  // Account — record ID must match person's raw ID for Better Auth lookup
  await db.query(
    `LET $pid = record::id($person);
     CREATE type::record("account", $pid) CONTENT {
       account_id: $pid,
       provider_id: $providerId,
       password: $hashedPw,
       person_id: $person,
       created_at: $createdAt,
       updated_at: $updatedAt
     };`,
    {
      person: personRecord,
      providerId: "credential",
      hashedPw: hashedPassword,
      createdAt: ago(10080),
      updatedAt: ago(60),
    },
  );

  ctx.person = { id: personId, record: personRecord };

  // Human identity
  const human = await create(db, "identity", {
    name: "Jordan Rivera",
    type: "human",
    role: "admin",
    identity_status: "active",
    workspace: ws.record,
    created_at: ago(10080),
  });
  await relate(db, human.record, "member_of", ws.record, { added_at: ago(10080) });
  await relate(db, human.record, "identity_person", personRecord, { added_at: ago(10080) });
  ctx.human = human;

  // Agent identities
  const agentDefs: Array<{ key: keyof Pick<SeedCtx, "coder" | "architect" | "observer">; name: string; runtime: string }> = [
    { key: "coder", name: "Coding Agent", runtime: "external" },
    { key: "architect", name: "Architect Agent", runtime: "osabio" },
    { key: "observer", name: "Observer Agent", runtime: "osabio" },
  ];

  for (const def of agentDefs) {
    const identity = await create(db, "identity", {
      name: def.name,
      type: "agent",
      identity_status: "active",
      workspace: ws.record,
      created_at: ago(10080),
    });
    await relate(db, identity.record, "member_of", ws.record, { added_at: ago(10080) });

    const agent = await create(db, "agent", {
      runtime: def.runtime,
      name: def.name,
      description: `${def.name} for Acme Analytics`,
      managed_by: human.record,
      created_at: ago(10080),
    });
    await relate(db, identity.record, "identity_agent", agent.record, { added_at: ago(10080) });

    ctx[def.key] = identity;
  }

  console.log("  ✓ Identities (1 human + 3 agents)");
}

// ---------------------------------------------------------------------------
// 3. Projects + Features
// ---------------------------------------------------------------------------

async function seedProjects(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  const projectDefs = [
    {
      key: "platform",
      name: "Platform Scalability Initiative",
      description: "Improve API latency, database throughput, and event processing to support 10x growth. Rate limiting is now in design with a confirmed decision to use Redis sorted sets. Read replica pooling is in progress with PgBouncer.",
      entries: [
        { text: "Initiative created to address 10x growth target for the platform.", created_at: ago(7200) },
        { text: "Scope expanded to include event-driven notifications after customer feedback on polling latency.", created_at: ago(5500) },
        { text: "Decision confirmed: Redis sorted sets for rate limiting — rules out token bucket approach.", created_at: ago(2000) },
        { text: "Read replica connection pooling is in progress using PgBouncer with health checks.", created_at: ago(800) },
      ],
      features: [
        {
          key: "rateLimit", name: "API Rate Limiting", category: "engineering",
          description: "Sliding window rate limiter per API key with configurable burst and sustained limits. Redis sorted sets chosen over token bucket after design doc review.",
          entries: [
            { text: "Feature created: sliding window rate limiter per API key.", created_at: ago(5000) },
            { text: "Design doc drafted covering sliding window vs token bucket trade-offs.", created_at: ago(3500) },
            { text: "Decision confirmed to use Redis sorted sets — burst and sustained limits are configurable per key.", created_at: ago(2000) },
          ],
        },
        {
          key: "readReplicas", name: "Database Migration to Read Replicas", category: "engineering",
          description: "Route analytics and reporting queries to read replicas to protect primary write performance. PgBouncer connection pooling is being configured with automatic failover.",
          entries: [
            { text: "Feature created: route read-heavy queries to replicas to protect write performance.", created_at: ago(5000) },
            { text: "Task started: configuring PgBouncer connection pooling for read replicas.", created_at: ago(1200) },
          ],
        },
        {
          key: "eventNotifs", name: "Event-Driven Notifications", category: "engineering",
          description: "Replace polling-based notification delivery with event-driven push via webhooks and WebSockets.",
          entries: [
            { text: "Feature created: replace polling with event-driven push delivery.", created_at: ago(5000) },
          ],
        },
      ],
    },
    {
      key: "billing",
      name: "Self-Serve Billing & Pricing",
      description: "Usage-based billing, plan management, and pricing experimentation for self-serve customers. API call metering is complete and invoicing via Stripe is live. Pricing tier feature matrix has been finalized.",
      entries: [
        { text: "Project created to enable self-serve billing and pricing experimentation.", created_at: ago(7200) },
        { text: "Usage metering for API calls completed — per-customer call counting is live in production.", created_at: ago(1500) },
        { text: "Pricing tier feature matrix finalized: Starter, Growth, and Enterprise plans defined.", created_at: ago(600) },
        { text: "Billing webhook migration to event bus is blocked on infrastructure decision (Kafka vs SQS).", created_at: ago(400) },
      ],
      features: [
        {
          key: "usageBilling", name: "Usage-Based Billing Engine", category: "operations",
          description: "Meter API calls, storage, and compute per customer, aggregate into invoices via Stripe integration. API call metering is complete. Webhook migration to event bus is blocked on Kafka vs SQS decision.",
          entries: [
            { text: "Feature created: meter API calls, storage, and compute per customer.", created_at: ago(5000) },
            { text: "Task completed: usage metering for API calls is instrumented on all endpoints.", created_at: ago(1500) },
            { text: "Billing webhook migration blocked — waiting on event bus infrastructure decision.", created_at: ago(400) },
          ],
        },
        {
          key: "pricingTiers", name: "Pricing Tier Management", category: "sales",
          description: "Self-serve plan selector with feature gates, usage caps, and upgrade/downgrade flows. Feature matrix is complete with three tiers: Starter, Growth, Enterprise.",
          entries: [
            { text: "Feature created: self-serve plan selector with feature gates and usage caps.", created_at: ago(5000) },
            { text: "Task completed: pricing tier feature matrix defined for Starter, Growth, and Enterprise.", created_at: ago(600) },
          ],
        },
      ],
    },
  ];

  for (const proj of projectDefs) {
    const p = await create(db, "project", {
      name: proj.name,
      status: "active",
      description: proj.description,
      description_entries: proj.entries,
      workspace: ws.record,
      created_at: ago(7200),
      updated_at: ago(120),
    });
    ctx.projects[proj.key] = p;
    await relate(db, ws.record, "has_project", p.record, { added_at: ago(7200) });

    for (const feat of proj.features) {
      const f = await create(db, "feature", {
        name: feat.name,
        description: feat.description,
        description_entries: feat.entries,
        status: "active",
        category: feat.category,
        workspace: ws.record,
        created_at: ago(5000),
        updated_at: ago(200),
      });
      ctx.features[feat.key] = f;
      await relate(db, p.record, "has_feature", f.record, { added_at: ago(5000) });
    }
  }

  console.log("  ✓ Projects (2) + Features (5)");
}

// ---------------------------------------------------------------------------
// 4. Tasks — all 7 statuses
// ---------------------------------------------------------------------------

async function seedTasks(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  type TaskDef = {
    key: string; title: string; status: string; priority: string;
    category: string; feature: string; description?: string;
    entries?: Array<{ text: string; created_at: Date }>;
  };

  const taskDefs: TaskDef[] = [
    { key: "t_open", title: "Research CDN providers for static asset delivery", status: "open", priority: "low", category: "research", feature: "rateLimit", description: "Compare Cloudflare, Fastly, and CloudFront for edge caching dashboard assets. Focus on cache invalidation latency and cost at 10M requests/month.",
      entries: [{ text: "Task created: compare CDN providers for static asset delivery.", created_at: ago(3000) }],
    },
    { key: "t_todo", title: "Draft API rate limiting design doc", status: "todo", priority: "medium", category: "engineering", feature: "rateLimit", description: "Document sliding window vs token bucket trade-offs, Redis vs in-memory options, and per-key vs per-endpoint granularity.",
      entries: [
        { text: "Task created: draft design doc for API rate limiting.", created_at: ago(3000) },
        { text: "Scope clarified: must cover per-key vs per-endpoint granularity after team discussion.", created_at: ago(2200) },
      ],
    },
    { key: "t_ready", title: "Implement sliding window rate limiter", status: "ready", priority: "high", category: "engineering", feature: "rateLimit", description: "Build the core rate limiter using Redis sorted sets. Must support configurable burst and sustained limits per API key. Decision confirmed: Redis sorted sets over token bucket.",
      entries: [
        { text: "Task created: implement core rate limiter.", created_at: ago(3000) },
        { text: "Decision confirmed: Redis sorted sets chosen — task updated to reflect implementation approach.", created_at: ago(2000) },
        { text: "Design doc dependency satisfied — task moved to ready.", created_at: ago(1000) },
      ],
    },
    { key: "t_inprog", title: "Configure read replica connection pooling", status: "in_progress", priority: "high", category: "engineering", feature: "readReplicas", description: "Set up PgBouncer connection pooling for read replicas with health checks and automatic failover to primary. Connection pool sizing determined: 20 connections per replica.",
      entries: [
        { text: "Task created: set up connection pooling for read replicas.", created_at: ago(3000) },
        { text: "Started work: evaluating PgBouncer vs pgcat for connection pooling.", created_at: ago(1200) },
        { text: "Connection pool sizing determined: 20 connections per replica based on load testing.", created_at: ago(600) },
      ],
    },
    { key: "t_blocked", title: "Migrate billing webhooks to event bus", status: "blocked", priority: "critical", category: "operations", feature: "usageBilling", description: "Blocked on event bus infrastructure decision. Need to choose between Kafka and SQS before migrating Stripe webhook handlers.",
      entries: [
        { text: "Task created: migrate Stripe webhook handlers to event bus.", created_at: ago(3000) },
        { text: "Blocked: waiting on event bus infrastructure decision (Kafka vs SQS).", created_at: ago(1800) },
      ],
    },
    { key: "t_done", title: "Set up usage metering for API calls", status: "done", priority: "medium", category: "operations", feature: "usageBilling", description: "All API endpoints instrumented with per-customer call counting. Hourly aggregation into billing_usage table is live. Invoice generation via Stripe integration verified in staging.",
      entries: [
        { text: "Task created: instrument all API endpoints with per-customer metering.", created_at: ago(3000) },
        { text: "Implemented per-customer call counting middleware across all API routes.", created_at: ago(2000) },
        { text: "Hourly aggregation into billing_usage table verified in staging.", created_at: ago(1500) },
        { text: "Task completed: metering is live, Stripe invoice generation confirmed.", created_at: ago(1400) },
      ],
    },
    { key: "t_completed", title: "Define pricing tier feature matrix", status: "completed", priority: "high", category: "sales", feature: "pricingTiers", description: "Feature matrix finalized for Starter, Growth, and Enterprise tiers. Published at /pricing and integrated with feature-flag service for runtime gating.",
      entries: [
        { text: "Task created: map features gated per pricing plan.", created_at: ago(3000) },
        { text: "First draft reviewed with sales team — added Enterprise-only SSO and audit log features.", created_at: ago(1800) },
        { text: "Task completed: matrix published at /pricing and wired to feature-flag service.", created_at: ago(600) },
      ],
    },
    { key: "t_subtask", title: "Write rate limiter unit tests", status: "todo", priority: "medium", category: "engineering", feature: "rateLimit", description: "Cover edge cases: burst overflow, TTL expiry race conditions, concurrent increment atomicity, and key rotation.",
      entries: [{ text: "Subtask created: write unit tests covering rate limiter edge cases.", created_at: ago(2800) }],
    },
    { key: "t_design", title: "Design notification preference UI", status: "ready", priority: "medium", category: "design", feature: "eventNotifs", description: "Mockup a settings page for users to choose notification channels (email, Slack, webhook) and frequency per event type.",
      entries: [
        { text: "Task created: design settings page for notification channel preferences.", created_at: ago(3000) },
        { text: "Dependency on rate limiter implementation acknowledged — design can proceed in parallel.", created_at: ago(1500) },
      ],
    },
    { key: "t_marketing", title: "Prepare pricing page copy for new tiers", status: "open", priority: "low", category: "marketing", feature: "pricingTiers", description: "Write headline, feature comparison table, and FAQ copy for the public pricing page redesign.",
      entries: [{ text: "Task created: write copy for pricing page redesign.", created_at: ago(3000) }],
    },
  ];

  for (const t of taskDefs) {
    const task = await create(db, "task", {
      title: t.title,
      status: t.status,
      priority: t.priority,
      category: t.category,
      workspace: ws.record,
      created_at: ago(3000),
      updated_at: ago(60),
      ...(t.description ? { description: t.description } : {}),
      ...(t.entries ? { description_entries: t.entries } : {}),
    });
    ctx.tasks[t.key] = task;

    const feat = ctx.features[t.feature];
    await relate(db, feat.record, "has_task", task.record, { added_at: ago(3000) });
    await relate(db, task.record, "belongs_to", feat.record, { added_at: ago(3000) });
  }

  // Dependencies
  await relate(db, ctx.tasks.t_ready.record, "depends_on", ctx.tasks.t_todo.record, { type: "needs", added_at: ago(2500) });
  await relate(db, ctx.tasks.t_blocked.record, "depends_on", ctx.tasks.t_inprog.record, { type: "blocks", added_at: ago(2000) });
  await relate(db, ctx.tasks.t_design.record, "depends_on", ctx.tasks.t_ready.record, { type: "soft", added_at: ago(1500) });

  // Subtask
  await relate(db, ctx.tasks.t_subtask.record, "subtask_of", ctx.tasks.t_ready.record, { added_at: ago(2800) });

  // Ownership
  await relate(db, ctx.coder.record, "owns", ctx.tasks.t_inprog.record, { assigned_at: ago(1000) });
  await relate(db, ctx.human.record, "owns", ctx.tasks.t_ready.record, { assigned_at: ago(2000) });

  console.log("  ✓ Tasks (10, all 7 statuses + deps + subtask)");
}

// ---------------------------------------------------------------------------
// 5. Decisions — all 7 statuses
// ---------------------------------------------------------------------------

async function seedDecisions(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  const decDefs: Array<{
    key: string; summary: string; status: string; rationale: string;
    category?: string; priority?: string; decidedBy?: RecordId;
  }> = [
    { key: "d_confirmed", summary: "Use Redis for rate limiting token buckets", status: "confirmed", rationale: "Redis provides atomic increment with TTL, proven at scale. Evaluated Memcached and in-process alternatives.", category: "engineering", priority: "high", decidedBy: ctx.human.record },
    { key: "d_provisional", summary: "Adopt event sourcing for billing state", status: "provisional", rationale: "Event sourcing provides full audit trail for financial transactions. Needs validation against query patterns.", category: "engineering", priority: "high" },
    { key: "d_proposed", summary: "Migrate to usage-based pricing model", status: "proposed", rationale: "Usage-based aligns revenue with customer value. Requires metering infrastructure.", category: "sales", priority: "critical" },
    { key: "d_extracted", summary: "Use PostgreSQL read replicas for analytics queries", status: "extracted", rationale: "Offload heavy analytics to replicas to protect primary write performance.", category: "engineering", priority: "medium" },
    { key: "d_inferred", summary: "Rate limit by API key, not IP address", status: "inferred", rationale: "API key granularity aligns with customer billing. Inferred from codebase patterns.", category: "engineering", priority: "medium" },
    { key: "d_contested", summary: "Use Stripe for payment processing", status: "contested", rationale: "Stripe has best DX, but costs 2.9% + 30c per transaction. Contested due to margin impact at scale.", category: "operations", priority: "high" },
    { key: "d_superseded", summary: "Use flat-rate pricing tiers", status: "confirmed", rationale: "Simple to implement and communicate. Later superseded by usage-based model.", category: "sales", priority: "medium" },
  ];

  for (const d of decDefs) {
    const dec = await create(db, "decision", {
      summary: d.summary,
      rationale: d.rationale,
      status: d.status,
      workspace: ws.record,
      created_at: ago(4000),
      updated_at: ago(100),
      ...(d.category ? { category: d.category } : {}),
      ...(d.priority ? { priority: d.priority } : {}),
      ...(d.decidedBy ? { decided_by: d.decidedBy, confirmed_by: d.decidedBy, confirmed_at: ago(200) } : {}),
      ...(d.status === "inferred" ? { inferred_by: "coding_agent" } : {}),
      ...(d.status === "extracted" ? { extraction_confidence: 0.85, extracted_at: ago(3500) } : {}),
    });
    ctx.decisions[d.key] = dec;

    // Link to project
    const proj = d.category === "sales" || d.category === "operations"
      ? ctx.projects.billing
      : ctx.projects.platform;
    await relate(db, dec.record, "belongs_to", proj.record, { added_at: ago(4000) });
  }

  // Superseded: d_superseded → superseded_by → d_proposed (the EVENT auto-sets status)
  await relate(db, ctx.decisions.d_superseded.record, "superseded_by", ctx.decisions.d_proposed.record, {
    reason: "Moving to usage-based pricing model",
    superseded_at: ago(500),
  });

  // Conflict: d_contested <-> d_provisional
  await relate(db, ctx.decisions.d_contested.record, "conflicts_with", ctx.decisions.d_provisional.record, {
    description: "Stripe transaction fees conflict with event sourcing complexity for billing reconciliation",
    severity: "warning",
    detected_at: ago(300),
  });

  console.log("  ✓ Decisions (7, all statuses + conflict + supersede)");
}

// ---------------------------------------------------------------------------
// 6. Questions
// ---------------------------------------------------------------------------

async function seedQuestions(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  const qDefs: Array<{
    key: string; text: string; status: string; priority: string;
    category: string; options?: string[]; answer?: string;
  }> = [
    {
      key: "q_blocking", text: "Should we enforce rate limits per-endpoint or globally per API key?",
      status: "open", priority: "high", category: "engineering",
      options: ["Per-endpoint limits", "Global per-key limits", "Hybrid: global base + per-endpoint overrides"],
    },
    {
      key: "q_open", text: "Which payment processor should we use for international transactions?",
      status: "open", priority: "medium", category: "operations",
      options: ["Stripe (current)", "Adyen", "Both with geographic routing"],
    },
    {
      key: "q_answered", text: "What SLA should we commit to for the analytics API?",
      status: "answered", priority: "high", category: "engineering",
      answer: "99.9% uptime with P95 latency under 200ms, measured monthly.",
    },
  ];

  for (const q of qDefs) {
    const question = await create(db, "question", {
      text: q.text,
      status: q.status,
      priority: q.priority,
      category: q.category,
      workspace: ws.record,
      created_at: ago(2000),
      updated_at: ago(100),
      asked_by: "Jordan Rivera",
      ...(q.options ? { options: q.options } : {}),
      ...(q.answer ? { answer_summary: q.answer } : {}),
    });
    ctx.questions[q.key] = question;

    await relate(db, question.record, "belongs_to", ctx.projects.platform.record, { added_at: ago(2000) });
  }

  // Link blocking question to blocked task
  await db.query(`UPDATE $q SET blocking_task = $t;`, {
    q: ctx.questions.q_blocking.record,
    t: ctx.tasks.t_blocked.record,
  });

  console.log("  ✓ Questions (3, open/blocking + answered)");
}

// ---------------------------------------------------------------------------
// 7. Conversations + Messages
// ---------------------------------------------------------------------------

async function seedConversations(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  // Conversation 1
  const conv1 = await create(db, "conversation", {
    workspace: ws.record,
    title: "Platform scalability planning",
    title_source: "message",
    createdAt: ago(5000),
    updatedAt: ago(200),
  });
  ctx.conversations.scalability = conv1;

  const msgs1: Array<{ role: string; text: string; ago: number }> = [
    { role: "user", text: "We need to handle 10x our current API traffic. What's the plan?", ago: 5000 },
    { role: "assistant", text: "I'd recommend three parallel workstreams: rate limiting to protect existing infrastructure, read replicas for analytics offloading, and an event-driven notification system to decouple write-heavy paths. Let me break those into features.", ago: 4990 },
    { role: "user", text: "Makes sense. Let's prioritize rate limiting — we had an outage last week from a single customer hammering the dashboard API.", ago: 4980 },
    { role: "assistant", text: "I've created the API Rate Limiting feature with three tasks. The sliding window approach gives us per-key granularity without the memory overhead of fixed windows. I've also logged a provisional decision to use Redis for the token bucket store.", ago: 4970 },
  ];

  for (const m of msgs1) {
    const msg = await create(db, "message", {
      conversation: conv1.record,
      role: m.role,
      text: m.text,
      createdAt: ago(m.ago),
    });
    ctx.messages[`conv1_${m.ago}`] = msg;
  }

  // Conversation 2
  const conv2 = await create(db, "conversation", {
    workspace: ws.record,
    title: "Billing architecture discussion",
    title_source: "message",
    discusses: ctx.projects.billing.record,
    createdAt: ago(3000),
    updatedAt: ago(150),
  });
  ctx.conversations.billing = conv2;

  const msgs2: Array<{ role: string; text: string; ago: number }> = [
    { role: "user", text: "We want to move from flat-rate to usage-based pricing. How should we approach the billing engine?", ago: 3000 },
    { role: "assistant", text: "Usage-based billing needs three components: a metering pipeline that counts API calls in real-time, a rating engine that applies pricing rules, and an invoicing system that generates monthly bills. Event sourcing gives us an immutable audit trail for compliance.", ago: 2990 },
    { role: "user", text: "What about Stripe? Can we keep using it or do we need to switch?", ago: 2980 },
    { role: "assistant", text: "Stripe supports usage-based billing via metered subscriptions, but their 2.9% + 30c fee structure becomes expensive at scale. I've flagged this as a contested decision — we should evaluate alternatives for high-volume international transactions.", ago: 2970 },
  ];

  for (const m of msgs2) {
    const msg = await create(db, "message", {
      conversation: conv2.record,
      role: m.role,
      text: m.text,
      createdAt: ago(m.ago),
    });
    ctx.messages[`conv2_${m.ago}`] = msg;
  }

  // touched_by edges
  await relate(db, ctx.projects.platform.record, "touched_by", conv1.record, { first_mention_at: ago(5000), entity_count: 3 });
  await relate(db, ctx.projects.billing.record, "touched_by", conv2.record, { first_mention_at: ago(3000), entity_count: 2 });

  // branched_from
  await relate(db, conv2.record, "branched_from", conv1.record, {
    branched_at: ago(3000),
    branch_point_message: ctx.messages.conv1_4980.record,
  });

  // decided_in
  await relate(db, ctx.decisions.d_confirmed.record, "decided_in", conv1.record, {
    message_ref: ctx.messages.conv1_4970.record,
    added_at: ago(4970),
  });

  console.log("  ✓ Conversations (2) + Messages (8)");
}

// ---------------------------------------------------------------------------
// 8. Agent Sessions + Traces
// ---------------------------------------------------------------------------

async function seedSessions(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  // Coding session (active)
  const codingSession = await create(db, "agent_session", {
    agent: "claude",
    workspace: ws.record,
    project: ctx.projects.platform.record,
    task_id: ctx.tasks.t_inprog.record,
    session_type: "sandbox_agent",
    provider: "anthropic",
    orchestrator_status: "active",
    started_at: ago(120),
    created_at: ago(120),
    external_session_id: `ext-coding-${crypto.randomUUID()}`,
    files_changed: [
      { path: "src/middleware/rate-limiter.ts", change_type: "created" },
      { path: "src/config/redis.ts", change_type: "modified" },
    ],
  });
  ctx.sessions.coding = codingSession;

  // Architect session (completed)
  const archSession = await create(db, "agent_session", {
    agent: "architect",
    workspace: ws.record,
    project: ctx.projects.billing.record,
    session_type: "review",
    provider: "anthropic",
    orchestrator_status: "completed",
    started_at: ago(1440),
    ended_at: ago(1400),
    created_at: ago(1440),
    summary: "Reviewed billing architecture. Proposed event sourcing for audit trail. Flagged Stripe fee conflict.",
    decisions_made: [ctx.decisions.d_provisional.record],
    external_session_id: `ext-arch-${crypto.randomUUID()}`,
  });
  ctx.sessions.architect = archSession;

  // Observer session (completed)
  const obsSession = await create(db, "agent_session", {
    agent: "observer",
    workspace: ws.record,
    session_type: "scan",
    provider: "anthropic",
    orchestrator_status: "completed",
    started_at: ago(360),
    ended_at: ago(340),
    created_at: ago(360),
    summary: "Graph scan complete. Found 3 contradictions, 2 stale tasks, 1 evidence anomaly.",
    external_session_id: `ext-obs-${crypto.randomUUID()}`,
  });
  ctx.sessions.observer = obsSession;

  // Traces
  const traceTypes: Array<{
    key: string; type: string; actor: RecordId; session: RecordId;
    toolName?: string; model?: string; durationMs?: number;
  }> = [
    { key: "tr_tool", type: "tool_call", actor: ctx.coder.record, session: codingSession.record, toolName: "create_work_item", durationMs: 450 },
    { key: "tr_msg", type: "message", actor: ctx.coder.record, session: codingSession.record, durationMs: 1200 },
    { key: "tr_spawn", type: "subagent_spawn", actor: ctx.architect.record, session: archSession.record, durationMs: 8500 },
    { key: "tr_intent", type: "intent_submission", actor: ctx.coder.record, session: codingSession.record, durationMs: 200 },
    { key: "tr_llm", type: "llm_call", actor: ctx.observer.record, session: obsSession.record, model: "claude-sonnet-4-20250514", durationMs: 3200, },
    { key: "tr_llm2", type: "llm_call", actor: ctx.coder.record, session: codingSession.record, model: "claude-sonnet-4-20250514", durationMs: 2100 },
  ];

  for (const t of traceTypes) {
    const trace = await create(db, "trace", {
      type: t.type,
      actor: t.actor,
      workspace: ws.record,
      session: t.session,
      created_at: ago(300),
      ...(t.toolName ? { tool_name: t.toolName } : {}),
      ...(t.model ? { model: t.model, provider: "openrouter" } : {}),
      ...(t.durationMs ? { duration_ms: t.durationMs } : {}),
      ...(t.type === "llm_call" ? { input_tokens: 2500, output_tokens: 800, cost_usd: 0.012 } : {}),
    });
    ctx.traces[t.key] = trace;

    // invoked edge
    await relate(db, t.session, "invoked", trace.record, { created_at: ago(300) });
    // scoped_to edge
    await relate(db, trace.record, "scoped_to", ws.record, { created_at: ago(300) });
  }

  // parent_trace: llm2 is child of tool call
  await db.query(`UPDATE $child SET parent_trace = $parent;`, {
    child: ctx.traces.tr_llm2.record,
    parent: ctx.traces.tr_tool.record,
  });

  // produced / asked / progressed edges
  await relate(db, archSession.record, "produced", ctx.decisions.d_provisional.record, { added_at: ago(1420) });
  await relate(db, codingSession.record, "asked", ctx.questions.q_blocking.record, { added_at: ago(100) });
  await relate(db, codingSession.record, "progressed", ctx.tasks.t_inprog.record, {
    from_status: "ready",
    to_status: "in_progress",
    added_at: ago(120),
  });

  // attributed_to
  await relate(db, ctx.traces.tr_tool.record, "attributed_to", ctx.tasks.t_inprog.record, { created_at: ago(300) });

  // spawns (message → trace)
  const firstMsg = ctx.messages.conv1_5000;
  if (firstMsg) {
    await relate(db, firstMsg.record, "spawns", ctx.traces.tr_msg.record);
  }

  console.log("  ✓ Agent Sessions (3) + Traces (6)");
}

// ---------------------------------------------------------------------------
// 9. Observations — all severities × types
// ---------------------------------------------------------------------------

async function seedObservations(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  const obsDefs: Array<{
    key: string; text: string; severity: string; type: string;
    status: string; verified?: boolean; target?: RecordId;
  }> = [
    { key: "obs_contradiction", text: "Decision to use Redis for rate limiting contradicts the 'minimize infrastructure dependencies' constraint", severity: "conflict", type: "contradiction", status: "open", target: ctx.decisions.d_confirmed.record },
    { key: "obs_duplication", text: "Task 'Set up usage metering' overlaps with existing billing instrumentation in analytics service", severity: "warning", type: "duplication", status: "acknowledged", verified: true, target: ctx.tasks.t_done.record },
    { key: "obs_missing", text: "No rollback plan defined for database replica migration", severity: "warning", type: "missing", status: "open", target: ctx.features.readReplicas.record },
    { key: "obs_deprecated", text: "Flat-rate pricing decision has been superseded but 3 tasks still reference it", severity: "info", type: "deprecated", status: "resolved", verified: true, target: ctx.decisions.d_superseded.record },
    { key: "obs_pattern", text: "Recurring pattern: billing-related tasks blocked by infrastructure decisions", severity: "info", type: "pattern", status: "open", verified: true },
    { key: "obs_anomaly", text: "Task completion rate dropped 40% in the last sprint — possible scope creep", severity: "warning", type: "anomaly", status: "open" },
    { key: "obs_validation", text: "Rate limiter implementation missing input validation for burst parameter", severity: "warning", type: "validation", status: "open", target: ctx.tasks.t_ready.record },
    { key: "obs_error", text: "Read replica connection pool exhaustion detected in staging environment", severity: "conflict", type: "error", status: "acknowledged", target: ctx.features.readReplicas.record },
    { key: "obs_alignment", text: "Pricing tier management feature lacks alignment with billing accuracy objective", severity: "info", type: "alignment", status: "open", target: ctx.features.pricingTiers.record },
    { key: "obs_evidence", text: "Intent for billing webhook migration has evidence refs from a single author — independent review recommended", severity: "warning", type: "evidence_anomaly", status: "open" },
    { key: "obs_info_ack", text: "New team member onboarded to platform project — context sync recommended", severity: "info", type: "pattern", status: "acknowledged" },
    { key: "obs_conflict_resolved", text: "Stripe vs Adyen conflict resolved — using Stripe with volume discount negotiation", severity: "conflict", type: "contradiction", status: "resolved", verified: true, target: ctx.decisions.d_contested.record },
  ];

  for (const o of obsDefs) {
    const obs = await create(db, "observation", {
      text: o.text,
      severity: o.severity,
      status: o.status,
      observation_type: o.type,
      source_agent: "observer",
      workspace: ws.record,
      created_at: ago(500),
      updated_at: ago(50),
      ...(o.verified ? { verified: true, confidence: 0.92 } : {}),
      ...(o.status === "resolved" ? { resolved_at: ago(100), resolved_by: ctx.human.record } : {}),
      reasoning: `Observer scan detected this ${o.type} signal with supporting evidence from workspace graph.`,
    });
    ctx.observations[o.key] = obs;

    if (o.target) {
      await relate(db, obs.record, "observes", o.target, { added_at: ago(500) });
    }
  }

  // similar_to
  await relate(db, ctx.observations.obs_contradiction.record, "similar_to", ctx.observations.obs_conflict_resolved.record, {
    similarity: 0.87,
    created_at: ago(400),
  });

  // observed_in
  await relate(db, ctx.observations.obs_contradiction.record, "observed_in", ctx.sessions.observer.record, { added_at: ago(350) });
  await relate(db, ctx.observations.obs_evidence.record, "observed_in", ctx.sessions.observer.record, { added_at: ago(350) });

  console.log("  ✓ Observations (12, all severities × types)");
}

// ---------------------------------------------------------------------------
// 10. Suggestions — all 6 categories × 5 statuses
// ---------------------------------------------------------------------------

async function seedSuggestions(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  const sugDefs: Array<{
    key: string; text: string; category: string; status: string;
    rationale: string; target: RecordId; convertedTo?: RecordId;
  }> = [
    { key: "sug_opt", text: "Consolidate rate limiter and auth middleware into a single request pipeline stage", category: "optimization", status: "pending", rationale: "Reduces per-request overhead by 15ms. Both middlewares read the same API key context.", target: ctx.features.rateLimit.record },
    { key: "sug_risk", text: "Add circuit breaker for read replica failover", category: "risk", status: "accepted", rationale: "Without a circuit breaker, replica lag cascades to user-facing latency spikes.", target: ctx.features.readReplicas.record },
    { key: "sug_opp", text: "Offer premium SLA tier with dedicated rate limit pools", category: "opportunity", status: "deferred", rationale: "Enterprise customers have asked for guaranteed throughput. Revenue potential: $50k/month ARR.", target: ctx.projects.billing.record },
    { key: "sug_conflict", text: "Resolve Stripe vs event sourcing billing conflict before sprint planning", category: "conflict", status: "dismissed", rationale: "The contested decision blocks two billing tasks and one feature.", target: ctx.decisions.d_contested.record },
    { key: "sug_missing", text: "Create runbook for billing webhook failure scenarios", category: "missing", status: "converted", rationale: "No incident response documentation exists for billing pipeline failures.", target: ctx.tasks.t_blocked.record, convertedTo: ctx.tasks.t_open.record },
    { key: "sug_pivot", text: "Consider per-seat pricing as hybrid complement to usage-based model", category: "pivot", status: "pending", rationale: "Pure usage-based pricing creates unpredictable revenue forecasts. Hybrid model provides base revenue floor.", target: ctx.projects.billing.record },
  ];

  for (const s of sugDefs) {
    const sug = await create(db, "suggestion", {
      text: s.text,
      category: s.category,
      status: s.status,
      rationale: s.rationale,
      suggested_by: "observer",
      confidence: 0.82,
      workspace: ws.record,
      created_at: ago(600),
      updated_at: ago(50),
      ...(s.status === "accepted" ? { accepted_at: ago(200) } : {}),
      ...(s.status === "dismissed" ? { dismissed_at: ago(300) } : {}),
      ...(s.status === "deferred" ? { deferred_at: ago(250) } : {}),
      ...(s.status === "converted" ? { converted_at: ago(150), converted_to: s.convertedTo } : {}),
    });
    ctx.suggestions[s.key] = sug;

    await relate(db, sug.record, "suggests_for", s.target, { added_at: ago(600) });
  }

  // suggestion_evidence
  await relate(db, ctx.suggestions.sug_risk.record, "suggestion_evidence", ctx.observations.obs_error.record, { added_at: ago(550) });
  await relate(db, ctx.suggestions.sug_conflict.record, "suggestion_evidence", ctx.decisions.d_contested.record, { added_at: ago(550) });

  // converted_from
  if (ctx.suggestions.sug_missing) {
    await relate(db, ctx.tasks.t_open.record, "converted_from", ctx.suggestions.sug_missing.record, { converted_at: ago(150) });
  }

  console.log("  ✓ Suggestions (6, all categories + statuses)");
}

// ---------------------------------------------------------------------------
// 11. Learnings — all types × statuses × sources
// ---------------------------------------------------------------------------

async function seedLearnings(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  const lDefs: Array<{
    key: string; text: string; type: string; status: string;
    source: string; targetAgents: string[]; priority?: string;
  }> = [
    { key: "l_active_human", text: "Always include rollback procedures in database migration tasks", type: "constraint", status: "active", source: "human", targetAgents: ["coding_agent", "architect"], priority: "high" },
    { key: "l_active_agent", text: "When creating billing-related tasks, include compliance review as a subtask", type: "instruction", status: "active", source: "agent", targetAgents: ["pm_agent", "coding_agent"] },
    { key: "l_pending", text: "Rate limiter configurations should be validated against production traffic patterns before deployment", type: "instruction", status: "pending_approval", source: "agent", targetAgents: ["coding_agent"] },
    { key: "l_dismissed", text: "Use in-memory rate limiting instead of Redis", type: "precedent", status: "dismissed", source: "agent", targetAgents: ["coding_agent"] },
    { key: "l_superseded", text: "Use fixed pricing tiers for all customer segments", type: "precedent", status: "active", source: "human", targetAgents: ["pm_agent", "chat_agent"] },
    { key: "l_superseding", text: "Evaluate usage-based pricing for each new customer segment", type: "precedent", status: "active", source: "human", targetAgents: ["pm_agent", "chat_agent"] },
    { key: "l_deactivated", text: "Avoid event-driven patterns for billing to reduce complexity", type: "constraint", status: "deactivated", source: "human", targetAgents: ["architect"] },
  ];

  for (const l of lDefs) {
    const learning = await create(db, "learning", {
      text: l.text,
      learning_type: l.type,
      status: l.status,
      source: l.source,
      priority: l.priority ?? "medium",
      target_agents: l.targetAgents,
      workspace: ws.record,
      created_at: ago(2000),
      updated_at: ago(50),
      ...(l.status === "active" ? { activated_at: ago(1900) } : {}),
      ...(l.status === "dismissed" ? { dismissed_at: ago(1500), dismissed_reason: "In-memory limiting doesn't work in multi-instance deployments" } : {}),
      ...(l.status === "deactivated" ? { deactivated_at: ago(800), deactivated_by: ctx.human.record } : {}),
      ...(l.source === "human" ? { created_by: ctx.human.record } : { suggested_by: "observer", pattern_confidence: 0.88 }),
      ...(l.status === "active" && l.source === "agent" ? { approved_by: ctx.human.record, approved_at: ago(1800) } : {}),
    });
    ctx.learnings[l.key] = learning;
  }

  // supersedes
  await relate(db, ctx.learnings.l_superseding.record, "supersedes", ctx.learnings.l_superseded.record, {
    superseded_at: ago(500),
    reason: "Pricing model shifted to usage-based",
  });

  // learning_evidence
  await relate(db, ctx.learnings.l_active_human.record, "learning_evidence", ctx.observations.obs_missing.record, { added_at: ago(1900) });
  await relate(db, ctx.learnings.l_active_agent.record, "learning_evidence", ctx.sessions.architect.record, { added_at: ago(1800) });

  console.log("  ✓ Learnings (7, all types + statuses + sources)");
}

// ---------------------------------------------------------------------------
// 12. Policies — all 5 statuses with version chain
// ---------------------------------------------------------------------------

async function seedPolicies(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  // Version chain: v1 (deprecated) → v2 (superseded) → v3 (active)
  const policyV1 = await create(db, "policy", {
    title: "Intent Authorization Policy",
    description: "Governs which agent actions require human approval. V1: basic allow/deny rules.",
    version: 1,
    status: "deprecated",
    selector: { workspace: ws.id },
    rules: [
      { id: "r1", condition: [{ field: "action_spec.action", operator: "equals", value: "deploy" }], effect: "deny", priority: 100 },
    ],
    rego_source: `package osabio.policy\n\ndefault allow := false\n\ndeny {\n  input.action_spec.action == "deploy"\n}`,
    human_veto_required: false,
    created_by: ctx.human.record,
    workspace: ws.record,
    created_at: ago(7000),
  });
  ctx.policies.v1 = policyV1;

  const policyV2 = await create(db, "policy", {
    title: "Intent Authorization Policy",
    description: "V2: added evidence requirements for high-risk actions.",
    version: 2,
    status: "superseded",
    selector: { workspace: ws.id },
    rules: [
      { id: "r1", condition: [{ field: "action_spec.action", operator: "equals", value: "deploy" }], effect: "deny", priority: 100 },
      { id: "r2", condition: [{ field: "priority", operator: "gte", value: 80 }], effect: "evidence_requirement", min_evidence_count: 2, required_types: ["decision", "task"], priority: 90 },
    ],
    rego_source: `package osabio.policy\n\ndefault allow := false\n\ndeny {\n  input.action_spec.action == "deploy"\n}\n\nevidence_requirement {\n  input.priority >= 80\n}`,
    human_veto_required: false,
    supersedes: policyV1.record,
    created_by: ctx.human.record,
    workspace: ws.record,
    created_at: ago(3500),
  });
  ctx.policies.v2 = policyV2;

  const policyV3 = await create(db, "policy", {
    title: "Intent Authorization Policy",
    description: "V3: added human veto window for financial actions and evidence requirement for all agent intents.",
    version: 3,
    status: "active",
    selector: { workspace: ws.id },
    rules: [
      { id: "r1", condition: [{ field: "action_spec.action", operator: "equals", value: "deploy" }], effect: "deny", priority: 100 },
      { id: "r2", condition: [{ field: "priority", operator: "gte", value: 80 }], effect: "evidence_requirement", min_evidence_count: 2, required_types: ["decision", "task"], priority: 90 },
      { id: "r3", condition: [{ field: "action_spec.provider", operator: "equals", value: "stripe" }], effect: "evidence_requirement", min_evidence_count: 3, priority: 95 },
    ],
    rego_source: `package osabio.policy\n\ndefault allow := false\n\ndeny {\n  input.action_spec.action == "deploy"\n}\n\nevidence_requirement {\n  input.priority >= 80\n}\n\nevidence_requirement {\n  input.action_spec.provider == "stripe"\n}`,
    human_veto_required: true,
    max_ttl: "PT1H",
    supersedes: policyV2.record,
    created_by: ctx.human.record,
    workspace: ws.record,
    created_at: ago(1000),
  });
  ctx.policies.v3 = policyV3;

  // Draft policy
  const policyDraft = await create(db, "policy", {
    title: "Billing Action Guardrails",
    description: "Draft policy for restricting automated billing operations above $10k threshold.",
    version: 1,
    status: "draft",
    selector: { workspace: ws.id, resource: "billing" },
    rules: [
      { id: "r1", condition: [{ field: "budget_limit.amount", operator: "gte", value: 10000 }], effect: "deny", priority: 100 },
    ],
    rego_source: `package osabio.policy\n\ndefault allow := false\n\ndeny {\n  input.budget_limit.amount >= 10000\n}`,
    human_veto_required: true,
    created_by: ctx.human.record,
    workspace: ws.record,
    created_at: ago(200),
  });
  ctx.policies.draft = policyDraft;

  // Testing policy
  const policyTesting = await create(db, "policy", {
    title: "Read Replica Access Control",
    description: "Testing: restrict direct replica writes to admin identities only.",
    version: 1,
    status: "testing",
    selector: { workspace: ws.id, agent_role: "code_agent" },
    rules: [
      { id: "r1", condition: [{ field: "action_spec.action", operator: "equals", value: "write_replica" }], effect: "deny", priority: 100 },
      { id: "r2", condition: [{ field: "action_spec.action", operator: "equals", value: "read_replica" }], effect: "allow", priority: 50 },
    ],
    rego_source: `package osabio.policy\n\ndefault allow := false\n\ndeny {\n  input.action_spec.action == "write_replica"\n}\n\nallow {\n  input.action_spec.action == "read_replica"\n}`,
    human_veto_required: false,
    created_by: ctx.human.record,
    workspace: ws.record,
    created_at: ago(100),
  });
  ctx.policies.testing = policyTesting;

  // Edges
  for (const p of [policyV1, policyV2, policyV3, policyDraft, policyTesting]) {
    await relate(db, p.record, "protects", ws.record, { created_at: ago(1000) });
    await relate(db, ctx.human.record, "governing", p.record, { created_at: ago(1000) });
  }

  // governed_by (trace → policy)
  await relate(db, ctx.traces.tr_intent.record, "governed_by", policyV3.record, {
    created_at: ago(300),
    decision: "pass",
  });

  console.log("  ✓ Policies (5, all statuses + version chain)");
}

// ---------------------------------------------------------------------------
// 13. Objectives — all 5 statuses
// ---------------------------------------------------------------------------

async function seedObjectives(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  const objDefs: Array<{
    key: string; title: string; status: string; priority: string;
    description: string; project?: string;
    criteria?: Array<{ metric_name: string; target_value: number; current_value: number; unit: string }>;
  }> = [
    {
      key: "obj_latency", title: "Reduce P95 API latency below 200ms", status: "active", priority: "critical",
      description: "Platform reliability target for enterprise SLA commitments.", project: "platform",
      criteria: [
        { metric_name: "P95 Latency", target_value: 200, current_value: 340, unit: "ms" },
        { metric_name: "Error Rate", target_value: 0.1, current_value: 0.3, unit: "%" },
      ],
    },
    {
      key: "obj_billing", title: "Achieve 99.9% billing accuracy", status: "active", priority: "high",
      description: "Financial accuracy target for SOC 2 compliance.", project: "billing",
      criteria: [
        { metric_name: "Billing Accuracy", target_value: 99.9, current_value: 99.2, unit: "%" },
      ],
    },
    { key: "obj_soc2", title: "Complete SOC 2 Type II certification", status: "draft", priority: "high", description: "Regulatory requirement for enterprise sales." },
    { key: "obj_selfserve", title: "Launch self-serve plan upgrades", status: "completed", priority: "medium", description: "Customers can upgrade/downgrade without contacting sales." },
    { key: "obj_v2api", title: "Migrate all customers to v2 API", status: "expired", priority: "low", description: "V1 API deprecation target — missed Q4 deadline." },
  ];

  for (const o of objDefs) {
    const obj = await create(db, "objective", {
      title: o.title,
      description: o.description,
      status: o.status,
      priority: o.priority,
      workspace: ws.record,
      created_at: ago(5000),
      updated_at: ago(100),
      ...(o.criteria ? { success_criteria: o.criteria } : {}),
    });
    ctx.objectives[o.key] = obj;

    // has_objective from project or workspace
    if (o.project) {
      await relate(db, ctx.projects[o.project].record, "has_objective", obj.record, { added_at: ago(5000) });
    } else {
      await relate(db, ws.record, "has_objective", obj.record, { added_at: ago(5000) });
    }
  }

  console.log("  ✓ Objectives (5, all statuses)");
}

// ---------------------------------------------------------------------------
// 14. Behavior Definitions + Behaviors
// ---------------------------------------------------------------------------

async function seedBehaviors(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  const bdDefs: Array<{
    key: string; title: string; goal: string; status: string;
    enforcementMode: string; threshold?: number;
  }> = [
    { key: "bd_traceability", title: "Decision Traceability", goal: "Agents link every decision to supporting evidence", status: "active", enforcementMode: "warn_only", threshold: 0.7 },
    { key: "bd_quality", title: "Observation Quality", goal: "Observer produces verified observations with reasoning", status: "active", enforcementMode: "automatic", threshold: 0.8 },
    { key: "bd_decomposition", title: "Task Decomposition Discipline", goal: "Complex tasks are broken into subtasks before execution", status: "draft", enforcementMode: "warn_only" },
  ];

  for (const bd of bdDefs) {
    const def = await create(db, "behavior_definition", {
      title: bd.title,
      goal: bd.goal,
      scoring_logic: `Evaluate ${bd.goal.toLowerCase()} against workspace telemetry.`,
      telemetry_types: ["trace", "intent"],
      category: "governance",
      status: bd.status,
      version: 1,
      enforcement_mode: bd.enforcementMode,
      workspace: ws.record,
      created_by: ctx.human.record,
      created_at: ago(3000),
      updated_at: ago(100),
      ...(bd.threshold ? { enforcement_threshold: bd.threshold } : {}),
    });
    ctx.behaviorDefs[bd.key] = def;
  }

  // Behavior records (scored instances)
  const behaviorScores: Array<{
    key: string; defKey: string; score: number; identity: RecordId; session?: RecordId;
  }> = [
    { key: "b1", defKey: "bd_traceability", score: 0.85, identity: ctx.coder.record, session: ctx.sessions.coding.record },
    { key: "b2", defKey: "bd_traceability", score: 0.72, identity: ctx.architect.record, session: ctx.sessions.architect.record },
    { key: "b3", defKey: "bd_quality", score: 0.91, identity: ctx.observer.record, session: ctx.sessions.observer.record },
    { key: "b4", defKey: "bd_quality", score: 0.65, identity: ctx.coder.record, session: ctx.sessions.coding.record },
  ];

  for (const b of behaviorScores) {
    const behavior = await create(db, "behavior", {
      metric_type: ctx.behaviorDefs[b.defKey].id,
      score: b.score,
      source_telemetry: { traces_analyzed: 15, evidence_ratio: b.score },
      workspace: ws.record,
      definition: ctx.behaviorDefs[b.defKey].record,
      definition_version: 1,
      created_at: ago(200),
      ...(b.session ? { session: b.session } : {}),
    });
    ctx.behaviors[b.key] = behavior;

    // exhibits edge
    await relate(db, b.identity, "exhibits", behavior.record, { created_at: ago(200), added_at: ago(200) });
  }

  console.log("  ✓ Behavior Definitions (3) + Behaviors (4)");
}

// ---------------------------------------------------------------------------
// 15. Intents — all 8 statuses
// ---------------------------------------------------------------------------

async function seedIntents(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  const intentDefs: Array<{
    key: string; goal: string; status: string; priority: number;
    action: string; provider: string; requester: RecordId;
    evaluation?: Record<string, unknown>;
    evidenceRefs?: RecordId[];
    evidenceVerification?: Record<string, unknown>;
    budget?: { amount: number; currency: string };
    vetoReason?: string; errorReason?: string;
  }> = [
    { key: "i_draft", goal: "Review supplier risk assessment for Q3", status: "draft", priority: 30, action: "review", provider: "internal", requester: ctx.coder.record },
    {
      key: "i_pending_auth", goal: "Deploy rate limiter to staging environment", status: "pending_auth", priority: 70, action: "deploy", provider: "kubernetes", requester: ctx.coder.record,
      evidenceRefs: [ctx.decisions.d_confirmed.record, ctx.tasks.t_ready.record],
      evidenceVerification: { verified_count: 2, total_count: 2, verification_time_ms: 45, enforcement_mode: "soft", tier_met: true, independent_author_count: 2 },
    },
    {
      key: "i_pending_veto", goal: "Execute automated refund batch for APAC region", status: "pending_veto", priority: 85, action: "batch_refund", provider: "stripe", requester: ctx.architect.record,
      budget: { amount: 25000, currency: "USD" },
      evaluation: { decision: "APPROVE", risk_score: 75, reason: "High-value financial operation requires human veto window", reasoning: "Policy r3 triggered: Stripe provider actions require 3+ evidence refs", evaluated_at: ago(50), policy_only: false, policy_trace: [{ policy_id: ctx.policies.v3.id, policy_version: 3, rule_id: "r3", effect: "evidence_requirement", matched: true, priority: 95 }], human_veto_required: true },
      evidenceRefs: [ctx.decisions.d_provisional.record, ctx.tasks.t_done.record, ctx.learnings.l_active_agent.record],
    },
    {
      key: "i_authorized", goal: "Create read replica connection pool configuration", status: "authorized", priority: 60, action: "configure", provider: "postgresql", requester: ctx.coder.record,
      evaluation: { decision: "APPROVE", risk_score: 25, reason: "Low-risk infrastructure configuration", evaluated_at: ago(80), policy_only: true, policy_trace: [{ policy_id: ctx.policies.v3.id, policy_version: 3, rule_id: "r2", effect: "allow", matched: false, priority: 90 }] },
      evidenceRefs: [ctx.decisions.d_confirmed.record, ctx.features.readReplicas.record],
      evidenceVerification: { verified_count: 2, total_count: 2, verification_time_ms: 32, enforcement_mode: "soft", tier_met: true, independent_author_count: 2 },
    },
    {
      key: "i_executing", goal: "Run billing reconciliation audit", status: "executing", priority: 50, action: "audit", provider: "internal", requester: ctx.observer.record,
      evidenceRefs: [ctx.tasks.t_done.record, ctx.decisions.d_provisional.record],
      evidenceVerification: { verified_count: 2, total_count: 2, verification_time_ms: 28, enforcement_mode: "soft", tier_met: true, independent_author_count: 1 },
    },
    {
      key: "i_completed", goal: "Generate analytics dashboard for API latency metrics", status: "completed", priority: 40, action: "generate", provider: "internal", requester: ctx.coder.record,
      evaluation: { decision: "APPROVE", risk_score: 10, reason: "Read-only analytics operation", evaluated_at: ago(1500), policy_only: true },
      evidenceRefs: [ctx.tasks.t_inprog.record],
      evidenceVerification: { verified_count: 1, total_count: 1, verification_time_ms: 12, enforcement_mode: "bootstrap", tier_met: true },
    },
    {
      key: "i_vetoed", goal: "Auto-approve all refunds under $100 without review", status: "vetoed", priority: 90, action: "auto_approve", provider: "stripe", requester: ctx.architect.record, vetoReason: "Compliance requires human review for all financial transactions regardless of amount",
      evidenceRefs: [ctx.decisions.d_contested.record, ctx.learnings.l_active_human.record, ctx.policies.v3.record],
      evidenceVerification: { verified_count: 3, total_count: 3, verification_time_ms: 55, enforcement_mode: "hard", tier_met: true, independent_author_count: 2 },
    },
    {
      key: "i_failed", goal: "Migrate legacy billing records to event store", status: "failed", priority: 65, action: "migrate", provider: "internal", requester: ctx.coder.record, errorReason: "Event store schema validation failed: missing required 'currency' field in 23% of legacy records",
      evidenceRefs: [ctx.tasks.t_blocked.record, ctx.features.usageBilling.record],
      evidenceVerification: { verified_count: 1, total_count: 2, failed_refs: [ctx.features.usageBilling.id], verification_time_ms: 38, enforcement_mode: "soft", tier_met: false, warnings: ["Feature ref not linked to requester's project scope"] },
    },
  ];

  for (const i of intentDefs) {
    // Create trace first (required by intent)
    const trace = await create(db, "trace", {
      type: "intent_submission",
      actor: i.requester,
      workspace: ws.record,
      created_at: ago(400),
    });

    const intentContent: Record<string, unknown> = {
      goal: i.goal,
      reasoning: `Agent determined: ${i.goal.toLowerCase()}`,
      status: i.status,
      priority: i.priority,
      action_spec: { provider: i.provider, action: i.action, params: {} },
      trace_id: trace.record,
      requester: i.requester,
      workspace: ws.record,
      created_at: ago(400),
      updated_at: ago(30),
    };

    if (i.evaluation) intentContent.evaluation = i.evaluation;
    if (i.evidenceRefs) intentContent.evidence_refs = i.evidenceRefs;
    if (i.evidenceVerification) intentContent.evidence_verification = i.evidenceVerification;
    if (i.budget) intentContent.budget_limit = i.budget;
    if (i.vetoReason) intentContent.veto_reason = i.vetoReason;
    if (i.errorReason) intentContent.error_reason = i.errorReason;
    if (i.status === "pending_veto") intentContent.veto_expires_at = future(60);

    const intent = await create(db, "intent", intentContent);
    ctx.intents[i.key] = intent;
  }

  // triggered_by (intent → task)
  await relate(db, ctx.intents.i_authorized.record, "triggered_by", ctx.tasks.t_inprog.record, { created_at: ago(400) });
  await relate(db, ctx.intents.i_executing.record, "triggered_by", ctx.tasks.t_done.record, { created_at: ago(400) });

  // gates (intent → agent_session)
  await relate(db, ctx.intents.i_authorized.record, "gates", ctx.sessions.coding.record, { created_at: ago(300) });

  // vetoed_by (identity → intent)
  await relate(db, ctx.human.record, "vetoed_by", ctx.intents.i_vetoed.record, {
    reason: "Compliance requires human review for all financial transactions",
    vetoed_at: ago(200),
  });

  // supports (intent → objective)
  await relate(db, ctx.intents.i_pending_auth.record, "supports", ctx.objectives.obj_latency.record, {
    alignment_score: 0.88,
    alignment_method: "embedding",
    reasoning: "Rate limiter deployment directly supports latency reduction objective",
    added_at: ago(400),
  });
  await relate(db, ctx.intents.i_executing.record, "supports", ctx.objectives.obj_billing.record, {
    alignment_score: 0.92,
    alignment_method: "manual",
    added_at: ago(400),
  });

  console.log("  ✓ Intents (8, all statuses)");
}

// ---------------------------------------------------------------------------
// 16. Git Commits
// ---------------------------------------------------------------------------

async function seedCommits(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  const commitDefs: Array<{ key: string; sha: string; message: string; author: RecordId }> = [
    { key: "c1", sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", message: "feat: implement sliding window rate limiter with Redis backend", author: ctx.coder.record },
    { key: "c2", sha: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3", message: "fix: correct connection pool exhaustion in read replica failover", author: ctx.coder.record },
    { key: "c3", sha: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4", message: "feat: add usage metering pipeline for API call tracking", author: ctx.coder.record },
  ];

  for (const c of commitDefs) {
    const commit = await create(db, "git_commit", {
      sha: c.sha,
      repository: "acme-analytics/platform",
      message: c.message,
      author: c.author,
      author_name: "Coding Agent",
      authored_at: ago(500),
      workspace: ws.record,
      created_at: ago(500),
    });
    ctx.commits[c.key] = commit;
  }

  // implemented_by (decision/task → git_commit)
  await relate(db, ctx.decisions.d_confirmed.record, "implemented_by", ctx.commits.c1.record, { commit_sha: commitDefs[0].sha, linked_at: ago(500) });
  await relate(db, ctx.tasks.t_done.record, "implemented_by", ctx.commits.c3.record, { commit_sha: commitDefs[2].sha, linked_at: ago(500) });

  console.log("  ✓ Git Commits (3)");
}

// ---------------------------------------------------------------------------
// 17. MCP Infrastructure
// ---------------------------------------------------------------------------

async function seedMcpInfrastructure(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  // Credential providers
  const oauthProvider = await create(db, "credential_provider", {
    name: "github",
    display_name: "GitHub",
    auth_method: "oauth2",
    workspace: ws.record,
    authorization_url: "https://github.com/login/oauth/authorize",
    token_url: "https://github.com/login/oauth/access_token",
    client_id: "seed-client-id",
    scopes: ["repo", "read:org"],
    created_at: ago(5000),
  });

  const apiKeyProvider = await create(db, "credential_provider", {
    name: "datadog",
    display_name: "Datadog",
    auth_method: "api_key",
    workspace: ws.record,
    api_key_header: "DD-API-KEY",
    created_at: ago(5000),
  });

  // MCP servers
  const serverOk = await create(db, "mcp_server", {
    name: "GitHub Tools",
    url: "https://mcp.github.example.com/sse",
    transport: "streamable-http",
    workspace: ws.record,
    provider: oauthProvider.record,
    last_status: "ok",
    last_discovery: ago(60),
    tool_count: 3,
    created_at: ago(5000),
  });
  ctx.mcpServers.github = serverOk;

  const serverErr = await create(db, "mcp_server", {
    name: "Datadog Monitors",
    url: "https://mcp.datadog.example.com/sse",
    transport: "sse",
    workspace: ws.record,
    provider: apiKeyProvider.record,
    last_status: "error",
    last_error: "Connection timeout after 30s",
    tool_count: 0,
    created_at: ago(3000),
  });
  ctx.mcpServers.datadog = serverErr;

  // MCP tools
  const toolDefs: Array<{ key: string; name: string; toolkit: string; risk: string; server: RecordId }> = [
    { key: "mt_pr", name: "create_pull_request", toolkit: "github", risk: "medium", server: serverOk.record },
    { key: "mt_issue", name: "create_issue", toolkit: "github", risk: "low", server: serverOk.record },
    { key: "mt_deploy", name: "trigger_deployment", toolkit: "github", risk: "critical", server: serverOk.record },
    { key: "mt_monitor", name: "create_monitor", toolkit: "datadog", risk: "high", server: serverErr.record },
  ];

  for (const t of toolDefs) {
    const tool = await create(db, "mcp_tool", {
      name: t.name,
      toolkit: t.toolkit,
      description: `${t.toolkit}:${t.name} — ${t.risk} risk tool`,
      input_schema: { type: "object", properties: { title: { type: "string" } } },
      risk_level: t.risk,
      workspace: ws.record,
      status: "active",
      source_server: t.server,
      created_at: ago(5000),
    });
    ctx.mcpTools[t.key] = tool;
  }

  // can_use edges
  await relate(db, ctx.coder.record, "can_use", ctx.mcpTools.mt_pr.record, { granted_at: ago(4000) });
  await relate(db, ctx.coder.record, "can_use", ctx.mcpTools.mt_issue.record, { granted_at: ago(4000) });
  await relate(db, ctx.human.record, "can_use", ctx.mcpTools.mt_deploy.record, { granted_at: ago(4000) });

  // governs_tool (policy → mcp_tool)
  await relate(db, ctx.policies.v3.record, "governs_tool", ctx.mcpTools.mt_deploy.record, {
    conditions: "Requires evidence_requirement check",
    max_per_day: 5,
  });

  console.log("  ✓ MCP Infrastructure (2 servers + 4 tools + grants)");
}

// ---------------------------------------------------------------------------
// 18. Documents
// ---------------------------------------------------------------------------

async function seedDocuments(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  const doc = await create(db, "document", {
    workspace: ws.record,
    name: "SOC 2 Compliance Requirements 2026.pdf",
    mime_type: "application/pdf",
    size_bytes: 245760,
    uploaded_at: ago(2000),
  });
  ctx.documents.soc2 = doc;

  await create(db, "document_chunk", {
    document: doc.record,
    workspace: ws.record,
    content: "Section 3.1: All financial transactions must maintain an immutable audit trail with timestamps, actor identity, and authorization evidence.",
    section_heading: "Audit Trail Requirements",
    position: 0,
    created_at: ago(2000),
  });

  await create(db, "document_chunk", {
    document: doc.record,
    workspace: ws.record,
    content: "Section 5.2: Automated systems must implement rate limiting and access controls. API keys must be rotated every 90 days.",
    section_heading: "Access Control Standards",
    position: 1,
    created_at: ago(2000),
  });

  console.log("  ✓ Documents (1 + 2 chunks)");
}

// ---------------------------------------------------------------------------
// 19. Audit Events
// ---------------------------------------------------------------------------

async function seedAuditEvents(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  const events: Array<{ type: string; severity: string; payload: Record<string, unknown> }> = [
    { type: "intent_submitted", severity: "info", payload: { intent_goal: "Deploy rate limiter" } },
    { type: "intent_evaluated", severity: "info", payload: { decision: "APPROVE", risk_score: 25 } },
    { type: "intent_routed", severity: "info", payload: { route: "auto_authorize" } },
    { type: "consent_approved", severity: "info", payload: { scope: "deploy:staging" } },
    { type: "token_issued", severity: "info", payload: { ttl: "PT1H" } },
    { type: "policy_created", severity: "info", payload: { policy_title: "Intent Authorization Policy" } },
    { type: "policy_activated", severity: "info", payload: { version: 3 } },
    { type: "dpop_rejected", severity: "security", payload: { reason: "Expired proof" } },
    { type: "security_alert", severity: "security", payload: { alert: "Unusual intent submission rate from coding agent" } },
    { type: "consent_vetoed", severity: "warning", payload: { reason: "Compliance requirement" } },
  ];

  for (const e of events) {
    await create(db, "audit_event", {
      event_type: e.type,
      severity: e.severity,
      actor: ctx.human.record,
      workspace: ws.record,
      payload: e.payload,
      created_at: ago(Math.floor(Math.random() * 5000)),
    });
  }

  console.log("  ✓ Audit Events (10)");
}

// ---------------------------------------------------------------------------
// 20. Authority Scopes + Proxy Tokens
// ---------------------------------------------------------------------------

async function seedAuthority(ctx: SeedCtx): Promise<void> {
  const { db, ws } = ctx;

  // Workspace-scoped authority overrides
  const scopeOverride = await create(db, "authority_scope", {
    action: "confirm_decision",
    permission: "provisional",
    workspace: ws.record,
    created_at: ago(3000),
  });

  await relate(db, ctx.coder.record, "authorized_to", scopeOverride.record, {
    permission: "provisional",
    created_at: ago(3000),
  });

  // Proxy tokens for agent identities
  for (const agent of [ctx.coder, ctx.architect, ctx.observer]) {
    const rawToken = `osb_seed_${crypto.randomUUID()}`;
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await create(db, "proxy_token", {
      token_hash: tokenHash,
      workspace: ws.record,
      identity: agent.record,
      expires_at: future(1440), // 24h
      revoked: false,
      created_at: ago(100),
    });
  }

  console.log("  ✓ Authority Scopes + Proxy Tokens");
}

// ---------------------------------------------------------------------------
// 21. Extraction + Entity Relations
// ---------------------------------------------------------------------------

async function seedRelations(ctx: SeedCtx): Promise<void> {
  const { db } = ctx;

  // extraction_relation (message → entity)
  const msg = ctx.messages.conv1_4970;
  if (msg) {
    await relate(db, msg.record, "extraction_relation", ctx.decisions.d_confirmed.record, {
      confidence: 0.92,
      extracted_at: ago(4960),
      created_at: ago(4960),
      model: "claude-haiku-4-5-20251001",
      from_text: "use Redis for the token bucket store",
      to_text: "Use Redis for rate limiting token buckets",
    });

    await relate(db, msg.record, "extraction_relation", ctx.tasks.t_ready.record, {
      confidence: 0.88,
      extracted_at: ago(4960),
      created_at: ago(4960),
      model: "claude-haiku-4-5-20251001",
      from_text: "sliding window approach",
      to_text: "Implement sliding window rate limiter",
    });
  }

  // entity_relation (entity → entity)
  await relate(db, ctx.decisions.d_confirmed.record, "entity_relation", ctx.tasks.t_ready.record, {
    kind: "INFORMS",
    confidence: 0.95,
    extracted_at: ago(4000),
    created_at: ago(4000),
  });

  await relate(db, ctx.tasks.t_done.record, "entity_relation", ctx.features.usageBilling.record, {
    kind: "IMPLEMENTS",
    confidence: 0.9,
    extracted_at: ago(3000),
    created_at: ago(3000),
  });

  await relate(db, ctx.decisions.d_proposed.record, "entity_relation", ctx.decisions.d_superseded.record, {
    kind: "REPLACES",
    confidence: 0.88,
    extracted_at: ago(2000),
    created_at: ago(2000),
  });

  console.log("  ✓ Extraction + Entity Relations");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const url = requireEnv("SURREAL_URL");
  const username = requireEnv("SURREAL_USERNAME");
  const password = requireEnv("SURREAL_PASSWORD");
  const namespace = requireEnv("SURREAL_NAMESPACE");
  const database = requireEnv("SURREAL_DATABASE");

  const db = new Surreal();
  await db.connect(url);
  await db.signin({ username, password });
  await db.use({ namespace, database });

  console.log(`\nSeeding "${WORKSPACE_NAME}" workspace...\n`);

  // Cleanup existing
  await cleanup(db);

  // Initialize context
  const ctx: SeedCtx = {
    db,
    ws: undefined as unknown as Ref<"workspace">,
    person: undefined as unknown as Ref<"person">,
    human: undefined as unknown as Ref<"identity">,
    coder: undefined as unknown as Ref<"identity">,
    architect: undefined as unknown as Ref<"identity">,
    observer: undefined as unknown as Ref<"identity">,
    projects: {}, features: {}, tasks: {}, decisions: {}, questions: {},
    conversations: {}, messages: {}, sessions: {}, traces: {},
    observations: {}, suggestions: {}, learnings: {}, policies: {},
    objectives: {}, behaviorDefs: {}, behaviors: {}, intents: {},
    commits: {}, mcpTools: {}, mcpServers: {}, documents: {},
  };

  ctx.ws = await seedWorkspace(db);
  ctx.db = db;
  await seedIdentities(ctx);
  await seedProjects(ctx);
  await seedTasks(ctx);
  await seedDecisions(ctx);
  await seedQuestions(ctx);
  await seedConversations(ctx);
  await seedSessions(ctx);
  await seedObservations(ctx);
  await seedSuggestions(ctx);
  await seedLearnings(ctx);
  await seedPolicies(ctx);
  await seedObjectives(ctx);
  await seedBehaviors(ctx);
  await seedIntents(ctx);
  await seedCommits(ctx);
  await seedMcpInfrastructure(ctx);
  await seedDocuments(ctx);
  await seedAuditEvents(ctx);
  await seedAuthority(ctx);
  await seedRelations(ctx);

  console.log(`\n✓ Seed complete. Workspace ID: ${ctx.ws.id}\n`);
  console.log(`  Log in as: jordan@acme-analytics.com / seed-password-2026\n`);

  await db.close();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

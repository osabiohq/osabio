BEGIN TRANSACTION;

-- Learning table: behavioral rules injected into agent prompts at runtime
DEFINE TABLE OVERWRITE learning SCHEMAFULL;

DEFINE FIELD OVERWRITE text ON learning TYPE string;
DEFINE FIELD OVERWRITE learning_type ON learning TYPE string
  ASSERT $value IN ["constraint", "instruction", "precedent"];
DEFINE FIELD OVERWRITE status ON learning TYPE string
  ASSERT $value IN ["active", "pending_approval", "dismissed", "superseded", "deactivated"];
DEFINE FIELD OVERWRITE source ON learning TYPE string
  ASSERT $value IN ["human", "agent"];
DEFINE FIELD OVERWRITE priority ON learning TYPE string
  DEFAULT "medium"
  ASSERT $value IN ["low", "medium", "high"];
DEFINE FIELD OVERWRITE target_agents ON learning TYPE array<string>;
DEFINE FIELD OVERWRITE workspace ON learning TYPE record<workspace>;

-- Agent suggestion metadata
DEFINE FIELD OVERWRITE suggested_by ON learning TYPE option<string>;
DEFINE FIELD OVERWRITE pattern_confidence ON learning TYPE option<float>;

-- Audit trail: creation
DEFINE FIELD OVERWRITE created_by ON learning TYPE option<record<identity>>;
DEFINE FIELD OVERWRITE created_at ON learning TYPE datetime;
DEFINE FIELD OVERWRITE updated_at ON learning TYPE option<datetime>;

-- Audit trail: approval
DEFINE FIELD OVERWRITE approved_by ON learning TYPE option<record<identity>>;
DEFINE FIELD OVERWRITE approved_at ON learning TYPE option<datetime>;
DEFINE FIELD OVERWRITE activated_at ON learning TYPE option<datetime>;

-- Audit trail: dismissal
DEFINE FIELD OVERWRITE dismissed_by ON learning TYPE option<record<identity>>;
DEFINE FIELD OVERWRITE dismissed_at ON learning TYPE option<datetime>;
DEFINE FIELD OVERWRITE dismissed_reason ON learning TYPE option<string>;

-- Audit trail: deactivation
DEFINE FIELD OVERWRITE deactivated_by ON learning TYPE option<record<identity>>;
DEFINE FIELD OVERWRITE deactivated_at ON learning TYPE option<datetime>;

-- Embedding for semantic search
DEFINE FIELD OVERWRITE embedding ON learning TYPE option<array<float>>;

-- Indexes
DEFINE INDEX OVERWRITE idx_learning_workspace_status ON learning FIELDS workspace, status;
DEFINE INDEX OVERWRITE idx_learning_embedding ON learning FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

-- Evidence relation: links a learning to the entities that support it
DEFINE TABLE OVERWRITE learning_evidence TYPE RELATION IN learning OUT message | trace | observation | agent_session SCHEMAFULL;
DEFINE FIELD OVERWRITE added_at ON learning_evidence TYPE option<datetime>;

-- Supersession relation: tracks when one learning replaces another
DEFINE TABLE OVERWRITE supersedes TYPE RELATION IN learning OUT learning SCHEMAFULL;
DEFINE FIELD OVERWRITE superseded_at ON supersedes TYPE datetime;
DEFINE FIELD OVERWRITE reason ON supersedes TYPE option<string>;

COMMIT TRANSACTION;

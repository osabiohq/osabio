-- Add Suggestion entity for proactive agent insights (Issue #80)
-- Suggestions are agent-to-human proposals built on accumulated observations.

BEGIN TRANSACTION;

-- Suggestion entity
DEFINE TABLE OVERWRITE suggestion SCHEMAFULL;
DEFINE FIELD OVERWRITE text ON suggestion TYPE string;
DEFINE FIELD OVERWRITE category ON suggestion TYPE string
  ASSERT $value IN ["optimization", "risk", "opportunity", "conflict", "missing", "pivot"];
DEFINE FIELD OVERWRITE rationale ON suggestion TYPE string;
DEFINE FIELD OVERWRITE suggested_by ON suggestion TYPE string;
DEFINE FIELD OVERWRITE confidence ON suggestion TYPE float ASSERT $value >= 0 AND $value <= 1;
DEFINE FIELD OVERWRITE status ON suggestion TYPE string
  ASSERT $value IN ["pending", "accepted", "dismissed", "deferred", "converted"];
DEFINE FIELD OVERWRITE workspace ON suggestion TYPE record<workspace>;
DEFINE FIELD OVERWRITE source_message ON suggestion TYPE option<record<message>>;
DEFINE FIELD OVERWRITE source_session ON suggestion TYPE option<record<agent_session>>;
DEFINE FIELD OVERWRITE accepted_at ON suggestion TYPE option<datetime>;
DEFINE FIELD OVERWRITE dismissed_at ON suggestion TYPE option<datetime>;
DEFINE FIELD OVERWRITE deferred_at ON suggestion TYPE option<datetime>;
DEFINE FIELD OVERWRITE converted_at ON suggestion TYPE option<datetime>;
DEFINE FIELD OVERWRITE converted_to ON suggestion TYPE option<record<task | feature | decision | project>>;
DEFINE FIELD OVERWRITE embedding ON suggestion TYPE option<array<float>>;
DEFINE FIELD OVERWRITE created_at ON suggestion TYPE datetime;
DEFINE FIELD OVERWRITE updated_at ON suggestion TYPE option<datetime>;

DEFINE INDEX OVERWRITE suggestion_workspace_status ON suggestion FIELDS workspace, status;
DEFINE INDEX OVERWRITE suggestion_category ON suggestion FIELDS category;
DEFINE INDEX OVERWRITE suggestion_created_at ON suggestion FIELDS created_at;
DEFINE INDEX OVERWRITE idx_suggestion_embedding ON suggestion FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;
DEFINE INDEX OVERWRITE idx_suggestion_fulltext ON suggestion FIELDS text
  FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);

-- Relation: suggestion -> target entity
DEFINE TABLE OVERWRITE suggests_for TYPE RELATION IN suggestion OUT project | feature | task | question | decision SCHEMAFULL;
DEFINE FIELD OVERWRITE added_at ON suggests_for TYPE option<datetime>;

-- Relation: suggestion -> evidence entities (observations, decisions, tasks, etc.)
DEFINE TABLE OVERWRITE suggestion_evidence TYPE RELATION IN suggestion
  OUT workspace | project | person | feature | task | decision | question | observation SCHEMAFULL;
DEFINE FIELD OVERWRITE added_at ON suggestion_evidence TYPE option<datetime>;

-- Relation: created entity -> source suggestion (provenance after conversion)
DEFINE TABLE OVERWRITE converted_from TYPE RELATION IN task | feature | decision | project OUT suggestion SCHEMAFULL;
DEFINE FIELD OVERWRITE converted_at ON converted_from TYPE datetime;

-- Extend conversation.discusses to include suggestion
ALTER FIELD discusses ON conversation
  TYPE option<record<project | person | feature | task | decision | question | observation | suggestion>>;

COMMIT TRANSACTION;

-- Migration 0033: Behavior table, exhibits relation, learning_evidence OUT extension
-- Step 01-02 of the objective-behavior feature

BEGIN TRANSACTION;

-- Behavior: agent craftsmanship metric record (append-only)
DEFINE TABLE OVERWRITE behavior SCHEMAFULL;

DEFINE FIELD OVERWRITE metric_type ON behavior TYPE string
  ASSERT $value IN [
    "TDD_Adherence",
    "Security_First",
    "Conciseness",
    "Review_Responsiveness",
    "Documentation_Quality"
  ];
DEFINE FIELD OVERWRITE score ON behavior TYPE float
  ASSERT $value >= 0.0 AND $value <= 1.0;

-- Telemetry source data (metric-specific, flexible schema)
DEFINE FIELD OVERWRITE source_telemetry ON behavior TYPE object FLEXIBLE;

-- Context
DEFINE FIELD OVERWRITE workspace ON behavior TYPE record<workspace>;
DEFINE FIELD OVERWRITE session ON behavior TYPE option<record<agent_session>>;
DEFINE FIELD OVERWRITE created_at ON behavior TYPE datetime;

-- Indexes
DEFINE INDEX OVERWRITE behavior_workspace_metric ON behavior FIELDS workspace, metric_type;
DEFINE INDEX OVERWRITE behavior_session ON behavior FIELDS session;
DEFINE INDEX OVERWRITE behavior_created_at ON behavior FIELDS created_at;

-- exhibits: links an agent identity to a behavior record
DEFINE TABLE OVERWRITE exhibits TYPE RELATION IN identity OUT behavior SCHEMAFULL;
DEFINE FIELD OVERWRITE created_at ON exhibits TYPE option<datetime>;
DEFINE FIELD OVERWRITE added_at ON exhibits TYPE option<datetime>;

-- Extend learning_evidence OUT to include behavior
ALTER TABLE learning_evidence TYPE RELATION IN learning OUT message | trace | observation | agent_session | behavior;

-- Extend observes OUT to include behavior
ALTER TABLE observes TYPE RELATION IN observation OUT project | feature | task | decision | question | intent | git_commit | observation | objective | behavior;

COMMIT TRANSACTION;

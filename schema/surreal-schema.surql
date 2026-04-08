OPTION IMPORT;

-- BM25 full-text search analyzer (required before any FULLTEXT index)
DEFINE ANALYZER OVERWRITE entity_search
  TOKENIZERS blank, class, camel, punct
  FILTERS snowball(english), lowercase;

DEFINE TABLE conversation SCHEMAFULL;
DEFINE FIELD createdAt ON conversation TYPE datetime;
DEFINE FIELD updatedAt ON conversation TYPE datetime;
DEFINE FIELD workspace ON conversation TYPE record<workspace>;
DEFINE FIELD source ON conversation TYPE option<string>;
DEFINE FIELD timestamp ON conversation TYPE option<datetime>;
DEFINE FIELD messages ON conversation TYPE option<array<record<message>>>;
DEFINE FIELD title ON conversation TYPE option<string>;
DEFINE FIELD title_source ON conversation TYPE option<string> ASSERT $value = NONE OR $value IN ["message", "entity"];
DEFINE FIELD discusses ON conversation TYPE option<record<project | person | feature | task | decision | question | observation | suggestion>>;
DEFINE INDEX conversation_createdAt ON conversation FIELDS createdAt;
DEFINE INDEX conversation_workspace ON conversation FIELDS workspace;

DEFINE TABLE message SCHEMAFULL;
DEFINE FIELD conversation ON message TYPE record<conversation>;
DEFINE FIELD role ON message TYPE string ASSERT $value IN ["user", "assistant"];
DEFINE FIELD text ON message TYPE string;
DEFINE FIELD createdAt ON message TYPE datetime;
DEFINE FIELD suggestions ON message TYPE option<array<string>>;
DEFINE FIELD clientMessageId ON message TYPE option<string>;
DEFINE INDEX message_conversation_createdAt ON message FIELDS conversation, createdAt;
DEFINE INDEX OVERWRITE idx_message_fulltext ON message FIELDS text FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);

DEFINE TABLE entity SCHEMAFULL;
DEFINE FIELD kind ON entity TYPE string ASSERT $value IN ["task", "decision", "question"];
DEFINE FIELD text ON entity TYPE string;
DEFINE FIELD confidence ON entity TYPE float ASSERT $value >= 0 AND $value <= 1;
DEFINE FIELD sourceMessage ON entity TYPE record<message>;
DEFINE FIELD createdAt ON entity TYPE datetime;
DEFINE INDEX entity_createdAt ON entity FIELDS createdAt;

DEFINE TABLE relationship SCHEMAFULL;
DEFINE FIELD type ON relationship TYPE string ASSERT $value IN ["BELONGS_TO", "DEPENDS_ON"];
DEFINE FIELD fromText ON relationship TYPE string;
DEFINE FIELD toText ON relationship TYPE string;
DEFINE FIELD confidence ON relationship TYPE float ASSERT $value >= 0 AND $value <= 1;
DEFINE FIELD sourceMessage ON relationship TYPE record<message>;
DEFINE FIELD createdAt ON relationship TYPE datetime;
DEFINE INDEX relationship_createdAt ON relationship FIELDS createdAt;

DEFINE TABLE workspace SCHEMAFULL;
DEFINE FIELD name ON workspace TYPE string;
DEFINE FIELD status ON workspace TYPE string;
DEFINE FIELD description ON workspace TYPE option<string>;
DEFINE FIELD tools ON workspace TYPE option<array<string>>;
DEFINE FIELD onboarding_complete ON workspace TYPE bool;
DEFINE FIELD onboarding_turn_count ON workspace TYPE int;
DEFINE FIELD onboarding_summary_pending ON workspace TYPE bool;
DEFINE FIELD onboarding_started_at ON workspace TYPE datetime;
DEFINE FIELD onboarding_completed_at ON workspace TYPE option<datetime>;
DEFINE FIELD created_at ON workspace TYPE datetime;
DEFINE FIELD updated_at ON workspace TYPE option<datetime>;
DEFINE FIELD repo_path ON workspace TYPE option<string>;
DEFINE FIELD settings ON workspace TYPE option<object>;
DEFINE FIELD settings.observer_skip_deterministic ON workspace TYPE option<bool>;
DEFINE FIELD settings.sandbox_provider ON workspace TYPE option<string>
  ASSERT $value = NONE OR $value IN ['local', 'e2b', 'daytona', 'docker'];
DEFINE FIELD daily_budget_usd ON workspace TYPE option<float>;
DEFINE FIELD evidence_enforcement ON workspace TYPE option<string>
  ASSERT $value = NONE OR $value IN ['bootstrap', 'soft', 'hard'];
DEFINE FIELD evidence_enforcement_threshold ON workspace TYPE option<object>;
DEFINE FIELD evidence_enforcement_threshold.min_decisions ON workspace TYPE option<int>;
DEFINE FIELD evidence_enforcement_threshold.min_tasks ON workspace TYPE option<int>;
DEFINE FIELD min_evidence_age_minutes ON workspace TYPE option<int>;
DEFINE FIELD evidence_enforcement_transitions ON workspace TYPE option<array<object>>;
DEFINE FIELD evidence_enforcement_transitions[*].from ON workspace TYPE string;
DEFINE FIELD evidence_enforcement_transitions[*].to ON workspace TYPE string;
DEFINE FIELD evidence_enforcement_transitions[*].trigger ON workspace TYPE string
  ASSERT $value IN ['auto', 'manual'];
DEFINE FIELD evidence_enforcement_transitions[*].timestamp ON workspace TYPE datetime;
DEFINE INDEX workspace_name ON workspace FIELDS name;

DEFINE TABLE project SCHEMAFULL;
DEFINE FIELD name ON project TYPE string;
DEFINE FIELD status ON project TYPE string;
DEFINE FIELD workspace ON project TYPE record<workspace>;
DEFINE FIELD description ON project TYPE option<string>;
DEFINE FIELD description_entries ON project TYPE option<array<object>>;
DEFINE FIELD description_entries[*].text ON project TYPE string;
DEFINE FIELD description_entries[*].source ON project TYPE option<record>;
DEFINE FIELD description_entries[*].created_at ON project TYPE datetime;
DEFINE FIELD source_message ON project TYPE option<record<message>>;
DEFINE FIELD created_at ON project TYPE datetime;
DEFINE FIELD updated_at ON project TYPE option<datetime>;
DEFINE INDEX project_name ON project FIELDS name;
DEFINE INDEX OVERWRITE idx_project_fulltext ON project FIELDS name FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);


DEFINE TABLE feature SCHEMAFULL;
DEFINE FIELD name ON feature TYPE string;
DEFINE FIELD status ON feature TYPE string;
DEFINE FIELD description ON feature TYPE option<string>;
DEFINE FIELD description_entries ON feature TYPE option<array<object>>;
DEFINE FIELD description_entries[*].text ON feature TYPE string;
DEFINE FIELD description_entries[*].source ON feature TYPE option<record>;
DEFINE FIELD description_entries[*].created_at ON feature TYPE datetime;
DEFINE FIELD prd ON feature TYPE option<string>;
DEFINE FIELD owner ON feature TYPE option<record<identity>>;
DEFINE FIELD owner_name ON feature TYPE option<string>;
DEFINE FIELD category ON feature TYPE option<string>;
DEFINE FIELD workspace ON feature TYPE record<workspace>;
DEFINE FIELD created_at ON feature TYPE datetime;
DEFINE FIELD updated_at ON feature TYPE option<datetime>;
DEFINE INDEX feature_name ON feature FIELDS name;
DEFINE INDEX OVERWRITE idx_feature_fulltext ON feature FIELDS name FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX feature_workspace ON feature FIELDS workspace;


DEFINE TABLE task SCHEMAFULL;
DEFINE FIELD title ON task TYPE string;
DEFINE FIELD description ON task TYPE option<string>;
DEFINE FIELD description_entries ON task TYPE option<array<object>>;
DEFINE FIELD description_entries[*].text ON task TYPE string;
DEFINE FIELD description_entries[*].source ON task TYPE option<record>;
DEFINE FIELD description_entries[*].created_at ON task TYPE datetime;
DEFINE FIELD owner ON task TYPE option<record<identity>>;
DEFINE FIELD owner_name ON task TYPE option<string>;
DEFINE FIELD deadline ON task TYPE option<datetime>;
DEFINE FIELD status ON task TYPE string
  ASSERT $value IN ["open", "todo", "ready", "in_progress", "blocked", "done", "completed"];
DEFINE FIELD priority ON task TYPE option<string>
  ASSERT $value IN ["low", "medium", "high", "critical"] OR $value IS NONE;
DEFINE FIELD created_at ON task TYPE datetime;
DEFINE FIELD updated_at ON task TYPE option<datetime>;
DEFINE FIELD source_message ON task TYPE option<record<message>>;
DEFINE FIELD source_commit ON task TYPE option<record<git_commit>>;
DEFINE FIELD extraction_confidence ON task TYPE option<float> ASSERT $value = NONE OR ($value >= 0 AND $value <= 1);
DEFINE FIELD extracted_at ON task TYPE option<datetime>;
DEFINE FIELD category ON task TYPE option<string>
  ASSERT $value IN ["engineering", "research", "marketing", "operations", "design", "sales"] OR $value IS NONE;
DEFINE INDEX task_status_deadline ON task FIELDS status, deadline;
DEFINE INDEX task_source_message ON task FIELDS source_message;
DEFINE INDEX task_source_commit ON task FIELDS source_commit;
DEFINE INDEX OVERWRITE idx_task_fulltext ON task FIELDS title FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE FIELD workspace ON task TYPE record<workspace>;
DEFINE FIELD source_session ON task TYPE option<record<agent_session>>;
DEFINE INDEX task_workspace ON task FIELDS workspace;

DEFINE TABLE decision SCHEMAFULL;
DEFINE FIELD summary ON decision TYPE string;
DEFINE FIELD rationale ON decision TYPE option<string>;
DEFINE FIELD decided_by ON decision TYPE option<record<identity>>;
DEFINE FIELD decided_by_name ON decision TYPE option<string>;
DEFINE FIELD decided_at ON decision TYPE option<datetime>;
DEFINE FIELD status ON decision TYPE string ASSERT $value IN ["extracted", "proposed", "confirmed", "superseded", "provisional", "inferred", "contested"];
DEFINE FIELD inferred_by ON decision TYPE option<string>;
DEFINE FIELD confirmed_by ON decision TYPE option<record<identity>>;
DEFINE FIELD confirmed_at ON decision TYPE option<datetime>;
DEFINE FIELD options_considered ON decision TYPE option<array<string>>;
DEFINE FIELD based_on ON decision TYPE option<array<record>>;
DEFINE FIELD confirmation_notes ON decision TYPE option<string>;
DEFINE FIELD created_at ON decision TYPE datetime;
DEFINE FIELD updated_at ON decision TYPE option<datetime>;
DEFINE FIELD source_message ON decision TYPE option<record<message>>;
DEFINE FIELD source_commit ON decision TYPE option<record<git_commit>>;
DEFINE FIELD extraction_confidence ON decision TYPE option<float> ASSERT $value = NONE OR ($value >= 0 AND $value <= 1);
DEFINE FIELD extracted_at ON decision TYPE option<datetime>;
DEFINE FIELD category ON decision TYPE option<string>
  ASSERT $value IN ["engineering", "research", "marketing", "operations", "design", "sales"] OR $value IS NONE;
DEFINE FIELD priority ON decision TYPE option<string>
  ASSERT $value IN ["low", "medium", "high", "critical"] OR $value IS NONE;
DEFINE INDEX decision_status_decided_at ON decision FIELDS status, decided_at;
DEFINE INDEX OVERWRITE idx_decision_fulltext ON decision FIELDS summary FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX decision_source_message ON decision FIELDS source_message;
DEFINE INDEX decision_source_commit ON decision FIELDS source_commit;
DEFINE FIELD workspace ON decision TYPE record<workspace>;
DEFINE INDEX decision_workspace ON decision FIELDS workspace;

DEFINE TABLE question SCHEMAFULL;
DEFINE FIELD text ON question TYPE string;
DEFINE FIELD assigned_to ON question TYPE option<record<identity>>;
DEFINE FIELD assigned_to_name ON question TYPE option<string>;
DEFINE FIELD status ON question TYPE string;
DEFINE FIELD context ON question TYPE option<string>;
DEFINE FIELD created_at ON question TYPE datetime;
DEFINE FIELD updated_at ON question TYPE option<datetime>;
DEFINE FIELD source_message ON question TYPE option<record<message>>;
DEFINE FIELD source_commit ON question TYPE option<record<git_commit>>;
DEFINE FIELD extraction_confidence ON question TYPE option<float> ASSERT $value = NONE OR ($value >= 0 AND $value <= 1);
DEFINE FIELD extracted_at ON question TYPE option<datetime>;
DEFINE FIELD category ON question TYPE option<string>
  ASSERT $value IN ["engineering", "research", "marketing", "operations", "design", "sales"] OR $value IS NONE;
DEFINE FIELD priority ON question TYPE option<string>
  ASSERT $value IN ["low", "medium", "high", "critical"] OR $value IS NONE;
DEFINE INDEX question_status ON question FIELDS status;
DEFINE INDEX OVERWRITE idx_question_fulltext ON question FIELDS text FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX question_source_message ON question FIELDS source_message;
DEFINE INDEX question_source_commit ON question FIELDS source_commit;
DEFINE FIELD workspace ON question TYPE record<workspace>;
DEFINE FIELD asked_by ON question TYPE option<string>;
DEFINE FIELD options ON question TYPE option<array<string>>;
DEFINE FIELD answer_summary ON question TYPE option<string>;
DEFINE FIELD blocking_task ON question TYPE option<record<task>>;
DEFINE INDEX question_workspace ON question FIELDS workspace;

DEFINE TABLE agent_session SCHEMAFULL;
DEFINE FIELD agent ON agent_session TYPE string;
DEFINE FIELD started_at ON agent_session TYPE datetime;
DEFINE FIELD ended_at ON agent_session TYPE option<datetime>;
DEFINE FIELD workspace ON agent_session TYPE record<workspace>;
DEFINE FIELD project ON agent_session TYPE option<record<project>>;
DEFINE FIELD task_id ON agent_session TYPE option<record<task>>;
DEFINE FIELD summary ON agent_session TYPE option<string>;
DEFINE FIELD decisions_made ON agent_session TYPE option<array<record<decision>>>;
DEFINE FIELD questions_asked ON agent_session TYPE option<array<record<question>>>;
DEFINE FIELD tasks_progressed ON agent_session TYPE option<array<object>>;
DEFINE FIELD tasks_progressed[*].task_id ON agent_session TYPE record<task>;
DEFINE FIELD tasks_progressed[*].from_status ON agent_session TYPE string;
DEFINE FIELD tasks_progressed[*].to_status ON agent_session TYPE string;
DEFINE FIELD files_changed ON agent_session TYPE option<array<object>>;
DEFINE FIELD files_changed[*].path ON agent_session TYPE string;
DEFINE FIELD files_changed[*].change_type ON agent_session TYPE string ASSERT $value IN ["created", "modified", "deleted"];
DEFINE FIELD observations_logged ON agent_session TYPE option<array<record<observation>>>;
DEFINE FIELD external_session_id ON agent_session TYPE option<string>;
DEFINE FIELD source ON agent_session TYPE option<string>;
DEFINE FIELD session_type ON agent_session TYPE option<string>;
DEFINE FIELD provider ON agent_session TYPE option<string>;
DEFINE FIELD orchestrator_status ON agent_session TYPE option<string>
  ASSERT $value IS NONE OR $value IN ["spawning", "active", "idle", "completed", "aborted", "error"];
DEFINE FIELD worktree_branch ON agent_session TYPE option<string>;
DEFINE FIELD worktree_path ON agent_session TYPE option<string>;
DEFINE FIELD stream_id ON agent_session TYPE option<string>;
DEFINE FIELD last_event_at ON agent_session TYPE option<datetime>;
DEFINE FIELD error_message ON agent_session TYPE option<string>;
DEFINE FIELD last_feedback ON agent_session TYPE option<string>;
DEFINE FIELD last_request_at ON agent_session TYPE option<datetime>;
DEFINE FIELD triggered_by ON agent_session TYPE option<record<observation | task | decision | question>>;
DEFINE FIELD created_at ON agent_session TYPE datetime;
DEFINE INDEX agent_session_workspace ON agent_session FIELDS workspace;
DEFINE INDEX agent_session_project ON agent_session FIELDS project;
DEFINE INDEX agent_session_started_at ON agent_session FIELDS started_at;
DEFINE INDEX agent_session_task_active ON agent_session FIELDS task_id, orchestrator_status;
DEFINE INDEX agent_session_external_workspace ON agent_session FIELDS external_session_id, workspace;

DEFINE EVENT OVERWRITE session_ended ON agent_session
  WHEN $before.ended_at IS NONE AND $after.ended_at IS NOT NONE
  THEN {
    http::post(
      "http://127.0.0.1:" + <string> $env.PORT + "/api/observe/agent_session/" + <string> record::id($after.id),
      {
        ended_at: $after.ended_at,
        workspace: $after.workspace,
        agent: $after.agent,
      }
    );
  }
  ASYNC
  RETRY 3;

DEFINE TABLE observation SCHEMAFULL;
DEFINE FIELD text ON observation TYPE string;
DEFINE FIELD severity ON observation TYPE string ASSERT $value IN ["info", "warning", "conflict"];
DEFINE FIELD status ON observation TYPE string ASSERT $value IN ["open", "acknowledged", "resolved"];
DEFINE FIELD category ON observation TYPE option<string>
  ASSERT $value IN ["engineering", "research", "marketing", "operations", "design", "sales"] OR $value IS NONE;
DEFINE FIELD observation_type ON observation TYPE option<string>
  ASSERT $value IN ["contradiction", "duplication", "missing", "deprecated", "pattern", "anomaly", "validation", "error", "alignment", "evidence_anomaly"] OR $value IS NONE;
DEFINE FIELD verified ON observation TYPE bool DEFAULT false;
DEFINE FIELD source ON observation TYPE option<string>;
DEFINE FIELD data ON observation TYPE option<object> FLEXIBLE;
DEFINE FIELD source_agent ON observation TYPE string;
DEFINE FIELD workspace ON observation TYPE record<workspace>;
DEFINE FIELD source_message ON observation TYPE option<record<message>>;
DEFINE FIELD source_session ON observation TYPE option<record<agent_session>>;
DEFINE FIELD resolved_at ON observation TYPE option<datetime>;
DEFINE FIELD resolved_by ON observation TYPE option<record<identity>>;
DEFINE FIELD created_at ON observation TYPE datetime;
DEFINE FIELD updated_at ON observation TYPE option<datetime>;
DEFINE FIELD confidence ON observation TYPE option<float>;
DEFINE FIELD evidence_refs ON observation TYPE option<array<record<project | feature | task | decision | question | observation | intent | git_commit>>>;
DEFINE FIELD reasoning ON observation TYPE option<string>;
DEFINE INDEX observation_workspace_status ON observation FIELDS workspace, status;
DEFINE INDEX OVERWRITE idx_observation_fulltext ON observation FIELDS text FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX observation_severity ON observation FIELDS severity;
DEFINE INDEX observation_created_at ON observation FIELDS created_at;

DEFINE TABLE suggestion SCHEMAFULL;
DEFINE FIELD text ON suggestion TYPE string;
DEFINE FIELD category ON suggestion TYPE string
  ASSERT $value IN ["optimization", "risk", "opportunity", "conflict", "missing", "pivot"];
DEFINE FIELD rationale ON suggestion TYPE string;
DEFINE FIELD suggested_by ON suggestion TYPE string;
DEFINE FIELD confidence ON suggestion TYPE float ASSERT $value >= 0 AND $value <= 1;
DEFINE FIELD status ON suggestion TYPE string
  ASSERT $value IN ["pending", "accepted", "dismissed", "deferred", "converted"];
DEFINE FIELD workspace ON suggestion TYPE record<workspace>;
DEFINE FIELD source_message ON suggestion TYPE option<record<message>>;
DEFINE FIELD source_session ON suggestion TYPE option<record<agent_session>>;
DEFINE FIELD accepted_at ON suggestion TYPE option<datetime>;
DEFINE FIELD dismissed_at ON suggestion TYPE option<datetime>;
DEFINE FIELD deferred_at ON suggestion TYPE option<datetime>;
DEFINE FIELD converted_at ON suggestion TYPE option<datetime>;
DEFINE FIELD converted_to ON suggestion TYPE option<record<task | feature | decision | project>>;
DEFINE FIELD created_at ON suggestion TYPE datetime;
DEFINE FIELD updated_at ON suggestion TYPE option<datetime>;
DEFINE INDEX suggestion_workspace_status ON suggestion FIELDS workspace, status;
DEFINE INDEX suggestion_category ON suggestion FIELDS category;
DEFINE INDEX suggestion_created_at ON suggestion FIELDS created_at;

DEFINE TABLE person SCHEMAFULL;
DEFINE FIELD name ON person TYPE string;
DEFINE FIELD role ON person TYPE option<string>;
DEFINE FIELD contact_email ON person TYPE string;
DEFINE FIELD contact_phone ON person TYPE option<string>;
DEFINE FIELD email_verified ON person TYPE bool DEFAULT false;
DEFINE FIELD image ON person TYPE option<string>;
DEFINE FIELD created_at ON person TYPE datetime;
DEFINE FIELD updated_at ON person TYPE datetime;
DEFINE INDEX person_name ON person FIELDS name;
DEFINE INDEX OVERWRITE idx_person_fulltext ON person FIELDS name FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX person_email ON person FIELDS contact_email UNIQUE;

DEFINE TABLE identity SCHEMAFULL;
DEFINE FIELD name ON identity TYPE string;
DEFINE FIELD type ON identity TYPE string ASSERT $value IN ['human', 'agent', 'system'];
DEFINE FIELD role ON identity TYPE option<string>;
DEFINE FIELD workspace ON identity TYPE record<workspace>;
DEFINE FIELD created_at ON identity TYPE datetime;
DEFINE FIELD managed_by ON identity TYPE option<string>;
DEFINE FIELD identity_status ON identity TYPE option<string>;
DEFINE FIELD revoked_at ON identity TYPE option<datetime>;
DEFINE INDEX identity_workspace ON identity FIELDS workspace;
DEFINE INDEX identity_type_workspace ON identity FIELDS type, workspace;

DEFINE TABLE agent SCHEMAFULL;
DEFINE FIELD runtime ON agent TYPE string ASSERT $value IN ['osabio', 'sandbox', 'external'];
DEFINE FIELD name ON agent TYPE string;
DEFINE FIELD model ON agent TYPE option<string>;
DEFINE FIELD description ON agent TYPE option<string>;
DEFINE FIELD managed_by ON agent TYPE record<identity>;
DEFINE FIELD created_at ON agent TYPE datetime;
DEFINE FIELD sandbox_config ON agent TYPE option<object>;
DEFINE FIELD sandbox_config.coding_agents ON agent TYPE option<array<string>>;
DEFINE FIELD sandbox_config.env_vars ON agent TYPE option<array<object>>;
DEFINE FIELD sandbox_config.env_vars[*].key ON agent TYPE string;
DEFINE FIELD sandbox_config.env_vars[*].value ON agent TYPE string;
DEFINE FIELD sandbox_config.image ON agent TYPE option<string>;
DEFINE FIELD sandbox_config.snapshot ON agent TYPE option<string>;
DEFINE FIELD sandbox_config.model ON agent TYPE option<string>;

DEFINE TABLE identity_person TYPE RELATION IN identity OUT person SCHEMAFULL;
DEFINE FIELD added_at ON identity_person TYPE datetime;

DEFINE TABLE identity_agent TYPE RELATION IN identity OUT agent SCHEMAFULL;
DEFINE FIELD added_at ON identity_agent TYPE datetime;

DEFINE TABLE meeting SCHEMAFULL;
DEFINE FIELD title ON meeting TYPE string;
DEFINE FIELD attendees ON meeting TYPE option<array<record<person>>>;
DEFINE FIELD transcript_ref ON meeting TYPE option<string>;
DEFINE FIELD calendar_event_ref ON meeting TYPE option<string>;
DEFINE FIELD source_provider ON meeting TYPE option<string>;
DEFINE FIELD recorded_at ON meeting TYPE datetime;
DEFINE FIELD created_at ON meeting TYPE datetime;
DEFINE FIELD updated_at ON meeting TYPE option<datetime>;
DEFINE INDEX meeting_recorded_at ON meeting FIELDS recorded_at;

DEFINE TABLE document SCHEMAFULL;
DEFINE FIELD workspace ON document TYPE record<workspace>;
DEFINE FIELD name ON document TYPE string;
DEFINE FIELD mime_type ON document TYPE string;
DEFINE FIELD size_bytes ON document TYPE int;
DEFINE FIELD uploaded_at ON document TYPE datetime;
DEFINE INDEX document_workspace_uploaded_at ON document FIELDS workspace, uploaded_at;

DEFINE TABLE document_chunk SCHEMAFULL;
DEFINE FIELD document ON document_chunk TYPE record<document>;
DEFINE FIELD workspace ON document_chunk TYPE record<workspace>;
DEFINE FIELD content ON document_chunk TYPE string;
DEFINE FIELD section_heading ON document_chunk TYPE option<string>;
DEFINE FIELD position ON document_chunk TYPE int;
DEFINE FIELD created_at ON document_chunk TYPE datetime;
DEFINE INDEX document_chunk_document_position ON document_chunk FIELDS document, position;
DEFINE INDEX document_chunk_workspace_created_at ON document_chunk FIELDS workspace, created_at;

DEFINE TABLE git_commit SCHEMAFULL;
DEFINE FIELD sha ON git_commit TYPE string;
DEFINE FIELD repository ON git_commit TYPE option<string>;
DEFINE FIELD message ON git_commit TYPE option<string>;
DEFINE FIELD authored_at ON git_commit TYPE option<datetime>;
DEFINE FIELD author ON git_commit TYPE option<record<identity>>;
DEFINE FIELD author_name ON git_commit TYPE string;
DEFINE FIELD url ON git_commit TYPE option<string>;
DEFINE FIELD workspace ON git_commit TYPE record<workspace>;
DEFINE FIELD created_at ON git_commit TYPE datetime;
DEFINE INDEX git_commit_sha ON git_commit FIELDS sha UNIQUE;
DEFINE INDEX git_commit_workspace ON git_commit FIELDS workspace;

DEFINE TABLE pull_request SCHEMAFULL;
DEFINE FIELD external_id ON pull_request TYPE option<string>;
DEFINE FIELD title ON pull_request TYPE string;
DEFINE FIELD url ON pull_request TYPE string;
DEFINE FIELD status ON pull_request TYPE string;
DEFINE FIELD author ON pull_request TYPE option<record<identity>>;
DEFINE FIELD repository ON pull_request TYPE option<string>;
DEFINE FIELD opened_at ON pull_request TYPE option<datetime>;
DEFINE FIELD merged_at ON pull_request TYPE option<datetime>;
DEFINE FIELD created_at ON pull_request TYPE datetime;
DEFINE INDEX pull_request_url ON pull_request FIELDS url UNIQUE;

DEFINE TABLE has_feature TYPE RELATION IN project OUT feature SCHEMAFULL;
DEFINE FIELD added_at ON has_feature TYPE datetime;

DEFINE TABLE has_project TYPE RELATION IN workspace OUT project SCHEMAFULL;
DEFINE FIELD added_at ON has_project TYPE datetime;

DEFINE TABLE has_task TYPE RELATION IN feature OUT task SCHEMAFULL;
DEFINE FIELD added_at ON has_task TYPE datetime;

DEFINE TABLE owns TYPE RELATION IN identity OUT task | project | feature SCHEMAFULL;
DEFINE FIELD assigned_at ON owns TYPE datetime;

DEFINE TABLE member_of TYPE RELATION IN identity OUT workspace SCHEMAFULL;
DEFINE FIELD role ON member_of TYPE option<string>;
DEFINE FIELD added_at ON member_of TYPE datetime;

DEFINE TABLE depends_on TYPE RELATION IN task | feature OUT task | feature SCHEMAFULL;
DEFINE FIELD type ON depends_on TYPE string ASSERT $value IN ["blocks", "needs", "soft"];
DEFINE FIELD added_at ON depends_on TYPE option<datetime>;

DEFINE TABLE subtask_of TYPE RELATION IN task OUT task SCHEMAFULL;
DEFINE FIELD added_at ON subtask_of TYPE datetime;

DEFINE TABLE extraction_relation TYPE RELATION IN message | document_chunk | git_commit OUT workspace | project | person | feature | task | decision | question SCHEMAFULL;
DEFINE FIELD confidence ON extraction_relation TYPE float ASSERT $value >= 0 AND $value <= 1;
DEFINE FIELD extracted_at ON extraction_relation TYPE datetime;
DEFINE FIELD created_at ON extraction_relation TYPE datetime;
DEFINE FIELD model ON extraction_relation TYPE option<string>;
DEFINE FIELD from_text ON extraction_relation TYPE option<string>;
DEFINE FIELD evidence ON extraction_relation TYPE option<string>;
DEFINE FIELD evidence_source ON extraction_relation TYPE option<record<message>>;
DEFINE FIELD resolved_from ON extraction_relation TYPE option<record<message>>;
DEFINE FIELD to_text ON extraction_relation TYPE option<string>;
DEFINE INDEX extraction_relation_confidence ON extraction_relation FIELDS confidence;
DEFINE INDEX extraction_relation_extracted_at ON extraction_relation FIELDS extracted_at;
DEFINE INDEX extraction_relation_evidence_source ON extraction_relation FIELDS evidence_source;
DEFINE INDEX extraction_relation_resolved_from ON extraction_relation FIELDS resolved_from;

DEFINE TABLE entity_relation TYPE RELATION IN workspace | project | person | feature | task | decision | question OUT workspace | project | person | feature | task | decision | question SCHEMAFULL;
DEFINE FIELD kind ON entity_relation TYPE string ASSERT string::len(string::trim($value)) > 0;
DEFINE FIELD confidence ON entity_relation TYPE float ASSERT $value >= 0 AND $value <= 1;
DEFINE FIELD source_message ON entity_relation TYPE option<record<message>>;
DEFINE FIELD source_chunk ON entity_relation TYPE option<record<document_chunk>>;
DEFINE FIELD source_commit ON entity_relation TYPE option<record<git_commit>>;
DEFINE FIELD extracted_at ON entity_relation TYPE datetime;
DEFINE FIELD created_at ON entity_relation TYPE datetime;
DEFINE FIELD from_text ON entity_relation TYPE option<string>;
DEFINE FIELD to_text ON entity_relation TYPE option<string>;
DEFINE INDEX entity_relation_kind ON entity_relation FIELDS kind;
DEFINE INDEX entity_relation_confidence ON entity_relation FIELDS confidence;
DEFINE INDEX entity_relation_source_message ON entity_relation FIELDS source_message;
DEFINE INDEX entity_relation_source_chunk ON entity_relation FIELDS source_chunk;
DEFINE INDEX entity_relation_source_commit ON entity_relation FIELDS source_commit;
DEFINE INDEX entity_relation_extracted_at ON entity_relation FIELDS extracted_at;

DEFINE TABLE decided_in TYPE RELATION IN decision OUT conversation | meeting SCHEMAFULL;
DEFINE FIELD message_ref ON decided_in TYPE option<record<message>>;
DEFINE FIELD added_at ON decided_in TYPE option<datetime>;

DEFINE TABLE belongs_to TYPE RELATION IN task | decision | question OUT feature | project SCHEMAFULL;
DEFINE FIELD added_at ON belongs_to TYPE datetime;

DEFINE TABLE observes TYPE RELATION IN observation OUT project | feature | task | decision | question | intent | git_commit | observation | objective | behavior | trace SCHEMAFULL;
DEFINE FIELD added_at ON observes TYPE option<datetime>;

DEFINE TABLE similar_to TYPE RELATION IN observation OUT observation SCHEMAFULL;
DEFINE FIELD similarity ON similar_to TYPE float;
DEFINE FIELD created_at ON similar_to TYPE datetime;

DEFINE TABLE observed_in TYPE RELATION IN observation OUT agent_session SCHEMAFULL;
DEFINE FIELD added_at ON observed_in TYPE datetime;

DEFINE TABLE suggests_for TYPE RELATION IN suggestion OUT project | feature | task | question | decision SCHEMAFULL;
DEFINE FIELD added_at ON suggests_for TYPE option<datetime>;

DEFINE TABLE suggestion_evidence TYPE RELATION IN suggestion OUT workspace | project | person | feature | task | decision | question | observation SCHEMAFULL;
DEFINE FIELD added_at ON suggestion_evidence TYPE option<datetime>;

DEFINE TABLE converted_from TYPE RELATION IN task | feature | decision | project OUT suggestion SCHEMAFULL;
DEFINE FIELD converted_at ON converted_from TYPE datetime;

DEFINE TABLE touched_by TYPE RELATION IN project OUT conversation SCHEMAFULL;
DEFINE FIELD first_mention_at ON touched_by TYPE datetime;
DEFINE FIELD entity_count ON touched_by TYPE int ASSERT $value >= 1;
DEFINE INDEX touched_by_unique ON touched_by FIELDS `in`, out UNIQUE;
DEFINE INDEX touched_by_out ON touched_by FIELDS out;

DEFINE TABLE conflicts_with TYPE RELATION IN decision | feature OUT decision | feature SCHEMAFULL;
DEFINE FIELD description ON conflicts_with TYPE option<string>;
DEFINE FIELD severity ON conflicts_with TYPE option<string>;
DEFINE FIELD detected_at ON conflicts_with TYPE option<datetime>;

DEFINE TABLE implemented_by TYPE RELATION IN decision | task OUT git_commit | pull_request SCHEMAFULL;
DEFINE FIELD commit_sha ON implemented_by TYPE option<string>;
DEFINE FIELD pr_url ON implemented_by TYPE option<string>;
DEFINE FIELD linked_at ON implemented_by TYPE option<datetime>;

DEFINE TABLE produced TYPE RELATION IN agent_session OUT decision SCHEMAFULL;
DEFINE FIELD added_at ON produced TYPE datetime;

DEFINE TABLE asked TYPE RELATION IN agent_session OUT question SCHEMAFULL;
DEFINE FIELD added_at ON asked TYPE datetime;

DEFINE TABLE progressed TYPE RELATION IN agent_session OUT task SCHEMAFULL;
DEFINE FIELD from_status ON progressed TYPE string;
DEFINE FIELD to_status ON progressed TYPE string;
DEFINE FIELD added_at ON progressed TYPE datetime;

DEFINE TABLE superseded_by TYPE RELATION IN decision OUT decision SCHEMAFULL;
DEFINE FIELD reason ON superseded_by TYPE option<string>;
DEFINE FIELD superseded_at ON superseded_by TYPE datetime;

-- Automatically set decision status to "superseded" when edge is created.
-- The edge is the source of truth; status is a derived consequence.
DEFINE EVENT OVERWRITE decision_superseded ON superseded_by
  WHEN $event = "CREATE"
  THEN {
    UPDATE $after.in SET status = "superseded", updated_at = time::now();
  };

DEFINE TABLE branched_from TYPE RELATION IN conversation OUT conversation SCHEMAFULL;
DEFINE FIELD branched_at ON branched_from TYPE datetime;
DEFINE FIELD branch_point_message ON branched_from TYPE record<message>;
DEFINE INDEX branched_from_out ON branched_from FIELDS out;
DEFINE INDEX branched_from_in ON branched_from FIELDS `in`;

DEFINE TABLE attended_by TYPE RELATION IN meeting OUT identity SCHEMAFULL;
DEFINE FIELD role ON attended_by TYPE option<string> ASSERT $value = NONE OR $value IN ["organizer", "attendee"];
DEFINE FIELD added_at ON attended_by TYPE option<datetime>;

-- Trace: forensic record of a unit of thought (call tree node)
DEFINE TABLE trace SCHEMAFULL;
DEFINE FIELD type ON trace TYPE string
  ASSERT $value IN ["tool_call", "message", "subagent_spawn", "intent_submission", "bridge_exchange", "llm_call"];
DEFINE FIELD actor ON trace TYPE option<record<identity>>;
DEFINE FIELD workspace ON trace TYPE option<record<workspace>>;
DEFINE FIELD session ON trace TYPE option<record<agent_session>>;
DEFINE FIELD parent_trace ON trace TYPE option<record<trace>>;
DEFINE FIELD tool_name ON trace TYPE option<string>;
DEFINE FIELD input ON trace TYPE option<object> FLEXIBLE;
DEFINE FIELD output ON trace TYPE option<object> FLEXIBLE;
DEFINE FIELD duration_ms ON trace TYPE option<int>;
DEFINE FIELD created_at ON trace TYPE datetime;
DEFINE FIELD model ON trace TYPE option<string>;
DEFINE FIELD provider ON trace TYPE option<string>;
DEFINE FIELD input_tokens ON trace TYPE option<int>;
DEFINE FIELD output_tokens ON trace TYPE option<int>;
DEFINE FIELD cache_creation_tokens ON trace TYPE option<int>;
DEFINE FIELD cache_read_tokens ON trace TYPE option<int>;
DEFINE FIELD cost_usd ON trace TYPE option<float>;
DEFINE FIELD stop_reason ON trace TYPE option<string>;
DEFINE FIELD request_id ON trace TYPE option<string>;
DEFINE FIELD latency_ms ON trace TYPE option<int>;
DEFINE FIELD policy_decision ON trace TYPE option<object> FLEXIBLE;
DEFINE FIELD outcome ON trace TYPE option<string>;
DEFINE FIELD intent ON trace TYPE option<record<intent>>;
DEFINE INDEX trace_parent ON trace FIELDS parent_trace;
DEFINE INDEX trace_session ON trace FIELDS session;
DEFINE INDEX trace_workspace ON trace FIELDS workspace;
DEFINE INDEX trace_created_at ON trace FIELDS created_at;

DEFINE TABLE spawns TYPE RELATION IN message OUT trace SCHEMAFULL;

DEFINE TABLE invoked TYPE RELATION IN agent_session OUT trace SCHEMAFULL;
DEFINE FIELD created_at ON invoked TYPE datetime;

DEFINE TABLE scoped_to TYPE RELATION IN trace OUT workspace SCHEMAFULL;
DEFINE FIELD created_at ON scoped_to TYPE datetime;

DEFINE TABLE attributed_to TYPE RELATION IN trace OUT task SCHEMAFULL;
DEFINE FIELD created_at ON attributed_to TYPE datetime;

DEFINE TABLE governed_by TYPE RELATION IN trace OUT policy SCHEMAFULL;
DEFINE FIELD created_at ON governed_by TYPE datetime;
DEFINE FIELD decision ON governed_by TYPE string ASSERT $value IN ['pass', 'deny'];

-- Intent governance
DEFINE TABLE intent SCHEMAFULL;
DEFINE FIELD goal ON intent TYPE string;
DEFINE FIELD reasoning ON intent TYPE string;
DEFINE FIELD status ON intent TYPE string
  ASSERT $value IN ["draft", "pending_auth", "pending_veto", "authorized", "executing", "completed", "vetoed", "failed"];
DEFINE FIELD priority ON intent TYPE int
  ASSERT $value >= 0 AND $value <= 100;
DEFINE FIELD action_spec ON intent TYPE object;
DEFINE FIELD action_spec.provider ON intent TYPE string;
DEFINE FIELD action_spec.action ON intent TYPE string;
DEFINE FIELD action_spec.params ON intent TYPE object FLEXIBLE;
DEFINE FIELD budget_limit ON intent TYPE option<object>;
DEFINE FIELD budget_limit.amount ON intent TYPE float;
DEFINE FIELD budget_limit.currency ON intent TYPE string;
DEFINE FIELD evaluation ON intent TYPE option<object>;
DEFINE FIELD evaluation.decision ON intent TYPE string
  ASSERT $value IN ["APPROVE", "REJECT"];
DEFINE FIELD evaluation.risk_score ON intent TYPE int
  ASSERT $value >= 0 AND $value <= 100;
DEFINE FIELD evaluation.reason ON intent TYPE string;
DEFINE FIELD evaluation.reasoning ON intent TYPE option<string>;
DEFINE FIELD evaluation.evaluated_at ON intent TYPE datetime;
DEFINE FIELD evaluation.policy_only ON intent TYPE bool;
DEFINE FIELD evaluation.policy_trace ON intent TYPE option<array<object>>;
DEFINE FIELD evaluation.policy_trace[*].policy_id ON intent TYPE string;
DEFINE FIELD evaluation.policy_trace[*].policy_version ON intent TYPE int;
DEFINE FIELD evaluation.policy_trace[*].rule_id ON intent TYPE string;
DEFINE FIELD evaluation.policy_trace[*].effect ON intent TYPE string ASSERT $value IN ['allow', 'deny', 'evidence_requirement'];
DEFINE FIELD evaluation.policy_trace[*].matched ON intent TYPE bool;
DEFINE FIELD evaluation.policy_trace[*].priority ON intent TYPE int;
DEFINE FIELD evaluation.human_veto_required ON intent TYPE option<bool>;
DEFINE FIELD evaluation.evidence_requirement ON intent TYPE option<object>;
DEFINE FIELD evaluation.evidence_requirement.min_count ON intent TYPE option<int>;
DEFINE FIELD evaluation.evidence_requirement.required_types ON intent TYPE option<array<string>>;
DEFINE FIELD veto_expires_at ON intent TYPE option<datetime>;
DEFINE FIELD veto_reason ON intent TYPE option<string>;
DEFINE FIELD error_reason ON intent TYPE option<string>;
DEFINE FIELD trace_id ON intent TYPE record<trace>;
DEFINE FIELD requester ON intent TYPE record<identity>;
DEFINE FIELD workspace ON intent TYPE record<workspace>;
DEFINE FIELD created_at ON intent TYPE datetime;
DEFINE FIELD updated_at ON intent TYPE option<datetime>;
DEFINE FIELD expiry ON intent TYPE option<datetime>;
DEFINE FIELD authorization_details ON intent TYPE option<array<object>>;
DEFINE FIELD authorization_details[*].type ON intent TYPE string ASSERT $value = "osabio_action";
DEFINE FIELD authorization_details[*].action ON intent TYPE string;
DEFINE FIELD authorization_details[*].resource ON intent TYPE string;
DEFINE FIELD authorization_details[*].constraints ON intent TYPE option<object> FLEXIBLE;
DEFINE FIELD dpop_jwk_thumbprint ON intent TYPE option<string>;
DEFINE FIELD token_issued_at ON intent TYPE option<datetime>;
DEFINE FIELD token_expires_at ON intent TYPE option<datetime>;
DEFINE FIELD evidence_refs ON intent TYPE option<array<record<decision | task | feature | project | observation | policy | objective | learning | git_commit>>>;
DEFINE FIELD evidence_verification ON intent TYPE option<object>;
DEFINE FIELD evidence_verification.verified_count ON intent TYPE int;
DEFINE FIELD evidence_verification.total_count ON intent TYPE int;
DEFINE FIELD evidence_verification.failed_refs ON intent TYPE option<array<string>>;
DEFINE FIELD evidence_verification.verification_time_ms ON intent TYPE int;
DEFINE FIELD evidence_verification.warnings ON intent TYPE option<array<string>>;
DEFINE FIELD evidence_verification.enforcement_mode ON intent TYPE string;
DEFINE FIELD evidence_verification.independent_author_count ON intent TYPE option<int>;
DEFINE FIELD evidence_verification.tier_met ON intent TYPE option<bool>;
DEFINE INDEX intent_workspace_status ON intent FIELDS workspace, status;
DEFINE INDEX intent_created_at ON intent FIELDS created_at;
DEFINE INDEX intent_trace_id ON intent FIELDS trace_id;
DEFINE INDEX intent_veto_expires ON intent FIELDS veto_expires_at;

-- Intent evaluation event: fires http::post when status transitions to pending_auth.
-- In production the server URL is configured via schema migration with the actual port.
-- In tests, simulateEvaluation() writes the evaluation result directly, so this event
-- firing against an unreachable endpoint is harmless (SurrealDB http::post errors are
-- caught and ignored here to prevent blocking the triggering UPDATE).
DEFINE EVENT intent_pending_auth ON intent
  WHEN $before.status != "pending_auth" AND $after.status = "pending_auth"
  THEN {};

DEFINE TABLE triggered_by TYPE RELATION IN intent OUT task SCHEMAFULL;
DEFINE FIELD created_at ON triggered_by TYPE datetime;

DEFINE TABLE gates TYPE RELATION IN intent OUT agent_session SCHEMAFULL;
DEFINE FIELD created_at ON gates TYPE datetime;

DEFINE TABLE vetoed_by TYPE RELATION IN identity OUT intent SCHEMAFULL;
DEFINE FIELD reason ON vetoed_by TYPE string;
DEFINE FIELD vetoed_at ON vetoed_by TYPE datetime;

-- Policy governance table
DEFINE TABLE policy SCHEMAFULL;
DEFINE FIELD title ON policy TYPE string;
DEFINE FIELD description ON policy TYPE option<string>;
DEFINE FIELD version ON policy TYPE int ASSERT $value > 0;
DEFINE FIELD status ON policy TYPE string
  ASSERT $value IN ['active', 'draft', 'deprecated', 'testing', 'superseded'];
DEFINE FIELD selector ON policy TYPE object;
DEFINE FIELD selector.workspace ON policy TYPE option<string>;
DEFINE FIELD selector.agent_role ON policy TYPE option<string>;
DEFINE FIELD selector.resource ON policy TYPE option<string>;
DEFINE FIELD rego_source ON policy TYPE string;
DEFINE FIELD human_veto_required ON policy TYPE bool DEFAULT false;
DEFINE FIELD max_ttl ON policy TYPE option<string>;
DEFINE FIELD created_by ON policy TYPE record<identity>;
DEFINE FIELD workspace ON policy TYPE record<workspace>;
DEFINE FIELD supersedes ON policy TYPE option<record<policy>>;
DEFINE FIELD created_at ON policy TYPE datetime;
DEFINE FIELD updated_at ON policy TYPE option<datetime>;
DEFINE INDEX policy_status ON policy FIELDS status;
DEFINE INDEX OVERWRITE idx_policy_fulltext ON policy FIELDS description FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX policy_workspace ON policy FIELDS workspace;
DEFINE INDEX policy_workspace_status ON policy FIELDS workspace, status;
DEFINE INDEX policy_supersedes ON policy FIELDS supersedes;

-- Graph relation: identity -governing-> policy
DEFINE TABLE governing TYPE RELATION IN identity OUT policy SCHEMAFULL;
DEFINE FIELD created_at ON governing TYPE datetime;
DEFINE INDEX governing_out ON governing FIELDS out;

-- Graph relation: policy -protects-> workspace
DEFINE TABLE protects TYPE RELATION IN policy OUT workspace SCHEMAFULL;
DEFINE FIELD created_at ON protects TYPE datetime;
DEFINE INDEX protects_in ON protects FIELDS in;

-- Authority scopes: per-agent-type permission matrix
DEFINE TABLE authority_scope SCHEMAFULL;
DEFINE FIELD action ON authority_scope TYPE string
  ASSERT $value IN [
    "create_decision", "confirm_decision",
    "create_task", "complete_task",
    "create_observation", "acknowledge_observation", "resolve_observation",
    "create_question", "create_suggestion",
    "create_intent", "submit_intent"
  ];
DEFINE FIELD permission ON authority_scope TYPE string
  ASSERT $value IN ["auto", "provisional", "propose", "blocked"];
DEFINE FIELD workspace ON authority_scope TYPE option<record<workspace>>;
DEFINE FIELD created_at ON authority_scope TYPE datetime;
-- No UNIQUE: SurrealDB v3.0.4 UNIQUE indexes on option<record<...>> fields
-- silently return empty results for WHERE queries. Use plain index instead.
DEFINE INDEX authority_scope_lookup ON authority_scope
  FIELDS action, workspace;

-- Seed: one authority_scope per action with default permission
CREATE authority_scope CONTENT { action: "create_decision", permission: "provisional", created_at: time::now() };
CREATE authority_scope CONTENT { action: "confirm_decision", permission: "blocked", created_at: time::now() };
CREATE authority_scope CONTENT { action: "create_task", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "complete_task", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "create_observation", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "acknowledge_observation", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "resolve_observation", permission: "blocked", created_at: time::now() };
CREATE authority_scope CONTENT { action: "create_question", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "create_suggestion", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "create_intent", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "submit_intent", permission: "auto", created_at: time::now() };

-- Per-identity authority overrides (identity -> authority_scope)
DEFINE TABLE authorized_to TYPE RELATION IN identity OUT authority_scope SCHEMAFULL;
DEFINE FIELD permission ON authorized_to TYPE string
  ASSERT $value IN ["auto", "provisional", "propose", "blocked"];
DEFINE FIELD created_at ON authorized_to TYPE datetime;
DEFINE INDEX authorized_to_lookup ON authorized_to FIELDS in, out UNIQUE;

DEFINE FUNCTION fn::entity_search_workspace($q: string, $limit: int, $workspace: record<workspace>) {
  LET $query = string::lowercase(string::trim($q));
  LET $safe_limit = math::min([math::max([$limit, 1]), 100]);

  LET $task_rows = SELECT
    id,
    "task" AS kind,
    title AS text,
    extraction_confidence AS confidence,
    source_message AS sourceMessage,
    priority,
    created_at
  FROM task
  WHERE workspace = $workspace
    AND extraction_confidence != NONE
    AND string::contains(string::lowercase(title), $query)
  ORDER BY created_at DESC
  LIMIT $safe_limit;

  LET $decision_rows = SELECT
    id,
    "decision" AS kind,
    summary AS text,
    extraction_confidence AS confidence,
    source_message AS sourceMessage,
    priority,
    created_at
  FROM decision
  WHERE workspace = $workspace
    AND extraction_confidence != NONE
    AND string::contains(string::lowercase(summary), $query)
  ORDER BY created_at DESC
  LIMIT $safe_limit;

  LET $question_rows = SELECT
    id,
    "question" AS kind,
    text AS text,
    extraction_confidence AS confidence,
    source_message AS sourceMessage,
    priority,
    created_at
  FROM question
  WHERE workspace = $workspace
    AND extraction_confidence != NONE
    AND string::contains(string::lowercase(text), $query)
  ORDER BY created_at DESC
  LIMIT $safe_limit;

  RETURN array::flatten([$task_rows, $decision_rows, $question_rows]);
};

DEFINE FUNCTION fn::entity_search_project($q: string, $limit: int, $workspace: record<workspace>, $project: record<project>) {
  LET $query = string::lowercase(string::trim($q));
  LET $safe_limit = math::min([math::max([$limit, 1]), 100]);
  LET $project_entity_ids = SELECT VALUE `in` FROM belongs_to WHERE out = $project;

  LET $task_rows = SELECT
    id,
    "task" AS kind,
    title AS text,
    extraction_confidence AS confidence,
    source_message AS sourceMessage,
    priority,
    created_at
  FROM task
  WHERE workspace = $workspace
    AND extraction_confidence != NONE
    AND id IN $project_entity_ids
    AND string::contains(string::lowercase(title), $query)
  ORDER BY created_at DESC
  LIMIT $safe_limit;

  LET $decision_rows = SELECT
    id,
    "decision" AS kind,
    summary AS text,
    extraction_confidence AS confidence,
    source_message AS sourceMessage,
    priority,
    created_at
  FROM decision
  WHERE workspace = $workspace
    AND extraction_confidence != NONE
    AND id IN $project_entity_ids
    AND string::contains(string::lowercase(summary), $query)
  ORDER BY created_at DESC
  LIMIT $safe_limit;

  LET $question_rows = SELECT
    id,
    "question" AS kind,
    text AS text,
    extraction_confidence AS confidence,
    source_message AS sourceMessage,
    priority,
    created_at
  FROM question
  WHERE workspace = $workspace
    AND extraction_confidence != NONE
    AND id IN $project_entity_ids
    AND string::contains(string::lowercase(text), $query)
  ORDER BY created_at DESC
  LIMIT $safe_limit;

  RETURN array::flatten([$task_rows, $decision_rows, $question_rows]);
};

DEFINE FUNCTION fn::conversation_recent($conversation: record<conversation>, $limit: int) {
  LET $safe_limit = math::min([math::max([$limit, 1]), 50]);
  RETURN SELECT id, role, text, createdAt
  FROM message
  WHERE conversation = $conversation
  ORDER BY createdAt DESC
  LIMIT $safe_limit;
};

DEFINE FUNCTION fn::entity_neighbors($entity: record) {
  RETURN SELECT
    ->entity_relation->(workspace, project, person, identity, feature, task, decision, question) AS outgoing,
    <-entity_relation<-(workspace, project, person, identity, feature, task, decision, question) AS incoming
  FROM $entity;
};

-- Graph traversal functions: query edges across all relation tables from SurrealQL.

DEFINE FUNCTION fn::entity_edges($entity: record, $lim: int) {
  RETURN SELECT id, `in`, out, kind, confidence
    FROM entity_relation, belongs_to, has_feature, has_task, has_project,
         depends_on, owns, observes, suggests_for, subtask_of,
         governing, protects, triggered_by, gates,
         supports, exhibits, has_objective
    WHERE `in` = $entity OR out = $entity
    LIMIT $lim;
};

DEFINE FUNCTION fn::edges_between($ids: array) {
  RETURN SELECT id, `in`, out, kind, confidence
    FROM entity_relation, belongs_to, has_feature, has_task, has_project,
         depends_on, owns, observes, suggests_for, subtask_of,
         governing, protects, triggered_by, gates,
         supports, exhibits, has_objective
    WHERE `in` IN $ids AND out IN $ids;
};

DEFINE FUNCTION fn::graph_neighbors($ids: array) {
  RETURN SELECT `in`, out
    FROM entity_relation, belongs_to, has_feature, has_task, has_project,
         depends_on, owns, observes, suggests_for, subtask_of,
         governing, protects, triggered_by, gates,
         supports, exhibits, has_objective
    WHERE `in` IN $ids OR out IN $ids;
};

DEFINE FUNCTION fn::workspace_entity_ids($ws: record<workspace>) {
  LET $projects = (SELECT VALUE out FROM has_project WHERE `in` = $ws);
  LET $project_features = (SELECT VALUE out FROM has_feature WHERE `in` IN $projects);
  -- Include features that are workspace-scoped but not yet linked to a project.
  LET $workspace_features = (SELECT VALUE id FROM feature WHERE workspace = $ws);
  LET $features = array::distinct($project_features + $workspace_features);
  LET $feature_tasks = (SELECT VALUE out FROM has_task WHERE `in` IN $features);
  -- Include tasks that are workspace-scoped even if they are only attached via belongs_to.
  LET $workspace_tasks = (SELECT VALUE id FROM task WHERE workspace = $ws);
  LET $belongs_project = (SELECT VALUE `in` FROM belongs_to WHERE out IN $projects);
  LET $belongs_feature = (SELECT VALUE `in` FROM belongs_to WHERE out IN $features);
  LET $identities = (SELECT VALUE `in` FROM member_of WHERE out = $ws);
  LET $provenance = (
    SELECT VALUE out FROM extraction_relation
    WHERE `in` IN (
      SELECT VALUE id FROM message
      WHERE conversation IN (
        SELECT VALUE id FROM conversation WHERE workspace = $ws
      )
    )
  );
  LET $policies = (SELECT VALUE `in` FROM protects WHERE out = $ws AND `in`.status IN ['active', 'testing']);
  LET $intents = (SELECT VALUE id FROM intent WHERE workspace = $ws AND status NOT IN ['completed', 'vetoed', 'failed']);
  LET $agent_sessions = (SELECT VALUE out FROM gates WHERE `in` IN $intents);
  LET $objectives = (SELECT VALUE out FROM has_objective WHERE `in` = $ws OR `in` IN $projects);
  LET $behaviors = (SELECT VALUE id FROM behavior WHERE workspace = $ws);
  LET $learnings = (SELECT VALUE id FROM learning WHERE workspace = $ws);
  LET $git_commits = (SELECT VALUE id FROM git_commit WHERE workspace = $ws);
  RETURN array::distinct(
    [$ws] + $projects + $features + $feature_tasks + $workspace_tasks +
    $belongs_project + $belongs_feature +
    $identities + $provenance +
    $policies + $intents + $agent_sessions +
    $objectives + $behaviors +
    $learnings + $git_commits
  );
};

DEFINE FUNCTION fn::project_entity_ids($ws: record<workspace>, $project: record<project>) {
  LET $features = (SELECT VALUE out FROM has_feature WHERE `in` = $project);
  LET $tasks = (SELECT VALUE out FROM has_task WHERE `in` IN $features);
  LET $belongs_project = (SELECT VALUE `in` FROM belongs_to WHERE out = $project);
  LET $belongs_feature = (SELECT VALUE `in` FROM belongs_to WHERE out IN $features);
  LET $identities = (SELECT VALUE `in` FROM member_of WHERE out = $ws);
  LET $provenance = (
    SELECT VALUE out FROM extraction_relation
    WHERE `in` IN (
      SELECT VALUE id FROM message
      WHERE conversation IN (
        SELECT VALUE id FROM conversation WHERE workspace = $ws
      )
    )
  );
  LET $seed_task_ids = array::distinct($tasks + $belongs_project + $belongs_feature);
  LET $seed_tasks = (SELECT VALUE id FROM task WHERE id IN $seed_task_ids AND workspace = $ws);
  LET $depends_on_out = (SELECT VALUE out FROM depends_on WHERE `in` IN $seed_tasks AND record::tb(out) = "task");
  LET $depends_on_in = (SELECT VALUE `in` FROM depends_on WHERE out IN $seed_tasks AND record::tb(`in`) = "task");
  LET $subtask_children = (SELECT VALUE `in` FROM subtask_of WHERE out IN $seed_tasks);
  LET $subtask_parents = (SELECT VALUE out FROM subtask_of WHERE `in` IN $seed_tasks);
  LET $entity_rel_out = (SELECT VALUE out FROM entity_relation WHERE `in` IN $seed_tasks AND record::tb(out) = "task");
  LET $entity_rel_in = (SELECT VALUE `in` FROM entity_relation WHERE out IN $seed_tasks AND record::tb(`in`) = "task");
  LET $related_task_ids = array::distinct(
    $depends_on_out + $depends_on_in + $subtask_children + $subtask_parents + $entity_rel_out + $entity_rel_in
  );
  LET $related_tasks = (SELECT VALUE id FROM task WHERE id IN $related_task_ids AND workspace = $ws);
  LET $project_tasks = array::distinct($seed_tasks + $related_tasks);
  LET $intents = (SELECT VALUE `in` FROM triggered_by WHERE out IN $project_tasks AND `in`.status NOT IN ['completed', 'vetoed', 'failed']);
  LET $objectives = (SELECT VALUE out FROM has_objective WHERE `in` = $project);
  RETURN array::distinct(
    [$project] + $features + $project_tasks +
    $belongs_project + $belongs_feature +
    $identities + $provenance + $intents +
    $objectives
  );
};

-- Auth: session
DEFINE TABLE session SCHEMAFULL;
DEFINE FIELD person_id ON session TYPE record<person>;
DEFINE FIELD token ON session TYPE string;
DEFINE FIELD expires_at ON session TYPE datetime;
DEFINE FIELD ip_address ON session TYPE option<string>;
DEFINE FIELD user_agent ON session TYPE option<string>;
DEFINE FIELD created_at ON session TYPE datetime;
DEFINE FIELD updated_at ON session TYPE datetime;
DEFINE INDEX session_token ON session FIELDS token UNIQUE;
DEFINE INDEX session_person_id ON session FIELDS person_id;

-- Auth: account (OAuth provider links)
DEFINE TABLE account SCHEMAFULL;
DEFINE FIELD person_id ON account TYPE record<person>;
DEFINE FIELD account_id ON account TYPE string;
DEFINE FIELD provider_id ON account TYPE string;
DEFINE FIELD access_token ON account TYPE option<string>;
DEFINE FIELD refresh_token ON account TYPE option<string>;
DEFINE FIELD access_token_expires_at ON account TYPE option<datetime>;
DEFINE FIELD refresh_token_expires_at ON account TYPE option<datetime>;
DEFINE FIELD scope ON account TYPE option<string>;
DEFINE FIELD id_token ON account TYPE option<string>;
DEFINE FIELD password ON account TYPE option<string>;
DEFINE FIELD created_at ON account TYPE datetime;
DEFINE FIELD updated_at ON account TYPE datetime;
DEFINE INDEX account_person_id ON account FIELDS person_id;
DEFINE INDEX account_provider ON account FIELDS provider_id, account_id;

-- Auth: verification
DEFINE TABLE verification SCHEMAFULL;
DEFINE FIELD identifier ON verification TYPE string;
DEFINE FIELD value ON verification TYPE string;
DEFINE FIELD expires_at ON verification TYPE datetime;
DEFINE FIELD created_at ON verification TYPE datetime;
DEFINE FIELD updated_at ON verification TYPE datetime;
DEFINE INDEX verification_identifier ON verification FIELDS identifier;

-- OAuth Provider: client registrations (camelCase to match better-auth defaults)
DEFINE TABLE oauthClient SCHEMAFULL;
DEFINE FIELD clientId ON oauthClient TYPE string;
DEFINE FIELD clientSecret ON oauthClient TYPE option<string>;
DEFINE FIELD disabled ON oauthClient TYPE option<bool> DEFAULT false;
DEFINE FIELD skipConsent ON oauthClient TYPE option<bool>;
DEFINE FIELD enableEndSession ON oauthClient TYPE option<bool>;
DEFINE FIELD scopes ON oauthClient TYPE option<string>;
DEFINE FIELD userId ON oauthClient TYPE option<record<person>>;
DEFINE FIELD referenceId ON oauthClient TYPE option<string>;
DEFINE FIELD createdAt ON oauthClient TYPE option<datetime>;
DEFINE FIELD updatedAt ON oauthClient TYPE option<datetime>;
DEFINE FIELD expiresAt ON oauthClient TYPE option<datetime>;
DEFINE FIELD name ON oauthClient TYPE option<string>;
DEFINE FIELD uri ON oauthClient TYPE option<string>;
DEFINE FIELD icon ON oauthClient TYPE option<string>;
DEFINE FIELD contacts ON oauthClient TYPE option<string>;
DEFINE FIELD tos ON oauthClient TYPE option<string>;
DEFINE FIELD policy ON oauthClient TYPE option<string>;
DEFINE FIELD softwareId ON oauthClient TYPE option<string>;
DEFINE FIELD softwareVersion ON oauthClient TYPE option<string>;
DEFINE FIELD softwareStatement ON oauthClient TYPE option<string>;
DEFINE FIELD redirectUris ON oauthClient TYPE string;
DEFINE FIELD postLogoutRedirectUris ON oauthClient TYPE option<string>;
DEFINE FIELD tokenEndpointAuthMethod ON oauthClient TYPE option<string>;
DEFINE FIELD grantTypes ON oauthClient TYPE option<string>;
DEFINE FIELD responseTypes ON oauthClient TYPE option<string>;
DEFINE FIELD public ON oauthClient TYPE option<bool>;
DEFINE FIELD requirePKCE ON oauthClient TYPE option<bool>;
DEFINE FIELD metadata ON oauthClient TYPE option<string>;
DEFINE INDEX oauthClient_clientId ON oauthClient FIELDS clientId UNIQUE;
DEFINE INDEX oauthClient_userId ON oauthClient FIELDS userId;

-- OAuth Provider: access tokens
DEFINE TABLE oauthAccessToken SCHEMAFULL;
DEFINE FIELD token ON oauthAccessToken TYPE string;
DEFINE FIELD clientId ON oauthAccessToken TYPE string;
DEFINE FIELD sessionId ON oauthAccessToken TYPE option<record<session>>;
DEFINE FIELD userId ON oauthAccessToken TYPE option<record<person>>;
DEFINE FIELD referenceId ON oauthAccessToken TYPE option<string>;
DEFINE FIELD refreshId ON oauthAccessToken TYPE option<record<oauthRefreshToken>>;
DEFINE FIELD scopes ON oauthAccessToken TYPE string;
DEFINE FIELD expiresAt ON oauthAccessToken TYPE datetime;
DEFINE FIELD createdAt ON oauthAccessToken TYPE datetime;
DEFINE INDEX oauthAccessToken_token ON oauthAccessToken FIELDS token UNIQUE;
DEFINE INDEX oauthAccessToken_clientId ON oauthAccessToken FIELDS clientId;

-- OAuth Provider: refresh tokens
DEFINE TABLE oauthRefreshToken SCHEMAFULL;
DEFINE FIELD token ON oauthRefreshToken TYPE string;
DEFINE FIELD clientId ON oauthRefreshToken TYPE string;
DEFINE FIELD sessionId ON oauthRefreshToken TYPE option<record<session>>;
DEFINE FIELD userId ON oauthRefreshToken TYPE option<record<person>>;
DEFINE FIELD referenceId ON oauthRefreshToken TYPE option<string>;
DEFINE FIELD scopes ON oauthRefreshToken TYPE string;
DEFINE FIELD revoked ON oauthRefreshToken TYPE option<datetime>;
DEFINE FIELD authTime ON oauthRefreshToken TYPE option<datetime>;
DEFINE FIELD createdAt ON oauthRefreshToken TYPE datetime;
DEFINE FIELD expiresAt ON oauthRefreshToken TYPE datetime;
DEFINE INDEX oauthRefreshToken_token ON oauthRefreshToken FIELDS token UNIQUE;
DEFINE INDEX oauthRefreshToken_clientId ON oauthRefreshToken FIELDS clientId;

-- OAuth Provider: consent records
DEFINE TABLE oauthConsent SCHEMAFULL;
DEFINE FIELD clientId ON oauthConsent TYPE string;
DEFINE FIELD userId ON oauthConsent TYPE option<record<person>>;
DEFINE FIELD referenceId ON oauthConsent TYPE option<string>;
DEFINE FIELD scopes ON oauthConsent TYPE string;
DEFINE FIELD createdAt ON oauthConsent TYPE datetime;
DEFINE FIELD updatedAt ON oauthConsent TYPE datetime;
DEFINE INDEX oauthConsent_clientId_userId ON oauthConsent FIELDS clientId, userId;

-- OAuth Provider: JWKS signing keys
DEFINE TABLE jwks SCHEMAFULL;
DEFINE FIELD publicKey ON jwks TYPE string;
DEFINE FIELD privateKey ON jwks TYPE string;
DEFINE FIELD createdAt ON jwks TYPE datetime;
DEFINE FIELD expiresAt ON jwks TYPE option<datetime>;

-- Audit events: OAuth RAR+DPoP security audit trail
DEFINE TABLE audit_event SCHEMAFULL;
DEFINE FIELD event_type ON audit_event TYPE string
  ASSERT $value IN ["intent_submitted", "intent_evaluated", "intent_routed", "consent_approved", "consent_constrained", "consent_vetoed", "token_issued", "token_rejected", "dpop_verified", "dpop_rejected", "security_alert", "policy_created", "policy_activated", "policy_updated", "policy_deprecated"];
DEFINE FIELD severity ON audit_event TYPE string
  ASSERT $value IN ["info", "warning", "security"];
DEFINE FIELD actor ON audit_event TYPE record<identity>;
DEFINE FIELD workspace ON audit_event TYPE record<workspace>;
DEFINE FIELD intent_id ON audit_event TYPE option<record<intent>>;
DEFINE FIELD dpop_thumbprint ON audit_event TYPE option<string>;
DEFINE FIELD payload ON audit_event TYPE object FLEXIBLE;
DEFINE FIELD created_at ON audit_event TYPE datetime;
DEFINE INDEX audit_event_workspace_type ON audit_event FIELDS workspace, event_type;
DEFINE INDEX audit_event_created_at ON audit_event FIELDS created_at;
DEFINE INDEX audit_event_intent ON audit_event FIELDS intent_id;
DEFINE INDEX audit_event_severity ON audit_event FIELDS severity;

-- Authorization server signing keys
DEFINE TABLE as_signing_key SCHEMAFULL;
DEFINE FIELD kid ON as_signing_key TYPE string;
DEFINE FIELD algorithm ON as_signing_key TYPE string ASSERT $value = "ES256";
DEFINE FIELD public_jwk ON as_signing_key TYPE object FLEXIBLE;
DEFINE FIELD private_jwk ON as_signing_key TYPE object FLEXIBLE;
DEFINE FIELD status ON as_signing_key TYPE string
  ASSERT $value IN ["active", "rotated"];
DEFINE FIELD created_at ON as_signing_key TYPE datetime;
DEFINE FIELD rotated_at ON as_signing_key TYPE option<datetime>;
DEFINE INDEX as_signing_key_kid ON as_signing_key FIELDS kid UNIQUE;
DEFINE INDEX as_signing_key_status ON as_signing_key FIELDS status;

-- =============================================================================
-- Observer Agent EVENTs
-- =============================================================================
-- These EVENTs fire http::post to the observer endpoint when relevant state
-- transitions occur. In production the base URL is configured via migration.
-- In tests, wireObserverEvents() overwrites these with the test server URL.
-- SurrealDB silently swallows http::post failures, so a placeholder URL here
-- is harmless until the actual observer route is deployed.

-- EVENT 1: task_completed — fires when task status transitions to completed/done
DEFINE EVENT task_completed ON task
  ASYNC
  RETRY 3
  WHEN $event = "UPDATE"
    AND ($before.status != "completed" AND $before.status != "done")
    AND ($after.status = "completed" OR $after.status = "done")
  THEN {
    http::post("http://localhost:3000/api/observe/task/" + <string> meta::id($after.id), $after)
  };

-- EVENT 2: intent_completed — fires when intent status transitions to completed/failed
DEFINE EVENT intent_completed ON intent
  ASYNC
  RETRY 3
  WHEN $event = "UPDATE"
    AND ($before.status != "completed" AND $before.status != "failed")
    AND ($after.status = "completed" OR $after.status = "failed")
  THEN {
    http::post("http://localhost:3000/api/observe/intent/" + <string> meta::id($after.id), $after)
  };

-- EVENT 3: commit_created — fires when a new git_commit record is created
DEFINE EVENT commit_created ON git_commit
  ASYNC
  RETRY 3
  WHEN $event = "CREATE"
  THEN {
    http::post("http://localhost:3000/api/observe/git_commit/" + <string> meta::id($after.id), $after)
  };

-- EVENT 4: decision_confirmed — fires when decision status changes to confirmed/superseded
DEFINE EVENT decision_confirmed ON decision
  ASYNC
  RETRY 3
  WHEN $event = "UPDATE"
    AND $before.status != $after.status
    AND ($after.status = "confirmed" OR $after.status = "superseded")
  THEN {
    http::post("http://localhost:3000/api/observe/decision/" + <string> meta::id($after.id), $after)
  };

-- EVENT 5: observation_peer_review — fires when non-observer observation is created
-- Observer's own observations are excluded to prevent infinite recursion loops.
DEFINE EVENT observation_peer_review ON observation
  ASYNC
  RETRY 3
  WHEN $event = "CREATE" AND $after.source_agent != "observer_agent"
  THEN {
    http::post("http://localhost:3000/api/observe/observation/" + <string> meta::id($after.id), $after)
  };

-- EVENT 6: trace_llm_call_created — fires when a new LLM call trace is created
-- Observer analyzes LLM responses for contradictions with confirmed decisions
-- and unrecorded architectural choices.
DEFINE EVENT trace_llm_call_created ON trace
  ASYNC
  RETRY 3
  WHEN $event = "CREATE" AND $after.type = "llm_call"
  THEN {
    http::post("http://localhost:3000/api/observe/trace/" + <string> meta::id($after.id), $after)
  };

-- ---------------------------------------------------------------------------
-- Learning table: behavioral rules injected into agent prompts at runtime
-- ---------------------------------------------------------------------------

DEFINE TABLE learning SCHEMAFULL;
DEFINE FIELD text ON learning TYPE string;
DEFINE FIELD learning_type ON learning TYPE string
  ASSERT $value IN ["constraint", "instruction", "precedent"];
DEFINE FIELD status ON learning TYPE string
  ASSERT $value IN ["active", "pending_approval", "dismissed", "superseded", "deactivated"];
DEFINE FIELD source ON learning TYPE string
  ASSERT $value IN ["human", "agent"];
DEFINE FIELD priority ON learning TYPE string
  DEFAULT "medium"
  ASSERT $value IN ["low", "medium", "high"];
DEFINE FIELD target_agents ON learning TYPE array<string>;
DEFINE FIELD workspace ON learning TYPE record<workspace>;
DEFINE FIELD suggested_by ON learning TYPE option<string>;
DEFINE FIELD pattern_confidence ON learning TYPE option<float>;
DEFINE FIELD created_by ON learning TYPE option<record<identity>>;
DEFINE FIELD created_at ON learning TYPE datetime;
DEFINE FIELD updated_at ON learning TYPE option<datetime>;
DEFINE FIELD approved_by ON learning TYPE option<record<identity>>;
DEFINE FIELD approved_at ON learning TYPE option<datetime>;
DEFINE FIELD activated_at ON learning TYPE option<datetime>;
DEFINE FIELD dismissed_by ON learning TYPE option<record<identity>>;
DEFINE FIELD dismissed_at ON learning TYPE option<datetime>;
DEFINE FIELD dismissed_reason ON learning TYPE option<string>;
DEFINE FIELD deactivated_by ON learning TYPE option<record<identity>>;
DEFINE FIELD deactivated_at ON learning TYPE option<datetime>;
DEFINE INDEX idx_learning_workspace_status ON learning FIELDS workspace, status;
DEFINE INDEX OVERWRITE idx_learning_fulltext ON learning FIELDS text FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);

-- Evidence relation: links a learning to source entities
DEFINE TABLE learning_evidence TYPE RELATION IN learning OUT message | trace | observation | agent_session | behavior SCHEMAFULL;
DEFINE FIELD added_at ON learning_evidence TYPE option<datetime>;

-- Supersession relation: tracks when one learning replaces another
DEFINE TABLE supersedes TYPE RELATION IN learning OUT learning SCHEMAFULL;
DEFINE FIELD superseded_at ON supersedes TYPE datetime;
DEFINE FIELD reason ON supersedes TYPE option<string>;

-- Objective: strategic goal node
DEFINE TABLE objective SCHEMAFULL;
DEFINE FIELD title ON objective TYPE string;
DEFINE FIELD description ON objective TYPE option<string>;
DEFINE FIELD target_date ON objective TYPE option<string>;
DEFINE FIELD priority ON objective TYPE string
  ASSERT $value IN ["low", "medium", "high", "critical"];
DEFINE FIELD status ON objective TYPE string
  ASSERT $value IN ["draft", "active", "completed", "archived", "expired"];
DEFINE FIELD success_criteria ON objective TYPE option<array<object>>;
DEFINE FIELD success_criteria[*].metric_name ON objective TYPE string;
DEFINE FIELD success_criteria[*].target_value ON objective TYPE float;
DEFINE FIELD success_criteria[*].current_value ON objective TYPE float;
DEFINE FIELD success_criteria[*].unit ON objective TYPE string;
DEFINE FIELD workspace ON objective TYPE record<workspace>;
DEFINE FIELD source_message ON objective TYPE option<record<message>>;
DEFINE FIELD created_by ON objective TYPE option<record<identity>>;
DEFINE FIELD created_at ON objective TYPE datetime;
DEFINE FIELD updated_at ON objective TYPE option<datetime>;
DEFINE INDEX objective_workspace_status ON objective FIELDS workspace, status;
DEFINE INDEX OVERWRITE idx_objective_fulltext ON objective FIELDS title FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX objective_target_date ON objective FIELDS target_date;

-- has_objective: links project or workspace to its objectives
DEFINE TABLE has_objective TYPE RELATION IN project | workspace OUT objective SCHEMAFULL;
DEFINE FIELD added_at ON has_objective TYPE datetime;

-- supports: links intent to strategic objective
DEFINE TABLE supports TYPE RELATION IN intent OUT objective SCHEMAFULL;
DEFINE FIELD alignment_score ON supports TYPE float
  ASSERT $value >= 0.0 AND $value <= 1.0;
DEFINE FIELD alignment_method ON supports TYPE string
  ASSERT $value IN ["embedding", "manual", "rule", "graph", "bm25"];
DEFINE FIELD reasoning ON supports TYPE option<string>;
DEFINE FIELD added_at ON supports TYPE option<datetime>;
DEFINE INDEX supports_out ON supports FIELDS out;

-- Behavior Definition: admin-defined behavioral standard
DEFINE TABLE behavior_definition SCHEMAFULL;
DEFINE FIELD title ON behavior_definition TYPE string;
DEFINE FIELD goal ON behavior_definition TYPE string;
DEFINE FIELD scoring_logic ON behavior_definition TYPE string;
DEFINE FIELD telemetry_types ON behavior_definition TYPE array<string>;
DEFINE FIELD category ON behavior_definition TYPE option<string>;
DEFINE FIELD status ON behavior_definition TYPE string
  ASSERT $value IN ["draft", "active", "archived"];
DEFINE FIELD version ON behavior_definition TYPE int ASSERT $value > 0;
DEFINE FIELD enforcement_mode ON behavior_definition TYPE string
  ASSERT $value IN ["warn_only", "automatic"]
  DEFAULT "warn_only";
DEFINE FIELD enforcement_threshold ON behavior_definition TYPE option<float>
  ASSERT $value = NONE OR ($value >= 0.0 AND $value <= 1.0);
DEFINE FIELD workspace ON behavior_definition TYPE record<workspace>;
DEFINE FIELD created_by ON behavior_definition TYPE option<record<identity>>;
DEFINE FIELD created_at ON behavior_definition TYPE datetime;
DEFINE FIELD updated_at ON behavior_definition TYPE option<datetime>;
DEFINE INDEX idx_behaviordef_workspace ON behavior_definition FIELDS workspace;
DEFINE INDEX idx_behaviordef_ws_status ON behavior_definition FIELDS workspace, status;

-- Behavior: agent craftsmanship metric record (append-only)
DEFINE TABLE behavior SCHEMAFULL;
DEFINE FIELD metric_type ON behavior TYPE string;
DEFINE FIELD score ON behavior TYPE float
  ASSERT $value >= 0.0 AND $value <= 1.0;
DEFINE FIELD source_telemetry ON behavior TYPE object FLEXIBLE;
DEFINE FIELD definition ON behavior TYPE record<behavior_definition>;
DEFINE FIELD definition_version ON behavior TYPE int ASSERT $value > 0;
DEFINE FIELD workspace ON behavior TYPE record<workspace>;
DEFINE FIELD session ON behavior TYPE option<record<agent_session>>;
DEFINE FIELD created_at ON behavior TYPE datetime;
DEFINE INDEX behavior_workspace_metric ON behavior FIELDS workspace, metric_type;
DEFINE INDEX behavior_session ON behavior FIELDS session;
DEFINE INDEX behavior_created_at ON behavior FIELDS created_at;

-- exhibits: links an agent identity to a behavior record
DEFINE TABLE exhibits TYPE RELATION IN identity OUT behavior SCHEMAFULL;
DEFINE FIELD created_at ON exhibits TYPE option<datetime>;
DEFINE FIELD added_at ON exhibits TYPE option<datetime>;

-- Proxy intelligence configuration (workspace-scoped)
DEFINE TABLE proxy_intelligence_config SCHEMAFULL;
DEFINE FIELD workspace ON proxy_intelligence_config TYPE record<workspace>;
DEFINE FIELD context_injection_enabled ON proxy_intelligence_config TYPE bool;
DEFINE FIELD context_injection_token_budget ON proxy_intelligence_config TYPE int;
DEFINE FIELD context_injection_cache_ttl_seconds ON proxy_intelligence_config TYPE int;
DEFINE FIELD context_injection_tier ON proxy_intelligence_config TYPE string
  ASSERT $value IN ["fast", "secure"];
DEFINE FIELD contradiction_detection_enabled ON proxy_intelligence_config TYPE bool;
DEFINE FIELD contradiction_tier1_threshold ON proxy_intelligence_config TYPE float;
DEFINE FIELD contradiction_tier2_confidence_min ON proxy_intelligence_config TYPE float;
DEFINE FIELD created_at ON proxy_intelligence_config TYPE datetime;
DEFINE FIELD updated_at ON proxy_intelligence_config TYPE datetime;
DEFINE INDEX proxy_intelligence_config_workspace ON proxy_intelligence_config FIELDS workspace UNIQUE;

-- ---------------------------------------------------------------------------
-- Proxy Token: CLI proxy authentication tokens (hashed, scoped, revocable)
-- ---------------------------------------------------------------------------
DEFINE TABLE proxy_token SCHEMAFULL;
DEFINE FIELD token_hash ON proxy_token TYPE string;
DEFINE FIELD workspace ON proxy_token TYPE record<workspace>;
DEFINE FIELD identity ON proxy_token TYPE record<identity>;
DEFINE FIELD expires_at ON proxy_token TYPE datetime;
DEFINE FIELD created_at ON proxy_token TYPE datetime DEFAULT time::now();
DEFINE FIELD revoked ON proxy_token TYPE bool DEFAULT false;
DEFINE FIELD intent ON proxy_token TYPE option<record<intent>>;
DEFINE FIELD session ON proxy_token TYPE option<record<agent_session>>;
DEFINE INDEX idx_proxy_token_hash ON proxy_token FIELDS token_hash UNIQUE;
DEFINE INDEX idx_proxy_token_identity_workspace ON proxy_token FIELDS identity, workspace;

-- ---------------------------------------------------------------------------
-- MCP Tool Registry: Server connections, tool definitions, authorization,
-- credentials, governance
-- ---------------------------------------------------------------------------

-- mcp_server: MCP server connection configuration
DEFINE TABLE mcp_server SCHEMAFULL;
DEFINE FIELD name ON mcp_server TYPE string;
DEFINE FIELD url ON mcp_server TYPE string;
DEFINE FIELD transport ON mcp_server TYPE string DEFAULT "streamable-http"
  ASSERT $value IN ["streamable-http", "sse"];
DEFINE FIELD workspace ON mcp_server TYPE record<workspace>;
DEFINE FIELD status ON mcp_server TYPE string DEFAULT "active"
  ASSERT $value IN ["active", "disabled"];
DEFINE FIELD provider ON mcp_server TYPE option<record<credential_provider>>;
DEFINE FIELD auth_mode ON mcp_server TYPE string DEFAULT "none"
  ASSERT $value IN ["none", "static_headers", "oauth", "provider"];
DEFINE FIELD static_headers ON mcp_server TYPE option<array<object>>;
DEFINE FIELD static_headers[*].name ON mcp_server TYPE string;
DEFINE FIELD static_headers[*].value_encrypted ON mcp_server TYPE string;
DEFINE FIELD oauth_account ON mcp_server TYPE option<record<connected_account>>;
DEFINE FIELD last_status ON mcp_server TYPE option<string>
  ASSERT $value IN ["ok", "error", "auth_error"] OR $value IS NONE;
DEFINE FIELD last_error ON mcp_server TYPE option<string>;
DEFINE FIELD server_info ON mcp_server TYPE option<object> FLEXIBLE;
DEFINE FIELD capabilities ON mcp_server TYPE option<object> FLEXIBLE;
DEFINE FIELD last_discovery ON mcp_server TYPE option<datetime>;
DEFINE FIELD pending_pkce_verifier ON mcp_server TYPE option<string>;
DEFINE FIELD pending_oauth_state ON mcp_server TYPE option<string>;
DEFINE FIELD tool_count ON mcp_server TYPE int DEFAULT 0;
DEFINE FIELD created_at ON mcp_server TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_mcp_server_workspace ON mcp_server FIELDS workspace;
DEFINE INDEX idx_mcp_server_workspace_name ON mcp_server FIELDS workspace, name UNIQUE;
DEFINE INDEX idx_mcp_server_workspace_status ON mcp_server FIELDS workspace, status;

-- mcp_tool: Tool definitions registered in a workspace
DEFINE TABLE mcp_tool SCHEMAFULL;
DEFINE FIELD name ON mcp_tool TYPE string;
DEFINE FIELD toolkit ON mcp_tool TYPE string;
DEFINE FIELD description ON mcp_tool TYPE string;
DEFINE FIELD input_schema ON mcp_tool TYPE object FLEXIBLE;
DEFINE FIELD output_schema ON mcp_tool TYPE option<object> FLEXIBLE;
DEFINE FIELD provider ON mcp_tool TYPE option<record<credential_provider>>;
DEFINE FIELD risk_level ON mcp_tool TYPE string ASSERT $value IN ["low", "medium", "high", "critical"];
DEFINE FIELD workspace ON mcp_tool TYPE record<workspace>;
DEFINE FIELD status ON mcp_tool TYPE string ASSERT $value IN ["active", "disabled"];
DEFINE FIELD source_server ON mcp_tool TYPE option<record<mcp_server>>;
DEFINE FIELD created_at ON mcp_tool TYPE datetime DEFAULT time::now();
DEFINE INDEX mcp_tool_workspace ON mcp_tool FIELDS workspace;
DEFINE INDEX mcp_tool_workspace_name ON mcp_tool FIELDS workspace, name;
DEFINE INDEX mcp_tool_workspace_toolkit ON mcp_tool FIELDS workspace, toolkit;
DEFINE INDEX mcp_tool_workspace_status ON mcp_tool FIELDS workspace, status;

-- can_use: Authorization edge from identity to mcp_tool
DEFINE TABLE can_use TYPE RELATION IN identity OUT mcp_tool SCHEMAFULL;
DEFINE FIELD granted_at ON can_use TYPE datetime DEFAULT time::now();
DEFINE FIELD max_calls_per_hour ON can_use TYPE option<int>;
DEFINE INDEX can_use_identity ON can_use FIELDS in;
DEFINE INDEX can_use_tool ON can_use FIELDS out;

-- credential_provider: External service credential configuration
DEFINE TABLE credential_provider SCHEMAFULL;
DEFINE FIELD name ON credential_provider TYPE string;
DEFINE FIELD display_name ON credential_provider TYPE string;
DEFINE FIELD auth_method ON credential_provider TYPE string ASSERT $value IN ["oauth2", "api_key", "bearer", "basic"];
DEFINE FIELD workspace ON credential_provider TYPE record<workspace>;
DEFINE FIELD authorization_url ON credential_provider TYPE option<string>;
DEFINE FIELD token_url ON credential_provider TYPE option<string>;
DEFINE FIELD client_id ON credential_provider TYPE option<string>;
DEFINE FIELD client_secret_encrypted ON credential_provider TYPE option<string>;
DEFINE FIELD scopes ON credential_provider TYPE option<array<string>>;
DEFINE FIELD api_key_header ON credential_provider TYPE option<string>;
DEFINE FIELD discovery_source ON credential_provider TYPE option<string>;
DEFINE FIELD auth_server_url ON credential_provider TYPE option<string>;
DEFINE FIELD created_at ON credential_provider TYPE datetime DEFAULT time::now();
DEFINE INDEX credential_provider_workspace ON credential_provider FIELDS workspace;
DEFINE INDEX credential_provider_workspace_name ON credential_provider FIELDS workspace, name;

-- connected_account: Identity's connected credentials for a provider
DEFINE TABLE connected_account SCHEMAFULL;
DEFINE FIELD identity ON connected_account TYPE record<identity>;
DEFINE FIELD provider ON connected_account TYPE record<credential_provider>;
DEFINE FIELD workspace ON connected_account TYPE record<workspace>;
DEFINE FIELD status ON connected_account TYPE string ASSERT $value IN ["active", "revoked", "expired"];
DEFINE FIELD access_token_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD refresh_token_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD token_expires_at ON connected_account TYPE option<datetime>;
DEFINE FIELD api_key_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD basic_username ON connected_account TYPE option<string>;
DEFINE FIELD basic_password_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD bearer_token_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD scopes ON connected_account TYPE option<array<string>>;
DEFINE FIELD connected_at ON connected_account TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON connected_account TYPE datetime DEFAULT time::now();
DEFINE INDEX connected_account_identity_provider ON connected_account FIELDS identity, provider;
DEFINE INDEX connected_account_workspace ON connected_account FIELDS workspace;
DEFINE INDEX connected_account_identity ON connected_account FIELDS identity;

-- governs_tool: Policy governance edge from policy to mcp_tool
DEFINE TABLE governs_tool TYPE RELATION IN policy OUT mcp_tool SCHEMAFULL;
DEFINE FIELD conditions ON governs_tool TYPE option<string>;
DEFINE FIELD max_per_call ON governs_tool TYPE option<int>;
DEFINE FIELD max_per_day ON governs_tool TYPE option<int>;
DEFINE INDEX governs_tool_policy ON governs_tool FIELDS in;
DEFINE INDEX governs_tool_tool ON governs_tool FIELDS out;

-- skill: domain expertise with source reference and lifecycle
DEFINE TABLE skill SCHEMAFULL;
DEFINE FIELD name ON skill TYPE string;
DEFINE FIELD description ON skill TYPE string;
DEFINE FIELD version ON skill TYPE string;
DEFINE FIELD status ON skill TYPE string ASSERT $value IN ["draft", "active", "deprecated"];
DEFINE FIELD workspace ON skill TYPE record<workspace>;
DEFINE FIELD source ON skill TYPE object;
DEFINE FIELD source.type ON skill TYPE string ASSERT $value IN ["github", "git"];
DEFINE FIELD source.source ON skill TYPE string;
DEFINE FIELD source.ref ON skill TYPE option<string>;
DEFINE FIELD source.subpath ON skill TYPE option<string>;
DEFINE FIELD source.skills ON skill TYPE option<array<string>>;
DEFINE FIELD created_by ON skill TYPE option<record<identity>>;
DEFINE FIELD created_at ON skill TYPE datetime;
DEFINE FIELD updated_at ON skill TYPE option<datetime>;
DEFINE INDEX idx_skill_workspace_name ON skill FIELDS workspace, name;

-- skill_requires: skill requires mcp_tool
DEFINE TABLE skill_requires TYPE RELATION IN skill OUT mcp_tool SCHEMAFULL;

-- possesses: identity possesses skill
DEFINE TABLE possesses TYPE RELATION IN identity OUT skill SCHEMAFULL;
DEFINE FIELD granted_at ON possesses TYPE datetime DEFAULT time::now();

-- skill_supersedes: skill version chain
DEFINE TABLE skill_supersedes TYPE RELATION IN skill OUT skill SCHEMAFULL;

-- skill_evidence: skill activation evidence
DEFINE TABLE skill_evidence TYPE RELATION IN skill OUT agent_session | trace | observation SCHEMAFULL;
DEFINE FIELD added_at ON skill_evidence TYPE datetime;

-- governs_skill: policy governance edge from policy to skill
DEFINE TABLE governs_skill TYPE RELATION IN policy OUT skill SCHEMAFULL;
DEFINE FIELD created_at ON governs_skill TYPE datetime;

-- Analytics agent: read-only database user
DEFINE USER analytics ON DATABASE PASSWORD 'osabio-analytics-readonly' ROLES VIEWER;

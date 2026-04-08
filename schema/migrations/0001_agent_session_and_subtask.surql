-- Add agent_session entity for coding agent session tracking
-- and subtask_of relation for task hierarchy.
-- Required for MCP coding agent integration (PLAN.md Layer 1 & 2).

BEGIN TRANSACTION;

-- Agent session entity: logs each coding agent session as a graph node
DEFINE TABLE OVERWRITE agent_session SCHEMAFULL;
DEFINE FIELD OVERWRITE agent ON agent_session TYPE string;
DEFINE FIELD OVERWRITE started_at ON agent_session TYPE datetime;
DEFINE FIELD OVERWRITE ended_at ON agent_session TYPE option<datetime>;
DEFINE FIELD OVERWRITE workspace ON agent_session TYPE record<workspace>;
DEFINE FIELD OVERWRITE project ON agent_session TYPE record<project>;
DEFINE FIELD OVERWRITE task_id ON agent_session TYPE option<record<task>>;
DEFINE FIELD OVERWRITE summary ON agent_session TYPE option<string>;
DEFINE FIELD OVERWRITE decisions_made ON agent_session TYPE option<array<record<decision>>>;
DEFINE FIELD OVERWRITE questions_asked ON agent_session TYPE option<array<record<question>>>;
DEFINE FIELD OVERWRITE tasks_progressed ON agent_session TYPE option<array<object>>;
DEFINE FIELD OVERWRITE tasks_progressed[*].task_id ON agent_session TYPE record<task>;
DEFINE FIELD OVERWRITE tasks_progressed[*].from_status ON agent_session TYPE string;
DEFINE FIELD OVERWRITE tasks_progressed[*].to_status ON agent_session TYPE string;
DEFINE FIELD OVERWRITE files_changed ON agent_session TYPE option<array<object>>;
DEFINE FIELD OVERWRITE files_changed[*].path ON agent_session TYPE string;
DEFINE FIELD OVERWRITE files_changed[*].change_type ON agent_session TYPE string
  ASSERT $value IN ["created", "modified", "deleted"];
DEFINE FIELD OVERWRITE created_at ON agent_session TYPE datetime;
DEFINE INDEX OVERWRITE agent_session_workspace ON agent_session FIELDS workspace;
DEFINE INDEX OVERWRITE agent_session_project ON agent_session FIELDS project;
DEFINE INDEX OVERWRITE agent_session_started_at ON agent_session FIELDS started_at;

-- Subtask relation: task -> task hierarchy
DEFINE TABLE OVERWRITE subtask_of TYPE RELATION IN task OUT task SCHEMAFULL;
DEFINE FIELD OVERWRITE added_at ON subtask_of TYPE datetime;

-- Session relations: agent_session -> entities it produced/touched
DEFINE TABLE OVERWRITE produced TYPE RELATION IN agent_session OUT decision SCHEMAFULL;
DEFINE FIELD OVERWRITE added_at ON produced TYPE datetime;

DEFINE TABLE OVERWRITE asked TYPE RELATION IN agent_session OUT question SCHEMAFULL;
DEFINE FIELD OVERWRITE added_at ON asked TYPE datetime;

DEFINE TABLE OVERWRITE progressed TYPE RELATION IN agent_session OUT task SCHEMAFULL;
DEFINE FIELD OVERWRITE from_status ON progressed TYPE string;
DEFINE FIELD OVERWRITE to_status ON progressed TYPE string;
DEFINE FIELD OVERWRITE added_at ON progressed TYPE datetime;

COMMIT TRANSACTION;

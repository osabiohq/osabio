-- Add coding-agent-specific fields to observation table
-- and observed_in relation for session tracking.

BEGIN TRANSACTION;

-- Observation type: what kind of thing was observed (coding agent categories)
DEFINE FIELD OVERWRITE observation_type ON observation TYPE option<string>
  ASSERT $value IN ["contradiction", "duplication", "missing", "deprecated", "pattern", "anomaly"] OR $value IS NONE;

-- Link observation to the agent session that created it
DEFINE FIELD OVERWRITE source_session ON observation TYPE option<record<agent_session>>;

-- Track observations logged during a session (populated at session end)
DEFINE FIELD OVERWRITE observations_logged ON agent_session TYPE option<array<record<observation>>>;

-- observed_in relation: observation -> agent_session
DEFINE TABLE OVERWRITE observed_in TYPE RELATION IN observation OUT agent_session SCHEMAFULL;
DEFINE FIELD OVERWRITE added_at ON observed_in TYPE datetime;

COMMIT TRANSACTION;

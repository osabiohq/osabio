-- Add source_session field to task table for coding agent session tracking
-- and formalize task status values with ASSERT constraint.

BEGIN TRANSACTION;

-- Link task to the agent session currently working on it
DEFINE FIELD OVERWRITE source_session ON task TYPE option<record<agent_session>>;

-- Formalize allowed task status values
ALTER FIELD status ON task TYPE string
  ASSERT $value IN ["open", "todo", "ready", "in_progress", "blocked", "done", "completed"];

COMMIT TRANSACTION;

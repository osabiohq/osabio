-- Migration 0041: Rename opencode_session_id to external_session_id on agent_session
-- Step: 01-01 (LLM proxy schema migrations)
--
-- Three-step data migration:
-- 1. Define the new field external_session_id
-- 2. Copy existing data from opencode_session_id
-- 3. Remove the old field
-- Plus composite index for session lookup by (external_session_id, workspace).

BEGIN TRANSACTION;

-- Step 1: Define the new field
DEFINE FIELD OVERWRITE external_session_id ON agent_session TYPE option<string>;

-- Step 2: Copy existing data from opencode_session_id to external_session_id
UPDATE agent_session SET external_session_id = opencode_session_id WHERE opencode_session_id IS NOT NONE;

-- Step 3: Remove the old field
REMOVE FIELD IF EXISTS opencode_session_id ON agent_session;

-- Composite index for session lookup by external ID within a workspace
DEFINE INDEX OVERWRITE agent_session_external_workspace ON agent_session FIELDS external_session_id, workspace;

COMMIT TRANSACTION;

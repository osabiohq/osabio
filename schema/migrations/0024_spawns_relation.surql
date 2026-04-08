-- Migration 0024: Add spawns relation (message -> trace) and remove embedded subagent_traces
--
-- Replaces the denormalized subagent_traces array on message with a graph-native
-- spawns relation edge, completing the trace table migration.

DEFINE TABLE OVERWRITE spawns TYPE RELATION IN message OUT trace SCHEMAFULL;

BEGIN TRANSACTION;

-- Remove embedded subagent_traces fields from message table
REMOVE FIELD IF EXISTS subagent_traces ON message;

COMMIT TRANSACTION;

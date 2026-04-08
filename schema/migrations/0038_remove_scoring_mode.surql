-- Remove scoring_mode field from behavior_definition table.
-- All scoring now goes through the LLM scorer; deterministic scoring mode is removed.
-- See ADR-038 for rationale.

BEGIN TRANSACTION;

REMOVE FIELD IF EXISTS scoring_mode ON behavior_definition;
UPDATE behavior_definition UNSET scoring_mode;

COMMIT TRANSACTION;

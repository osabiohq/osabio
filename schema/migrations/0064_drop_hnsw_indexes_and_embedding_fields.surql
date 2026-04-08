-- Migration 0064: Drop all HNSW indexes and embedding fields
--
-- ADR-062: Replace embeddings with BM25 and graph traversal.
-- This migration removes all vector embedding infrastructure from the schema.
-- HNSW indexes and embedding fields are no longer needed since all search
-- operations now use BM25 fulltext or graph traversal.

BEGIN TRANSACTION;

-- ── Remove HNSW indexes ──

REMOVE INDEX IF EXISTS idx_message_embedding ON message;
REMOVE INDEX IF EXISTS idx_project_embedding ON project;
REMOVE INDEX IF EXISTS idx_feature_embedding ON feature;
REMOVE INDEX IF EXISTS idx_task_embedding ON task;
REMOVE INDEX IF EXISTS idx_decision_embedding ON decision;
REMOVE INDEX IF EXISTS idx_question_embedding ON question;
REMOVE INDEX IF EXISTS idx_observation_embedding ON observation;
REMOVE INDEX IF EXISTS idx_suggestion_embedding ON suggestion;
REMOVE INDEX IF EXISTS idx_person_embedding ON person;
REMOVE INDEX IF EXISTS idx_document_chunk_embedding ON document_chunk;
REMOVE INDEX IF EXISTS idx_git_commit_embedding ON git_commit;
REMOVE INDEX IF EXISTS idx_intent_embedding ON intent;
REMOVE INDEX IF EXISTS idx_policy_embedding ON policy;
REMOVE INDEX IF EXISTS idx_learning_embedding ON learning;
REMOVE INDEX IF EXISTS idx_objective_embedding ON objective;
REMOVE INDEX IF EXISTS idx_agent_session_description_embedding ON agent_session;
REMOVE INDEX IF EXISTS idx_agent_description_embedding ON agent;

-- ── Remove embedding fields ──

REMOVE FIELD IF EXISTS embedding ON conversation;
REMOVE FIELD IF EXISTS embedding ON message;
REMOVE FIELD IF EXISTS embedding ON project;
REMOVE FIELD IF EXISTS embedding ON feature;
REMOVE FIELD IF EXISTS embedding ON task;
REMOVE FIELD IF EXISTS embedding ON decision;
REMOVE FIELD IF EXISTS embedding ON question;
REMOVE FIELD IF EXISTS embedding ON observation;
REMOVE FIELD IF EXISTS embedding ON suggestion;
REMOVE FIELD IF EXISTS embedding ON person;
REMOVE FIELD IF EXISTS embedding ON document_chunk;
REMOVE FIELD IF EXISTS embedding ON git_commit;
REMOVE FIELD IF EXISTS embedding ON intent;
REMOVE FIELD IF EXISTS embedding ON policy;
REMOVE FIELD IF EXISTS embedding ON learning;
REMOVE FIELD IF EXISTS embedding ON objective;
REMOVE FIELD IF EXISTS description_embedding ON agent_session;
REMOVE FIELD IF EXISTS description_embedding ON agent;

-- ── Unset embedding data from existing rows ──

UPDATE conversation UNSET embedding;
UPDATE message UNSET embedding;
UPDATE project UNSET embedding;
UPDATE feature UNSET embedding;
UPDATE task UNSET embedding;
UPDATE decision UNSET embedding;
UPDATE question UNSET embedding;
UPDATE observation UNSET embedding;
UPDATE suggestion UNSET embedding;
UPDATE person UNSET embedding;
UPDATE document_chunk UNSET embedding;
UPDATE git_commit UNSET embedding;
UPDATE intent UNSET embedding;
UPDATE policy UNSET embedding;
UPDATE learning UNSET embedding;
UPDATE objective UNSET embedding;
UPDATE agent_session UNSET description_embedding;
UPDATE agent UNSET description_embedding;

COMMIT TRANSACTION;

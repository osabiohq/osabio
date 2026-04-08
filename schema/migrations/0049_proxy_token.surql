-- Migration 0049: Define proxy_token table for CLI proxy authentication
--
-- Stores hashed tokens that CLI clients use to authenticate with the LLM proxy.
-- Each token is scoped to a workspace and identity, with expiration and revocation support.

BEGIN TRANSACTION;

DEFINE TABLE OVERWRITE proxy_token SCHEMAFULL;

-- Token hash (SHA-256 of the raw token; raw token never stored)
DEFINE FIELD OVERWRITE token_hash ON proxy_token TYPE string;
-- Workspace this token is scoped to
DEFINE FIELD OVERWRITE workspace ON proxy_token TYPE record<workspace>;
-- Identity that owns this token
DEFINE FIELD OVERWRITE identity ON proxy_token TYPE record<identity>;
-- Expiration timestamp
DEFINE FIELD OVERWRITE expires_at ON proxy_token TYPE datetime;
-- Creation timestamp
DEFINE FIELD OVERWRITE created_at ON proxy_token TYPE datetime DEFAULT time::now();
-- Revocation flag
DEFINE FIELD OVERWRITE revoked ON proxy_token TYPE bool DEFAULT false;

-- Unique constraint: each token hash must be globally unique
DEFINE INDEX OVERWRITE idx_proxy_token_hash ON proxy_token FIELDS token_hash UNIQUE;
-- Composite index: lookup tokens by identity + workspace
DEFINE INDEX OVERWRITE idx_proxy_token_identity_workspace ON proxy_token FIELDS identity, workspace;

COMMIT TRANSACTION;

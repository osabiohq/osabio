-- Migration 0043: Proxy policy enforcement fields
-- Adds daily_budget_usd to workspace for budget enforcement
-- Adds policy_decision to trace for audit trail
-- Adds governed_by relation for trace->policy edges

BEGIN TRANSACTION;

-- Workspace daily budget for proxy cost enforcement
DEFINE FIELD OVERWRITE daily_budget_usd ON workspace TYPE option<float>;

-- Policy decision audit field on trace (records pass/fail + policy ref)
DEFINE FIELD OVERWRITE policy_decision ON trace TYPE option<object> FLEXIBLE;

COMMIT TRANSACTION;

-- governed_by relation: trace -> policy (outside transaction due to DEFINE TABLE)
DEFINE TABLE OVERWRITE governed_by TYPE RELATION IN trace OUT policy SCHEMAFULL;
DEFINE FIELD OVERWRITE created_at ON governed_by TYPE datetime;
DEFINE FIELD OVERWRITE decision ON governed_by TYPE string ASSERT $value IN ['pass', 'deny'];

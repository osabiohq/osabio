-- 0017_identity_hub_spoke.surql
-- US-UI-001: Identity hub-spoke schema
-- Creates identity hub, agent spoke, identity_person and identity_agent relation tables.
-- Removes person.identities field (redundant with account table).

BEGIN TRANSACTION;

-- Identity hub table
DEFINE TABLE OVERWRITE identity SCHEMAFULL;
DEFINE FIELD OVERWRITE name ON identity TYPE string;
DEFINE FIELD OVERWRITE type ON identity TYPE string ASSERT $value IN ['human', 'agent', 'system'];
DEFINE FIELD OVERWRITE role ON identity TYPE option<string>;
DEFINE FIELD OVERWRITE workspace ON identity TYPE record<workspace>;
DEFINE FIELD OVERWRITE created_at ON identity TYPE datetime;

-- B-tree indexes for identity lookup
DEFINE INDEX OVERWRITE identity_workspace ON identity FIELDS workspace;
DEFINE INDEX OVERWRITE identity_type_workspace ON identity FIELDS type, workspace;

-- Agent spoke table
DEFINE TABLE OVERWRITE agent SCHEMAFULL;
DEFINE FIELD OVERWRITE agent_type ON agent TYPE string ASSERT $value IN ['code_agent', 'architect', 'management', 'design_partner', 'observer', 'chat_agent', 'mcp'];
DEFINE FIELD OVERWRITE model ON agent TYPE option<string>;
DEFINE FIELD OVERWRITE managed_by ON agent TYPE record<identity>;
DEFINE FIELD OVERWRITE created_at ON agent TYPE datetime;

-- Spoke edge: identity -> person
DEFINE TABLE OVERWRITE identity_person TYPE RELATION IN identity OUT person SCHEMAFULL;
DEFINE FIELD OVERWRITE added_at ON identity_person TYPE datetime;

-- Spoke edge: identity -> agent
DEFINE TABLE OVERWRITE identity_agent TYPE RELATION IN identity OUT agent SCHEMAFULL;
DEFINE FIELD OVERWRITE added_at ON identity_agent TYPE datetime;

-- Remove person.identities field (redundant with account table)
REMOVE FIELD IF EXISTS identities ON person;
REMOVE FIELD IF EXISTS identities[*].provider ON person;
REMOVE FIELD IF EXISTS identities[*].id ON person;

COMMIT TRANSACTION;

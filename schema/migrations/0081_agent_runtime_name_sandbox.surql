-- Define name (replaces agent_type)
DEFINE FIELD OVERWRITE name ON agent TYPE string;

-- Define runtime with assertion
DEFINE FIELD OVERWRITE runtime ON agent TYPE string
  ASSERT $value IN ['osabio', 'sandbox', 'external'];

-- Remove agent_type from agent table (replaced by name + runtime)
REMOVE FIELD IF EXISTS agent_type ON agent;

-- Add sandbox_config for sandbox agents
DEFINE FIELD OVERWRITE sandbox_config ON agent TYPE option<object>;
DEFINE FIELD OVERWRITE sandbox_config.coding_agents ON agent TYPE option<array<string>>;
DEFINE FIELD OVERWRITE sandbox_config.env_vars ON agent TYPE option<array<object>>;
DEFINE FIELD OVERWRITE sandbox_config.env_vars[*].key ON agent TYPE string;
DEFINE FIELD OVERWRITE sandbox_config.env_vars[*].value ON agent TYPE string;
DEFINE FIELD OVERWRITE sandbox_config.image ON agent TYPE option<string>;
DEFINE FIELD OVERWRITE sandbox_config.snapshot ON agent TYPE option<string>;
DEFINE FIELD OVERWRITE sandbox_config.model ON agent TYPE option<string>;

-- Remove agent_type from authority_scope
DELETE FROM authority_scope;
REMOVE FIELD IF EXISTS agent_type ON authority_scope;

-- Update index to exclude agent_type
DEFINE INDEX OVERWRITE authority_scope_lookup ON authority_scope
  FIELDS action, workspace;

-- Re-seed: one authority_scope per action with default permission
CREATE authority_scope CONTENT { action: "create_decision", permission: "provisional", created_at: time::now() };
CREATE authority_scope CONTENT { action: "confirm_decision", permission: "blocked", created_at: time::now() };
CREATE authority_scope CONTENT { action: "create_task", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "complete_task", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "create_observation", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "acknowledge_observation", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "resolve_observation", permission: "blocked", created_at: time::now() };
CREATE authority_scope CONTENT { action: "create_question", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "create_suggestion", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "create_intent", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "submit_intent", permission: "auto", created_at: time::now() };

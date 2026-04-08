-- Migration 0065: MCP Tool Registry
-- Creates tables for tool definitions, authorization, credentials, and governance.

BEGIN TRANSACTION;

-- ---------------------------------------------------------------------------
-- mcp_tool: Tool definitions registered in a workspace
-- ---------------------------------------------------------------------------
DEFINE TABLE OVERWRITE mcp_tool SCHEMAFULL;
DEFINE FIELD OVERWRITE name ON mcp_tool TYPE string;
DEFINE FIELD OVERWRITE toolkit ON mcp_tool TYPE string;
DEFINE FIELD OVERWRITE description ON mcp_tool TYPE string;
DEFINE FIELD OVERWRITE input_schema ON mcp_tool TYPE object FLEXIBLE;
DEFINE FIELD OVERWRITE output_schema ON mcp_tool TYPE option<object> FLEXIBLE;
DEFINE FIELD OVERWRITE provider ON mcp_tool TYPE option<record<credential_provider>>;
DEFINE FIELD OVERWRITE risk_level ON mcp_tool TYPE string ASSERT $value IN ["low", "medium", "high", "critical"];
DEFINE FIELD OVERWRITE workspace ON mcp_tool TYPE record<workspace>;
DEFINE FIELD OVERWRITE status ON mcp_tool TYPE string ASSERT $value IN ["active", "disabled"];
DEFINE FIELD OVERWRITE created_at ON mcp_tool TYPE datetime DEFAULT time::now();

DEFINE INDEX OVERWRITE mcp_tool_workspace ON mcp_tool FIELDS workspace;
DEFINE INDEX OVERWRITE mcp_tool_workspace_name ON mcp_tool FIELDS workspace, name;
DEFINE INDEX OVERWRITE mcp_tool_workspace_toolkit ON mcp_tool FIELDS workspace, toolkit;
DEFINE INDEX OVERWRITE mcp_tool_workspace_status ON mcp_tool FIELDS workspace, status;

-- ---------------------------------------------------------------------------
-- can_use: Authorization edge from identity to mcp_tool
-- ---------------------------------------------------------------------------
DEFINE TABLE OVERWRITE can_use TYPE RELATION IN identity OUT mcp_tool SCHEMAFULL;
DEFINE FIELD OVERWRITE granted_at ON can_use TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE max_calls_per_hour ON can_use TYPE option<int>;
DEFINE INDEX OVERWRITE can_use_identity ON can_use FIELDS in;
DEFINE INDEX OVERWRITE can_use_tool ON can_use FIELDS out;

-- ---------------------------------------------------------------------------
-- credential_provider: External service credential configuration
-- ---------------------------------------------------------------------------
DEFINE TABLE OVERWRITE credential_provider SCHEMAFULL;
DEFINE FIELD OVERWRITE name ON credential_provider TYPE string;
DEFINE FIELD OVERWRITE display_name ON credential_provider TYPE string;
DEFINE FIELD OVERWRITE auth_method ON credential_provider TYPE string ASSERT $value IN ["oauth2", "api_key", "bearer", "basic"];
DEFINE FIELD OVERWRITE workspace ON credential_provider TYPE record<workspace>;
DEFINE FIELD OVERWRITE authorization_url ON credential_provider TYPE option<string>;
DEFINE FIELD OVERWRITE token_url ON credential_provider TYPE option<string>;
DEFINE FIELD OVERWRITE client_id ON credential_provider TYPE option<string>;
DEFINE FIELD OVERWRITE client_secret_encrypted ON credential_provider TYPE option<string>;
DEFINE FIELD OVERWRITE scopes ON credential_provider TYPE option<array<string>>;
DEFINE FIELD OVERWRITE api_key_header ON credential_provider TYPE option<string>;
DEFINE FIELD OVERWRITE created_at ON credential_provider TYPE datetime DEFAULT time::now();

DEFINE INDEX OVERWRITE credential_provider_workspace ON credential_provider FIELDS workspace;
DEFINE INDEX OVERWRITE credential_provider_workspace_name ON credential_provider FIELDS workspace, name;

-- ---------------------------------------------------------------------------
-- connected_account: Identity's connected credentials for a provider
-- ---------------------------------------------------------------------------
DEFINE TABLE OVERWRITE connected_account SCHEMAFULL;
DEFINE FIELD OVERWRITE identity ON connected_account TYPE record<identity>;
DEFINE FIELD OVERWRITE provider ON connected_account TYPE record<credential_provider>;
DEFINE FIELD OVERWRITE workspace ON connected_account TYPE record<workspace>;
DEFINE FIELD OVERWRITE status ON connected_account TYPE string ASSERT $value IN ["active", "revoked", "expired"];
DEFINE FIELD OVERWRITE access_token_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD OVERWRITE refresh_token_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD OVERWRITE token_expires_at ON connected_account TYPE option<datetime>;
DEFINE FIELD OVERWRITE api_key_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD OVERWRITE basic_username ON connected_account TYPE option<string>;
DEFINE FIELD OVERWRITE basic_password_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD OVERWRITE bearer_token_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD OVERWRITE scopes ON connected_account TYPE option<array<string>>;
DEFINE FIELD OVERWRITE connected_at ON connected_account TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE updated_at ON connected_account TYPE datetime DEFAULT time::now();

DEFINE INDEX OVERWRITE connected_account_identity_provider ON connected_account FIELDS identity, provider;
DEFINE INDEX OVERWRITE connected_account_workspace ON connected_account FIELDS workspace;
DEFINE INDEX OVERWRITE connected_account_identity ON connected_account FIELDS identity;

-- ---------------------------------------------------------------------------
-- governs_tool: Policy governance edge from policy to mcp_tool
-- ---------------------------------------------------------------------------
DEFINE TABLE OVERWRITE governs_tool TYPE RELATION IN policy OUT mcp_tool SCHEMAFULL;
DEFINE FIELD OVERWRITE conditions ON governs_tool TYPE option<string>;
DEFINE FIELD OVERWRITE max_per_call ON governs_tool TYPE option<int>;
DEFINE FIELD OVERWRITE max_per_day ON governs_tool TYPE option<int>;
DEFINE INDEX OVERWRITE governs_tool_policy ON governs_tool FIELDS in;
DEFINE INDEX OVERWRITE governs_tool_tool ON governs_tool FIELDS out;

COMMIT TRANSACTION;

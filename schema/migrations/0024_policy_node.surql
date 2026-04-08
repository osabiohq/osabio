BEGIN TRANSACTION;

-- Policy table: governance rules for intent authorization
DEFINE TABLE OVERWRITE policy SCHEMAFULL;
DEFINE FIELD OVERWRITE title ON policy TYPE string;
DEFINE FIELD OVERWRITE description ON policy TYPE option<string>;
DEFINE FIELD OVERWRITE version ON policy TYPE int ASSERT $value > 0;
DEFINE FIELD OVERWRITE status ON policy TYPE string
  ASSERT $value IN ['active', 'draft', 'deprecated', 'testing', 'superseded'];
DEFINE FIELD OVERWRITE selector ON policy TYPE object;
DEFINE FIELD OVERWRITE selector.workspace ON policy TYPE option<string>;
DEFINE FIELD OVERWRITE selector.agent_role ON policy TYPE option<string>;
DEFINE FIELD OVERWRITE selector.resource ON policy TYPE option<string>;
DEFINE FIELD OVERWRITE rules ON policy TYPE array<object>;
DEFINE FIELD OVERWRITE rules[*].id ON policy TYPE string;
DEFINE FIELD OVERWRITE rules[*].condition ON policy TYPE object | array FLEXIBLE;
DEFINE FIELD OVERWRITE rules[*].condition[*].field ON policy TYPE option<string>;
DEFINE FIELD OVERWRITE rules[*].condition[*].operator ON policy TYPE option<string>;
DEFINE FIELD OVERWRITE rules[*].effect ON policy TYPE string ASSERT $value IN ['allow', 'deny'];
DEFINE FIELD OVERWRITE rules[*].priority ON policy TYPE int;
DEFINE FIELD OVERWRITE human_veto_required ON policy TYPE bool DEFAULT false;
DEFINE FIELD OVERWRITE max_ttl ON policy TYPE option<string>;
DEFINE FIELD OVERWRITE created_by ON policy TYPE record<identity>;
DEFINE FIELD OVERWRITE workspace ON policy TYPE record<workspace>;
DEFINE FIELD OVERWRITE supersedes ON policy TYPE option<record<policy>>;
DEFINE FIELD OVERWRITE created_at ON policy TYPE datetime;
DEFINE FIELD OVERWRITE updated_at ON policy TYPE option<datetime>;
DEFINE INDEX OVERWRITE policy_status ON policy FIELDS status;
DEFINE INDEX OVERWRITE policy_workspace ON policy FIELDS workspace;
DEFINE INDEX OVERWRITE policy_workspace_status ON policy FIELDS workspace, status;

-- Graph relation: identity -governing-> policy
DEFINE TABLE OVERWRITE governing TYPE RELATION IN identity OUT policy SCHEMAFULL;
DEFINE FIELD OVERWRITE created_at ON governing TYPE datetime;
DEFINE INDEX OVERWRITE governing_out ON governing FIELDS out;

-- Graph relation: policy -protects-> workspace
DEFINE TABLE OVERWRITE protects TYPE RELATION IN policy OUT workspace SCHEMAFULL;
DEFINE FIELD OVERWRITE created_at ON protects TYPE datetime;
DEFINE INDEX OVERWRITE protects_in ON protects FIELDS in;

-- Extend intent.evaluation with policy_trace fields
DEFINE FIELD OVERWRITE evaluation.policy_trace ON intent TYPE option<array<object>>;
DEFINE FIELD OVERWRITE evaluation.policy_trace[*].policy_id ON intent TYPE string;
DEFINE FIELD OVERWRITE evaluation.policy_trace[*].policy_version ON intent TYPE int;
DEFINE FIELD OVERWRITE evaluation.policy_trace[*].rule_id ON intent TYPE string;
DEFINE FIELD OVERWRITE evaluation.policy_trace[*].effect ON intent TYPE string ASSERT $value IN ['allow', 'deny'];
DEFINE FIELD OVERWRITE evaluation.policy_trace[*].matched ON intent TYPE bool;
DEFINE FIELD OVERWRITE evaluation.policy_trace[*].priority ON intent TYPE int;
DEFINE FIELD OVERWRITE evaluation.human_veto_required ON intent TYPE option<bool>;

-- Extend audit_event event_type with policy lifecycle events
DEFINE FIELD OVERWRITE event_type ON audit_event TYPE string
  ASSERT $value IN [
    "intent_submitted", "intent_evaluated", "intent_routed",
    "consent_approved", "consent_constrained", "consent_vetoed",
    "token_issued", "token_rejected",
    "dpop_verified", "dpop_rejected",
    "security_alert",
    "policy_created", "policy_activated", "policy_updated", "policy_deprecated"
  ];

COMMIT TRANSACTION;

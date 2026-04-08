BEGIN TRANSACTION;

-- Replace predicate-based rules array with rego_source string field on policy table.
-- This is a breaking schema change (no backward compatibility).

-- Remove nested rules fields first (must remove children before parent in SurrealDB)
REMOVE FIELD IF EXISTS rules[*].condition[*].field ON policy;
REMOVE FIELD IF EXISTS rules[*].condition[*].operator ON policy;
REMOVE FIELD IF EXISTS rules[*].condition ON policy;
REMOVE FIELD IF EXISTS rules[*].min_evidence_count ON policy;
REMOVE FIELD IF EXISTS rules[*].required_types ON policy;
REMOVE FIELD IF EXISTS rules[*].priority ON policy;
REMOVE FIELD IF EXISTS rules[*].effect ON policy;
REMOVE FIELD IF EXISTS rules[*].id ON policy;
REMOVE FIELD IF EXISTS rules ON policy;

-- Add rego_source as a required string field
DEFINE FIELD OVERWRITE rego_source ON policy TYPE string;

-- Remove old rules data from existing records
UPDATE policy UNSET rules;

COMMIT TRANSACTION;

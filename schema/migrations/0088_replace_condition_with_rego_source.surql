BEGIN TRANSACTION;

-- Replace predicate-based rules array with rego_source string field on policy table.
-- This is a breaking schema change (no backward compatibility).

-- Remove nested rules fields first (must remove children before parent in SurrealDB)
REMOVE FIELD rules[*].condition[*].field ON policy;
REMOVE FIELD rules[*].condition[*].operator ON policy;
REMOVE FIELD rules[*].condition ON policy;
REMOVE FIELD rules[*].min_evidence_count ON policy;
REMOVE FIELD rules[*].required_types ON policy;
REMOVE FIELD rules[*].priority ON policy;
REMOVE FIELD rules[*].effect ON policy;
REMOVE FIELD rules[*].id ON policy;
REMOVE FIELD rules ON policy;

-- Add rego_source as a required string field
DEFINE FIELD OVERWRITE rego_source ON policy TYPE string;

-- Remove old rules data from existing records
UPDATE policy UNSET rules;

COMMIT TRANSACTION;

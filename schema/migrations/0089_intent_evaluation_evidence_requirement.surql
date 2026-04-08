BEGIN TRANSACTION;

-- Add evidence_requirement field to intent.evaluation for Rego policy output
DEFINE FIELD OVERWRITE evaluation.evidence_requirement ON intent TYPE option<object>;
DEFINE FIELD OVERWRITE evaluation.evidence_requirement.min_count ON intent TYPE option<int>;
DEFINE FIELD OVERWRITE evaluation.evidence_requirement.required_types ON intent TYPE option<array<string>>;

COMMIT TRANSACTION;

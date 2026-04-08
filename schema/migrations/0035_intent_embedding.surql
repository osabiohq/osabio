-- Add embedding field to intent table for objective alignment via KNN search

BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE embedding ON intent TYPE option<array<float>>;
DEFINE INDEX OVERWRITE idx_intent_embedding ON intent FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

COMMIT TRANSACTION;

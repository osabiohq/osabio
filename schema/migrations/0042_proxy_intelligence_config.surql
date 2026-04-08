-- Migration 0042: Create proxy_intelligence_config table
-- Step: 01-01 (LLM proxy schema migrations)
--
-- Workspace-scoped settings for LLM proxy intelligence features:
-- context injection and contradiction detection.

BEGIN TRANSACTION;

DEFINE TABLE OVERWRITE proxy_intelligence_config SCHEMAFULL;

DEFINE FIELD OVERWRITE workspace ON proxy_intelligence_config TYPE record<workspace>;
DEFINE FIELD OVERWRITE context_injection_enabled ON proxy_intelligence_config TYPE bool;
DEFINE FIELD OVERWRITE context_injection_token_budget ON proxy_intelligence_config TYPE int;
DEFINE FIELD OVERWRITE context_injection_cache_ttl_seconds ON proxy_intelligence_config TYPE int;
DEFINE FIELD OVERWRITE context_injection_tier ON proxy_intelligence_config TYPE string
  ASSERT $value IN ["fast", "secure"];
DEFINE FIELD OVERWRITE contradiction_detection_enabled ON proxy_intelligence_config TYPE bool;
DEFINE FIELD OVERWRITE contradiction_tier1_threshold ON proxy_intelligence_config TYPE float;
DEFINE FIELD OVERWRITE contradiction_tier2_confidence_min ON proxy_intelligence_config TYPE float;
DEFINE FIELD OVERWRITE created_at ON proxy_intelligence_config TYPE datetime;
DEFINE FIELD OVERWRITE updated_at ON proxy_intelligence_config TYPE datetime;

DEFINE INDEX OVERWRITE proxy_intelligence_config_workspace ON proxy_intelligence_config FIELDS workspace UNIQUE;

COMMIT TRANSACTION;

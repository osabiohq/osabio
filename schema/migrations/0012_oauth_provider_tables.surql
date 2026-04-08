-- Remove API key field from workspace (clean cut to OAuth)
-- REMOVE FIELD IF EXISTS cannot run inside a transaction in SurrealDB v3.0
REMOVE FIELD IF EXISTS api_key_hash ON workspace;

BEGIN TRANSACTION;

-- OAuth Client (registered agents / CLI tools)
DEFINE TABLE OVERWRITE oauthClient SCHEMAFULL;
DEFINE FIELD OVERWRITE clientId ON oauthClient TYPE string;
DEFINE FIELD OVERWRITE clientSecret ON oauthClient TYPE option<string>;
DEFINE FIELD OVERWRITE disabled ON oauthClient TYPE option<bool> DEFAULT false;
DEFINE FIELD OVERWRITE skipConsent ON oauthClient TYPE option<bool>;
DEFINE FIELD OVERWRITE enableEndSession ON oauthClient TYPE option<bool>;
DEFINE FIELD OVERWRITE scopes ON oauthClient TYPE option<string>;
DEFINE FIELD OVERWRITE userId ON oauthClient TYPE option<record<person>>;
DEFINE FIELD OVERWRITE referenceId ON oauthClient TYPE option<string>;
DEFINE FIELD OVERWRITE createdAt ON oauthClient TYPE option<datetime>;
DEFINE FIELD OVERWRITE updatedAt ON oauthClient TYPE option<datetime>;
DEFINE FIELD OVERWRITE expiresAt ON oauthClient TYPE option<datetime>;
DEFINE FIELD OVERWRITE name ON oauthClient TYPE option<string>;
DEFINE FIELD OVERWRITE uri ON oauthClient TYPE option<string>;
DEFINE FIELD OVERWRITE icon ON oauthClient TYPE option<string>;
DEFINE FIELD OVERWRITE contacts ON oauthClient TYPE option<string>;
DEFINE FIELD OVERWRITE tos ON oauthClient TYPE option<string>;
DEFINE FIELD OVERWRITE policy ON oauthClient TYPE option<string>;
DEFINE FIELD OVERWRITE softwareId ON oauthClient TYPE option<string>;
DEFINE FIELD OVERWRITE softwareVersion ON oauthClient TYPE option<string>;
DEFINE FIELD OVERWRITE softwareStatement ON oauthClient TYPE option<string>;
DEFINE FIELD OVERWRITE redirectUris ON oauthClient TYPE string;
DEFINE FIELD OVERWRITE postLogoutRedirectUris ON oauthClient TYPE option<string>;
DEFINE FIELD OVERWRITE tokenEndpointAuthMethod ON oauthClient TYPE option<string>;
DEFINE FIELD OVERWRITE grantTypes ON oauthClient TYPE option<string>;
DEFINE FIELD OVERWRITE responseTypes ON oauthClient TYPE option<string>;
DEFINE FIELD OVERWRITE public ON oauthClient TYPE option<bool>;
DEFINE FIELD OVERWRITE requirePKCE ON oauthClient TYPE option<bool>;
DEFINE FIELD OVERWRITE metadata ON oauthClient TYPE option<string>;
DEFINE INDEX OVERWRITE oauthClient_clientId ON oauthClient FIELDS clientId UNIQUE;
DEFINE INDEX OVERWRITE oauthClient_userId ON oauthClient FIELDS userId;

-- OAuth Access Token (for revocation tracking and introspection)
DEFINE TABLE OVERWRITE oauthAccessToken SCHEMAFULL;
DEFINE FIELD OVERWRITE token ON oauthAccessToken TYPE string;
DEFINE FIELD OVERWRITE clientId ON oauthAccessToken TYPE string;
DEFINE FIELD OVERWRITE sessionId ON oauthAccessToken TYPE option<record<session>>;
DEFINE FIELD OVERWRITE userId ON oauthAccessToken TYPE option<record<person>>;
DEFINE FIELD OVERWRITE referenceId ON oauthAccessToken TYPE option<string>;
DEFINE FIELD OVERWRITE refreshId ON oauthAccessToken TYPE option<record<oauthRefreshToken>>;
DEFINE FIELD OVERWRITE scopes ON oauthAccessToken TYPE string;
DEFINE FIELD OVERWRITE expiresAt ON oauthAccessToken TYPE datetime;
DEFINE FIELD OVERWRITE createdAt ON oauthAccessToken TYPE datetime;
DEFINE INDEX OVERWRITE oauthAccessToken_token ON oauthAccessToken FIELDS token UNIQUE;
DEFINE INDEX OVERWRITE oauthAccessToken_clientId ON oauthAccessToken FIELDS clientId;

-- OAuth Refresh Token
DEFINE TABLE OVERWRITE oauthRefreshToken SCHEMAFULL;
DEFINE FIELD OVERWRITE token ON oauthRefreshToken TYPE string;
DEFINE FIELD OVERWRITE clientId ON oauthRefreshToken TYPE string;
DEFINE FIELD OVERWRITE sessionId ON oauthRefreshToken TYPE option<record<session>>;
DEFINE FIELD OVERWRITE userId ON oauthRefreshToken TYPE option<record<person>>;
DEFINE FIELD OVERWRITE referenceId ON oauthRefreshToken TYPE option<string>;
DEFINE FIELD OVERWRITE scopes ON oauthRefreshToken TYPE string;
DEFINE FIELD OVERWRITE revoked ON oauthRefreshToken TYPE option<datetime>;
DEFINE FIELD OVERWRITE authTime ON oauthRefreshToken TYPE option<datetime>;
DEFINE FIELD OVERWRITE createdAt ON oauthRefreshToken TYPE datetime;
DEFINE FIELD OVERWRITE expiresAt ON oauthRefreshToken TYPE datetime;
DEFINE INDEX OVERWRITE oauthRefreshToken_token ON oauthRefreshToken FIELDS token UNIQUE;
DEFINE INDEX OVERWRITE oauthRefreshToken_clientId ON oauthRefreshToken FIELDS clientId;

-- OAuth Consent (user approvals per client/scope)
DEFINE TABLE OVERWRITE oauthConsent SCHEMAFULL;
DEFINE FIELD OVERWRITE clientId ON oauthConsent TYPE string;
DEFINE FIELD OVERWRITE userId ON oauthConsent TYPE option<record<person>>;
DEFINE FIELD OVERWRITE referenceId ON oauthConsent TYPE option<string>;
DEFINE FIELD OVERWRITE scopes ON oauthConsent TYPE string;
DEFINE FIELD OVERWRITE createdAt ON oauthConsent TYPE datetime;
DEFINE FIELD OVERWRITE updatedAt ON oauthConsent TYPE datetime;
DEFINE INDEX OVERWRITE oauthConsent_clientId_userId ON oauthConsent FIELDS clientId, userId;

-- JWKS (JWT signing keys)
DEFINE TABLE OVERWRITE jwks SCHEMAFULL;
DEFINE FIELD OVERWRITE publicKey ON jwks TYPE string;
DEFINE FIELD OVERWRITE privateKey ON jwks TYPE string;
DEFINE FIELD OVERWRITE createdAt ON jwks TYPE datetime;
DEFINE FIELD OVERWRITE expiresAt ON jwks TYPE option<datetime>;

COMMIT TRANSACTION;

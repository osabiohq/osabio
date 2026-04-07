# DESIGN Decisions — regorus-policy-eval

## Key Decisions
- [D1] Git submodule + vendored WASM build output: Regorus has no npm package; submodule at `vendor/regorus-src/` tracks upstream version, pre-built WASM at `vendor/regorus-wasm/` keeps CI Rust-free (see: ADR-088)
- [D2] Engine-per-policy caching with global `Map<string, Engine>`: simple, adequate for < 50 active policies, no LRU needed (see: architecture-design.md)
- [D3] Interpreter mode (`Engine` class), not compiled `Program` mode: simpler API, sufficient for governance policy complexity (see: architecture-design.md)
- [D4] Required package convention `package osabio.policy`: enforced at compilation validation, queries `data.osabio.policy.allow/deny/evidence_requirement` (see: data-models.md)
- [D5] Evidence requirements via Rego output field, not separate metadata: Rego policies can output `evidence_requirement` object, mapped to existing `PolicyEvidenceRequirements` type (see: data-models.md)
- [D6] No `data` document beyond `input`: keep evaluation hermetic, extend `IntentEvaluationContext` if future policies need more context (see: architecture-design.md)
- [D7] Policy-level evaluation replaces rule-level: one Rego source per policy, one trace entry per policy (see: component-boundaries.md)

## Architecture Summary
- Pattern: modular monolith with pure-core / effect-shell (existing pattern preserved)
- Paradigm: functional (already set in CLAUDE.md)
- Key components: `rego-evaluator.ts` (WASM loader + cache + evaluator), `rego-validation.ts` (compile check), `RegoEditor.tsx` (UI), `PolicyTestPanel.tsx` (UI)

## Technology Stack
- Regorus WASM (vendored): Rego evaluation engine, built from Rust source
- No new npm dependencies
- Existing stack unchanged (Bun, SurrealDB, React)

## Constraints Established
- Regorus version upgrades require Rust toolchain + wasm-pack (one-time build)
- All Rego policies must declare `package osabio.policy`
- WASM module loaded lazily on first evaluation (not at server startup)
- Engine cache is process-global, keyed by `${policyId}:${version}`

## Upstream Changes
- DISCUSS wave-decisions D6 said "no backward compatibility" — confirmed, no changes needed
- DISCUSS requirements FR-2 said "replace condition with rego_source" — design adds `evidence_requirement` as Rego output (extends FR-3, compatible with existing `PolicyEvidenceRequirements` type)
- Story map walking skeleton step 0.1 ("load Regorus WASM") now includes vendoring step as prerequisite

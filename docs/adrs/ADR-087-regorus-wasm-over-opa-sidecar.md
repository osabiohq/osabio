# ADR-087: Regorus WASM over OPA Sidecar for Policy Evaluation

## Status

Proposed

## Context

The current policy engine uses a hand-rolled predicate evaluator supporting 9 operators (`eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `in`, `not_in`, `exists`) with dot-path field resolution and AND-array conditions. This cannot express set operations, aggregations, cross-field comparisons, or policy composition — workspace admins must request developer involvement for complex governance rules.

We need a policy evaluation engine that:
- Evaluates Rego policies (industry-standard policy language)
- Runs in-process (no network hop, no sidecar management)
- Supports dynamic policy loading (policies stored in SurrealDB, changed at runtime)
- Is sub-millisecond for typical governance rules

## Decision

Use **Regorus** (Microsoft's Rust OPA implementation) compiled to WASM, vendored into the repository. Use the **Engine** class in interpreter mode.

## Alternatives Considered

### A: Enhance predicate evaluator
Add more operators (set operations, aggregations). Rejected: leads to operator explosion. Each capability = new operator + validation + UI control. Becomes a poorly-designed DSL that still can't match Rego's expressiveness.

### B: CEL (Common Expression Language)
Google's expression language used in Kubernetes. Lighter than Rego but no policy composition, no test framework, still needs WASM binding. Rejected: less expressive, smaller ecosystem.

### C: `@open-policy-agent/opa-wasm` (npm)
Published npm package (~28K weekly downloads). Requires **pre-compiling** each policy to a `.wasm` bundle via `opa build` CLI before evaluation. Rejected: can't dynamically evaluate Rego source from SurrealDB without an `opa` binary in the runtime environment.

### D: OPA sidecar
Run OPA as a separate process. Rejected: network hop latency, operational complexity, failure mode (OPA down = all intents blocked or bypassed).

## Consequences

### Positive
- Full Rego expressiveness (150+ builtins, set operations, comprehensions, custom functions)
- In-process evaluation, sub-millisecond latency
- WASM sandbox — no access to filesystem/network/process from policy code
- No runtime dependency on Rust toolchain or OPA binary
- Compatible with OPA ecosystem tooling (VS Code extension, `opa test`, `conftest`)

### Negative
- Vendored WASM binary (~2MB) committed to repository
- Rust toolchain required for one-time build (or when upgrading Regorus version)
- No npm auto-updates — version upgrades are manual (clone, build, vendor)
- Workspace admins must learn Rego syntax (mitigated by editor with field suggestions and validation)

### Neutral
- Engine-per-policy caching with `Map<string, Engine>` — simple, adequate for < 50 active policies
- Interpreter mode (not compiled `Program` mode) — simpler, sufficient for governance policy complexity

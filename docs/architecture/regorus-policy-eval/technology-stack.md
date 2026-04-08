# Technology Stack: Regorus Policy Evaluation Engine

## New Dependencies

| Dependency | Version | Purpose | Distribution |
|---|---|---|---|
| Regorus WASM | Latest release | OPA/Rego policy evaluation engine | Git submodule (`vendor/regorus-src/`) + vendored build output (`vendor/regorus-wasm/`) |

## Build Toolchain (one-time, for vendoring)

| Tool | Purpose |
|---|---|
| Rust toolchain | Required to compile Regorus from source |
| `wasm-pack` | Builds Rust → WASM + JS glue + TypeScript types |

These are NOT runtime dependencies. They're used once to produce the vendored WASM artifacts, then not needed again until a Regorus version upgrade.

## Existing Stack (unchanged)

| Layer | Technology | Role in this feature |
|---|---|---|
| Runtime | Bun | Loads WASM module, runs evaluation |
| Database | SurrealDB | Stores `rego_source` on policy records |
| Backend | TypeScript | `RegoEvaluator`, policy gate pipeline |
| Frontend | React | Rego editor component, test panel |
| Auth | DPoP + Better Auth | Policy route authentication (unchanged) |

## Why submodule + vendored build output

Regorus has no published npm package. The project explicitly does not publish to registries. We combine a git submodule (source tracking) with vendored build output (zero-Rust CI):

- `vendor/regorus-src/` — submodule pinned to a Regorus commit. Tracks exact upstream version. Never initialized in CI.
- `vendor/regorus-wasm/` — pre-built WASM + JS glue + TypeScript types. What the code actually imports.

Benefits:
- Eliminates Rust toolchain as a runtime or CI dependency
- Exact upstream version tracked via submodule commit ref
- Simple upgrade: checkout new tag in submodule, rebuild, commit both
- `git submodule status` shows which Regorus version is in use

## Alternative considered: `@open-policy-agent/opa-wasm`

Published on npm (~28K weekly downloads), but requires **pre-compiling** each policy to a `.wasm` bundle via the `opa build` CLI before evaluation. This means:
- Every policy create/update requires running the `opa` CLI
- The `opa` binary becomes a runtime dependency
- Can't dynamically evaluate Rego source stored in the database without a compilation step

Regorus's interpreter mode (`Engine.addPolicy()` with raw Rego text) is the right fit for dynamic policy loading from SurrealDB.

## WASM Loading in Bun

Bun supports WebAssembly via the standard `WebAssembly` API and the wasm-bindgen JS glue. The vendored `regorusjs.js` uses `require()` to load the `.wasm` file — this works in Bun's Node.js compatibility layer.

If Bun's `require()` path doesn't work for `.wasm` files (walking skeleton spike), the fallback is `WebAssembly.instantiate(await Bun.file("path.wasm").arrayBuffer())` with manual initialization.

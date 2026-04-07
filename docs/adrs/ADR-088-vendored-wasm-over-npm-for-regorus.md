# ADR-088: Vendored WASM with Git Submodule for Regorus Distribution

## Status

Proposed

## Context

Regorus has no published npm package. The project does not publish to registries. To use Regorus from TypeScript/Bun, we must either:
1. Build from source and vendor the WASM artifacts
2. Set up a private npm registry or GitHub Packages
3. Build from source in CI on every deploy

Additionally, we need a way to track which Regorus version the vendored artifacts were built from, and make upgrades straightforward.

## Decision

Use a **git submodule + vendored build output** approach:

- `vendor/regorus-src/` — git submodule pointing to `https://github.com/microsoft/regorus` at a pinned commit. Tracks upstream source. Never initialized in CI.
- `vendor/regorus-wasm/` — pre-built WASM artifacts committed to git. Contains:
  - `regorusjs_bg.wasm` (~2MB compiled WASM binary)
  - `regorusjs.js` (JS glue code from wasm-bindgen)
  - `regorusjs.d.ts` (TypeScript type definitions)

Build and upgrade workflow:
```bash
# Initial setup (one-time)
git submodule add https://github.com/microsoft/regorus vendor/regorus-src

# Build WASM
cd vendor/regorus-src/bindings/wasm
wasm-pack build --target nodejs --release
cp -r pkg/* ../../regorus-wasm/

# Upgrade
cd vendor/regorus-src
git fetch && git checkout v0.X.Y
cd bindings/wasm && wasm-pack build --target nodejs --release
cp -r pkg/* ../../regorus-wasm/
# Commit both submodule ref + rebuilt artifacts
```

CI and `bun install` never touch the submodule — they only see the pre-built `vendor/regorus-wasm/` directory.

## Alternatives Considered

### Vendored build only (no submodule)
Commit built artifacts without tracking source version. Rejected: no way to know which Regorus commit the WASM was built from. Upgrades require manual version tracking.

### Private npm registry
Publish to GitHub Packages or Verdaccio. Rejected: adds infrastructure to maintain, authentication complexity in CI, overhead for a single vendored package.

### Build from source in CI
Add Rust toolchain to CI/CD. Rejected: increases CI time (~5 min Rust build), adds Rust as a CI dependency, fragile if Regorus build changes.

### Git submodule + build on install
Add Regorus as a submodule, build during `bun install`. Rejected: every developer and CI run needs Rust toolchain.

## Consequences

### Positive
- Zero runtime dependencies (WASM binary is self-contained)
- No Rust toolchain in CI/CD
- Exact upstream version tracked via submodule commit ref
- Simple upgrade: `git checkout` new tag in submodule, rebuild, commit both
- Simple import: `import { Engine } from "../../vendor/regorus-wasm/regorusjs"`

### Negative
- ~2MB binary committed to git (acceptable for a WASM module)
- Build requires Rust toolchain + wasm-pack (developer machine only, documented)
- Two directories to maintain (`regorus-src` submodule + `regorus-wasm` build output)

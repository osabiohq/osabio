# Research: Regorus WASM/JavaScript Integration

**Date**: 2026-04-07 | **Researcher**: nw-researcher (Nova) | **Confidence**: High | **Sources**: 7

## Executive Summary

Regorus (Microsoft's Rust-based OPA/Rego interpreter) has mature WASM bindings but **no published npm package**. The project explicitly states they "don't publish these bindings to various repositories" to avoid operational overhead, requiring consumers to build from source using `wasm-pack`. The build process is straightforward: install wasm-pack, run `wasm-pack build --target nodejs --release` (or the convenience `cargo xtask build-wasm`), and require the generated `pkg/` directory.

The key architectural advantage of Regorus over `@open-policy-agent/opa-wasm` is that Regorus is a **full Rego interpreter** -- it evaluates `.rego` policy files directly at runtime. OPA-WASM requires a separate **pre-compilation step** (`opa build -t wasm`) to convert Rego to WASM bundles before they can be evaluated. This makes Regorus significantly more suitable for dynamic policy loading scenarios where policies are stored in a database or modified at runtime.

For a ready-to-use npm alternative, `@open-policy-agent/opa-wasm` (28K+ weekly downloads, last release v1.10.0 Nov 2024) is the only viable option, but it requires pre-compiled WASM policy bundles and cannot interpret raw Rego.

**Recommendation**: Build Regorus WASM from source. The build is well-documented and the API surface is rich (Engine, Program, and Rvm classes). For Bun compatibility, the `--target nodejs` build should work since Bun supports Node.js-compatible WASM loading via `require()`.

## Research Methodology
**Search Strategy**: Direct GitHub repository analysis (README, bindings/wasm/, source code, Cargo.toml, test.js, building.md), npm registry search, web search for alternatives
**Source Selection**: Types: official repos, npm registry, wasm-bindgen docs | Reputation: high (GitHub/Microsoft, OPA official) | Verification: cross-referencing source code with docs
**Quality Standards**: All claims verified against primary source code; 2+ sources for major architectural claims

## Findings

### Finding 1: No Published npm Package -- Build From Source Required
**Evidence**: The Regorus README states: "To avoid operational overhead, we currently don't publish these bindings to various repositories. It is straight-forward to build these bindings yourself."
**Source**: [microsoft/regorus README](https://github.com/microsoft/regorus) - Accessed 2026-04-07
**Confidence**: High
**Verification**: npm registry search for "regorusjs", "regorus-wasm", "@aspect-build/regorus" returned zero results. No package exists on npm.
**Analysis**: This is an explicit project decision, not an oversight. The Cargo.toml names the package `regorusjs` (v0.9.1) but it is only available as a build artifact.

### Finding 2: wasm-pack Build Process
**Evidence**: Build requires wasm-pack and uses the `--target nodejs` flag. Two build paths exist:
1. Direct: `cd bindings/wasm && wasm-pack build --target nodejs --release`
2. Convenience: `cargo xtask build-wasm` (invokes wasm-pack with sensible defaults)
3. Test: `cargo xtask test-wasm` (rebuilds and runs `node test.js`)
**Source**: [bindings/wasm/building.md](https://github.com/microsoft/regorus/blob/main/bindings/wasm/building.md) - Accessed 2026-04-07
**Confidence**: High
**Verification**: [bindings/wasm/README.md](https://github.com/microsoft/regorus/blob/main/bindings/wasm/README.md), [Cargo.toml](https://github.com/microsoft/regorus/blob/main/bindings/wasm/Cargo.toml)
**Analysis**: Prerequisites are `cargo install wasm-pack` and Node.js. The `--target nodejs` generates CommonJS-compatible output. For browser/bundler use, `--target web` or `--target bundler` would be needed (not documented but standard wasm-pack targets).

### Finding 3: No Pre-built WASM in GitHub Releases
**Evidence**: GitHub releases (v0.2.4 through v0.9.1) each show 2 assets, but these are the standard source archives (`.tar.gz` and `.zip`). No pre-built WASM binaries are distributed.
**Source**: [microsoft/regorus releases](https://github.com/microsoft/regorus/releases) - Accessed 2026-04-07
**Confidence**: Medium (asset details failed to load fully, but consistent with the "build it yourself" policy stated in README)
**Verification**: The README's explicit statement about not publishing bindings aligns with no pre-built distribution.

### Finding 4: JavaScript API Surface (Three-Class Architecture)
**Evidence**: The WASM bindings expose three main classes via `wasm-bindgen`:

**Engine** (interpreter mode -- evaluate Rego directly):
- `new Engine()` -- constructor
- `addPolicy(path: string, rego: string) -> string` -- add raw Rego policy text
- `addDataJson(data: string)` -- set external data (JSON string)
- `setInputJson(input: string)` -- set query input (JSON string)
- `evalQuery(query: string) -> string` -- evaluate arbitrary Rego query, returns JSON
- `evalRule(path: string) -> string` -- evaluate a specific rule path, returns JSON
- `getPackages() -> string[]` -- list loaded packages
- `getPolicies() -> string` -- get loaded policies
- `clearData()` -- clear external data
- `setRegoV0(enable: boolean)` -- toggle Rego v0 compatibility
- `setGatherPrints(b: boolean)` / `takePrints() -> string[]` -- print statement support
- `setPolicyLengthConfig(config)` -- set policy size limits (`{ maxCol, maxFileBytes, maxLines }`)

**Program** (pre-compilation mode):
- `Program.compileFromModules(data_json, modules_json, entry_points_json) -> Program` -- compile policies
- `program.serializeBinary() -> Uint8Array` -- serialize compiled program
- `Program.deserializeBinary(data: Uint8Array) -> ProgramDeserializationResult` -- load serialized
- `program.generateListing() -> string` -- output listing
- `program.generateTabularListing() -> string` -- tabular listing

**Rvm** (virtual machine for compiled programs):
- `new Rvm()` -- constructor
- `loadProgram(program: Program)` -- load compiled program
- `setDataJson(data_json: string)` -- set data
- `setInputJson(input_json: string)` -- set input
- `setExecutionMode(mode: number)` -- set mode (1 = async/await for host callbacks)
- `execute() -> string` -- execute program
- `executeEntryPoint(entry_point: string) -> string` -- execute specific entry point
- `resume(resume_json?: string) -> string` -- resume after host callback
- `getExecutionState() -> string` -- get execution state

**Optional features** (via Cargo feature flags, all enabled by default):
- Coverage: `setEnableCoverage(bool)`, `getCoverageReport()`, `getCoverageReportPretty()`, `clearCoverageData()`
- AST: `getAstAsJson() -> string`
- Cache: `setCacheConfig(config)` (e.g., `{ regex: 256, glob: 128 }`), `clearCache()`

**Source**: [bindings/wasm/src/lib.rs](https://github.com/microsoft/regorus/blob/main/bindings/wasm/src/lib.rs) - Accessed 2026-04-07
**Confidence**: High
**Verification**: [bindings/wasm/test.js](https://github.com/microsoft/regorus/blob/main/bindings/wasm/test.js) exercises the Engine, Program, and Rvm classes.

### Finding 5: Node.js Usage Example (from test.js)
**Evidence**: The test.js demonstrates the full usage pattern:
```javascript
var regorus = require('./pkg/regorusjs');

// Configure caches
regorus.setCacheConfig({ regex: 256, glob: 128 });

// Engine mode: interpret Rego directly
var engine = new regorus.Engine();
engine.addPolicy('policy.rego', regoSource);   // raw Rego text
engine.addDataJson(JSON.stringify(data));       // external data
engine.setInputJson(JSON.stringify(input));     // query input
var result = engine.evalQuery('data.example.allow');  // evaluate
console.log(JSON.parse(result));               // parse JSON result

// Program + Rvm mode: compile then execute
var program = regorus.Program.compileFromModules(
  JSON.stringify(data),
  JSON.stringify([{ path: 'policy.rego', source: regoSource }]),
  JSON.stringify(['data.example.allow'])
);
var rvm = new regorus.Rvm();
rvm.loadProgram(program);
rvm.setInputJson(JSON.stringify(input));
var result = rvm.execute();
```
**Source**: [bindings/wasm/test.js](https://github.com/microsoft/regorus/blob/main/bindings/wasm/test.js) - Accessed 2026-04-07
**Confidence**: High
**Analysis**: All data exchange is via JSON strings. The Engine class is the simplest path for dynamic policy evaluation. The Program/Rvm path is for scenarios where policies are compiled once and executed many times (performance optimization).

### Finding 6: Cargo.toml Configuration and Dependencies
**Evidence**: Package name is `regorusjs` v0.9.1, crate-type `cdylib`. Key dependencies:
- `wasm-bindgen` 0.2.100 (JS interop)
- `serde-wasm-bindgen` 0.6 (serialization bridge)
- `serde_json` 1.0.140
- `getrandom` (multiple versions with `js`/`wasm_js` features for WASM RNG support)
- Default features enable: ast, coverage, cache, and most stdlib builtins (base64, glob, graph, hex, http, jsonschema, net, regex, semver, time, uuid, urlquery, yaml)
**Source**: [bindings/wasm/Cargo.toml](https://github.com/microsoft/regorus/blob/main/bindings/wasm/Cargo.toml) - Accessed 2026-04-07
**Confidence**: High

### Finding 7: Alternative -- @open-policy-agent/opa-wasm (Ready-to-Use npm Package)
**Evidence**: The official OPA WASM SDK is published on npm as `@open-policy-agent/opa-wasm`:
- **Version**: 1.10.0 (last published Nov 8, 2024)
- **Weekly downloads**: ~28,000
- **API**: `loadPolicy(wasmBytes) -> policy`, `policy.setData(obj)`, `policy.evaluate(input) -> resultSet`
- **Critical limitation**: Requires **pre-compiled WASM bundles** produced by `opa build -t wasm -e entrypoint policy.rego`. It is NOT a Rego interpreter -- it only executes pre-compiled policy WASM.
- **Formats**: CommonJS, ESM (Node), ESM (browser), browser script tag
**Source**: [npm: @open-policy-agent/opa-wasm](https://www.npmjs.com/package/@open-policy-agent/opa-wasm) - Accessed 2026-04-07
**Confidence**: High
**Verification**: [GitHub: open-policy-agent/npm-opa-wasm](https://github.com/open-policy-agent/npm-opa-wasm), [OPA WASM docs](https://www.openpolicyagent.org/docs/latest/wasm/)
**Analysis**: The pre-compilation requirement means you need the `opa` CLI binary in your build pipeline. Every policy change requires a recompilation step. This is fundamentally different from Regorus which interprets Rego source at runtime.

## Comparison: Regorus vs @open-policy-agent/opa-wasm

| Aspect | Regorus (regorusjs) | @open-policy-agent/opa-wasm |
|--------|--------------------|-----------------------------|
| npm package | None (build from source) | Published, 28K+ weekly downloads |
| Rego evaluation | Interprets raw `.rego` at runtime | Requires pre-compiled WASM bundles |
| Build requirement | wasm-pack + Rust toolchain | None (npm install) |
| Policy update workflow | Load new Rego text, no rebuild | Requires `opa build` recompilation |
| API complexity | Rich (Engine, Program, Rvm) | Simple (loadPolicy, evaluate) |
| OPA compatibility | v1.2.0 (most builtins) | Full OPA compatibility |
| TypeScript types | None (wasm-bindgen generates JS) | None (community @types may exist) |
| Data exchange | JSON strings | Objects or ArrayBuffer |
| Pre-compilation option | Yes (Program/Rvm classes) | Required (only mode) |
| Maintenance | Active (v0.9.1, Feb 2025) | Active (v1.10.0, Nov 2024) |
| License | MIT + Apache-2.0 + BSD-3-Clause | Apache-2.0 |

## Bun Compatibility Notes

**Interpretation** (not sourced, based on general knowledge): Bun supports `require()` for WASM modules built with `--target nodejs`. The wasm-bindgen nodejs target generates a JS shim that uses `require()` and `fs.readFileSync()` to load the `.wasm` file. Bun implements both of these Node.js APIs. The `--target web` or `--target bundler` alternatives use `fetch()` or ESM imports which may require different setup.

## Source Analysis
| Source | Domain | Reputation | Type | Access Date | Cross-verified |
|--------|--------|------------|------|-------------|----------------|
| microsoft/regorus (GitHub) | github.com | High | Official repo | 2026-04-07 | Y |
| bindings/wasm/src/lib.rs | github.com | High | Source code | 2026-04-07 | Y |
| bindings/wasm/test.js | github.com | High | Source code | 2026-04-07 | Y |
| bindings/wasm/building.md | github.com | High | Official docs | 2026-04-07 | Y |
| bindings/wasm/Cargo.toml | github.com | High | Source code | 2026-04-07 | Y |
| @open-policy-agent/opa-wasm (npm) | npmjs.com | High | Official package | 2026-04-07 | Y |
| open-policy-agent/npm-opa-wasm (GitHub) | github.com | High | Official repo | 2026-04-07 | Y |

Reputation: High: 7 (100%) | Avg: 1.0

## Knowledge Gaps

### Gap 1: Bun-specific WASM Compatibility
**Issue**: No direct testing or documentation confirms Regorus WASM works with Bun's `require()` or WASM loading. Bun's wasm-bindgen compatibility is not officially documented.
**Attempted**: Searched for "bun wasm-pack wasm-bindgen" -- found general wasm-bindgen docs but no Bun-specific guidance.
**Recommendation**: Build and test directly. The `--target nodejs` output is standard CommonJS + `.wasm` file; Bun's Node.js compatibility layer should handle it. If not, `--target web` with manual instantiation is the fallback.

### Gap 2: TypeScript Type Definitions
**Issue**: Neither Regorus nor wasm-pack generates TypeScript `.d.ts` files by default. The generated `pkg/` directory contains `.js` and `.wasm` files but no type definitions.
**Attempted**: Checked wasm-bindgen docs and Cargo.toml for TS generation features.
**Recommendation**: Use `wasm-bindgen --typescript` flag or manually create `.d.ts` declarations based on the API surface documented in Finding 4. The `tsify` crate or `wasm-bindgen`'s `--typescript` flag can generate declarations.

### Gap 3: GitHub Release Asset Contents
**Issue**: Could not confirm exact contents of GitHub release assets (page failed to load asset details).
**Attempted**: Fetched releases page; asset sections showed loading errors.
**Recommendation**: Low impact -- README explicitly states no pre-built bindings are published, so releases likely contain only source archives.

### Gap 4: Performance Comparison
**Issue**: No benchmarks comparing Regorus WASM vs @open-policy-agent/opa-wasm evaluation speed.
**Attempted**: Not searched (out of scope for this research).
**Recommendation**: If performance is critical, benchmark both approaches with representative policies.

## Conflicting Information
No conflicting information found. All sources consistently confirm Regorus WASM must be built from source and that @open-policy-agent/opa-wasm requires pre-compiled bundles.

## Recommendations for Further Research
1. Build Regorus WASM and test with Bun runtime to confirm compatibility
2. Investigate `wasm-bindgen --typescript` for generating `.d.ts` type definitions
3. Evaluate Regorus builtin coverage vs full OPA for the specific policy features needed (e.g., `http.send`, `opa.runtime`)
4. Test the Program/Rvm compilation path for performance-sensitive scenarios where policies don't change frequently

## Full Citations
[1] Microsoft. "Regorus - A fast, lightweight Rego interpreter written in Rust". GitHub. 2025. https://github.com/microsoft/regorus. Accessed 2026-04-07.
[2] Microsoft. "Regorus WASM bindings". GitHub. 2025. https://github.com/microsoft/regorus/tree/main/bindings/wasm. Accessed 2026-04-07.
[3] Microsoft. "Regorus WASM bindings source (lib.rs)". GitHub. 2025. https://github.com/microsoft/regorus/blob/main/bindings/wasm/src/lib.rs. Accessed 2026-04-07.
[4] Microsoft. "Regorus WASM test.js". GitHub. 2025. https://github.com/microsoft/regorus/blob/main/bindings/wasm/test.js. Accessed 2026-04-07.
[5] Microsoft. "Regorus WASM building.md". GitHub. 2025. https://github.com/microsoft/regorus/blob/main/bindings/wasm/building.md. Accessed 2026-04-07.
[6] Open Policy Agent. "@open-policy-agent/opa-wasm". npm. 2024. https://www.npmjs.com/package/@open-policy-agent/opa-wasm. Accessed 2026-04-07.
[7] Open Policy Agent. "npm-opa-wasm". GitHub. 2024. https://github.com/open-policy-agent/npm-opa-wasm. Accessed 2026-04-07.

## Research Metadata
Duration: ~15 min | Examined: 12 | Cited: 7 | Cross-refs: 5 | Confidence: High 86%, Medium 14% | Output: docs/research/regorus-wasm-javascript-integration.md

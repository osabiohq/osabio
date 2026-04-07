# Prioritization: Regorus Policy Evaluation Engine

## Priority Order

| Rank | Slice | Est. | Rationale |
|------|-------|------|-----------|
| 1 | **Slice 1: Backend Engine + Schema** | 7d | Foundation. Replaces predicate evaluator with Regorus, removes legacy code. |
| 2 | **Slice 2: UI -- Rego Editor** | 4.5d | Unblocks workspace admins from authoring Rego policies via UI. |
| 3 | **Slice 3: Test Panel** | 2d | Gives admins confidence before activating policies. |

**Total**: ~13.5 days

## Dependency Graph

```
Slice 1 (Backend)
  ├──→ Slice 2 (UI)
  └──→ Slice 3 (Test Panel)
```

Slices 2 and 3 are independent of each other and can run in parallel after Slice 1.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Regorus WASM doesn't load in Bun | Low | High | Spike: load WASM in Bun before committing to engine. Bun has WASM support. |
| Rego evaluation latency exceeds predicate evaluator | Low | Medium | Benchmark in Slice 1. Regorus is sub-millisecond per evaluation. Cache compiled modules. |
| Admins struggle with Rego syntax | Medium | Medium | Field suggestions, validation feedback, Rego documentation link in editor. |
| WASM module size bloats bundle | Low | Low | Regorus WASM is ~2MB. Loaded once on startup, not per-request. |

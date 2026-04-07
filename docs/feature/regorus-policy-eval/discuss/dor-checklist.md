# Definition of Ready Checklist: Regorus Policy Evaluation Engine

## DoR Items

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | **User stories defined** | Pass | `user-stories.md` -- 10 stories across 3 slices with effort estimates |
| 2 | **Acceptance criteria testable** | Pass | `acceptance-criteria.md` -- all criteria use Given/When/Then with concrete assertions |
| 3 | **Dependencies identified** | Pass | Regorus WASM npm package. No other external deps. |
| 4 | **Scope bounded** | Pass | No base policies, no bundles, no `.rego` file sync. No backward compatibility. |
| 5 | **Technical feasibility validated** | Needs spike | Regorus WASM loading in Bun not yet proven. Walking skeleton story 0.1 addresses this. |
| 6 | **UI/UX defined** | Pass | Journey map with persona. Rego editor replaces RuleBuilder. Validation feedback specified. |
| 7 | **Outcome KPIs measurable** | Pass | `outcome-kpis.md` -- 4 KPIs with baselines, targets, and instrumentation plan |
| 8 | **Story map with walking skeleton** | Pass | `story-map.md` -- backbone, walking skeleton (5 stories), 3 release slices |
| 9 | **Persona defined** | Pass | Platform lead managing 5-10 policies, comfortable with JSON/YAML, new to Rego |
| 10 | **Effort estimates present** | Pass | All 10 stories have estimates (0.5-2 days each). Total ~13.5 days across 3 slices. |
| 11 | **Alternatives considered** | Pass | 4 alternatives documented in `wave-decisions.md` with rejection rationale |

## Risks Requiring Attention Before DESIGN

| Risk | Severity | Mitigation |
|------|----------|------------|
| Bun WASM compatibility with Regorus | High | Spike in walking skeleton story 0.1. |
| Rego learning curve for workspace admins | Medium | Field suggestions, validation feedback, documentation link in editor. |
| Compiled module cache memory pressure | Low | Design question for DESIGN wave: global Map vs. LRU cache. |

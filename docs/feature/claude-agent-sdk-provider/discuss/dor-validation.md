# Definition of Ready Validation: claude-agent-sdk-provider

## Story: US-01 — Config Type and Parsing for claude-code Provider

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "Finds it impossible to run Osabio because `INFERENCE_PROVIDER` only accepts `openrouter` and `ollama`" — domain terms, user pain |
| User/persona with specific characteristics | PASS | "Priya Kapoor — developer deploying Osabio, Claude Pro subscriber, no OpenRouter account" |
| 3+ domain examples with real data | PASS | Priya configuring claude-code; Reza setting effort+budget; Priya making a typo in provider value |
| UAT in Given/When/Then (3-7 scenarios) | PASS | 5 scenarios: happy path, optional controls, absent optional fields, invalid provider, invalid effort |
| AC derived from UAT | PASS | Each AC maps directly to a UAT scenario outcome |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | Config file change only; estimated 0.5 days; 5 scenarios |
| Technical notes: constraints/dependencies | PASS | Extension point documented; null-avoidance constraint noted; existing conditional pattern cited |
| Dependencies resolved or tracked | PASS | No upstream dependencies; this story is the base for US-02 |
| Outcome KPIs defined | PASS | KPI-1 (setup success rate) and KPI-4 (no regressions) |

### DoR Status: PASSED

---

## Story: US-02 — Provider Factory for claude-code

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "Finds it impossible to run the server because `createRuntimeDependencies()` only knows about OpenRouter and Ollama" |
| User/persona with specific characteristics | PASS | "Developer who has completed US-01 config setup; Claude Code installed and authenticated" |
| 3+ domain examples with real data | PASS | Priya's factory initializing six models; Reza's effort config; unauthenticated Claude Code error path |
| UAT in Given/When/Then (3-7 scenarios) | PASS | 4 scenarios: factory produces models, effort forwarded, missing CLI error, unauthenticated error |
| AC derived from UAT | PASS | 7 AC items each map to observable outcomes from scenarios |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | One factory function + dispatch wiring; estimated 1 day; 4 scenarios |
| Technical notes: constraints/dependencies | PASS | Dynamic import pattern documented; dispatch ternary structure defined; `optionalDependency` note for DESIGN |
| Dependencies resolved or tracked | PASS | Depends on US-01 (in same release); `ai-sdk-provider-claude-code` availability confirmed by issue author |
| Outcome KPIs defined | PASS | KPI-1 (setup success) and KPI-2 (error self-recovery) |

### DoR Status: PASSED

---

## Story: US-03 — Smoke Test

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "Finds it stressful to ship the feature without automated verification" — emotional truth, not implementation |
| User/persona with specific characteristics | PASS | "Developer shipping the claude-code provider feature; wants confidence before documenting" |
| 3+ domain examples with real data | PASS | streamText smoke test with compliance audit message; generateObject extraction test; skip behavior in CI |
| UAT in Given/When/Then (3-7 scenarios) | PASS | 3 scenarios: streamText works, generateObject works, skip when not claude-code |
| AC derived from UAT | PASS | 4 AC items mapped from scenarios |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | Single test file; estimated 0.5 days; 3 scenarios |
| Technical notes: constraints/dependencies | PASS | `configOverrides` pattern documented; no-`process.env` rule applied; separate suite from standard acceptance tests |
| Dependencies resolved or tracked | PASS | Depends on US-02 (provider factory must exist before it can be tested) |
| Outcome KPIs defined | PASS | KPI-1 (100% CI pass rate) and KPI-4 (no regressions) |

### DoR Status: PASSED

---

## Story: US-04 — Developer Setup Documentation

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "Could not complete setup because there was no documentation about prerequisites" — specific gap |
| User/persona with specific characteristics | PASS | "Developer discovering Osabio for the first time; has Claude subscription; looking for quickstart path" |
| 3+ domain examples with real data | PASS | Priya follows README in 5 minutes; Reza uses budget control; Windows developer finds platform note |
| UAT in Given/When/Then (3-7 scenarios) | PASS | 3 scenarios: prerequisites section, optional controls documented, quickstart mentions claude-code |
| AC derived from UAT | PASS | 4 AC items each map to a UAT scenario |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | README changes only; estimated 0.5 days; 3 scenarios |
| Technical notes: constraints/dependencies | PASS | README location documented; documentation-only change; depends on US-02 for accurate content |
| Dependencies resolved or tracked | PASS | Depends on US-02 shipping (to confirm env var names and error messages are final) |
| Outcome KPIs defined | PASS | KPI-3 (zero setup questions filed) |

### DoR Status: PASSED

---

## Overall Handoff Status

Post-remediation (peer review iteration 1 resolved):

| Story | DoR | Size | Anti-patterns | Status |
|-------|-----|------|---------------|--------|
| US-01 | PASSED | 0.5 days, 5 scenarios | None detected | READY |
| US-02 | PASSED | 1 day, 5 scenarios | None detected | READY |
| US-03 | PASSED | 0.5 days, 3 scenarios | None detected | READY |
| US-04 | PASSED | 0.5 days, 3 scenarios | None detected | READY |

**All 4 stories pass DoR. Peer review approved (iteration 1 remediations applied). Feature is ready for DESIGN wave handoff.**

---

## Anti-Pattern Audit

| Anti-Pattern | Checked | Finding |
|-------------|---------|---------|
| Implement-X stories | Yes | No story starts with "Implement" — all start from user pain |
| Generic data (user123) | Yes | All examples use named personas (Priya Kapoor, Reza) with real domain data |
| Technical AC | Yes | No AC references JWT, specific class names, or implementation details — all observable outcomes |
| Technical scenario titles | Yes | No titles reference class names or file names — all business outcomes |
| Oversized stories | Yes | All stories ≤1 day; no story exceeds 5 scenarios |
| Abstract requirements | Yes | All 4 stories have 3 concrete domain examples with real persona names and realistic data |

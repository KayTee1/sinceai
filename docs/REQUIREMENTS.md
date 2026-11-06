# Requirements

Organizer facts: [CHALLENGE](CHALLENGE.md). Dataset semantics:
[DATA_SOURCES](DATA_SOURCES.md). This implementation proposal supersedes earlier
planted-data requirements; final scope remains pending team approval.

| ID | Requirement | Source | Must / nice | How we check it |
| --- | --- | --- | --- | --- |
| R1 | Import provided Pharmaceuticals estate with IDs, types and provenance | B1 §05; W1 START_HERE; proposed SCOPE | must | Sheet counts match DATA_SOURCES; blanks preserved; dates decoded |
| R2 | Clarify conflicting intent, map canonical KPIs, recommend reuse/extend/new build with evidence | B1 §03–04; W1 rules 1–2 | must | REQ-0001 conflict surfaced; corrected intent drives candidates; no exact score target |
| R3 | Explain KPI ambiguity with source evidence; never invent formulas or monetary gaps | W1 KPI_Catalog / Data_Dictionary | must | Source KPI IDs/status shown; unsupported numeric reconciliation blocked |
| R4 | Versioned human approvals before simulated local change; reject/edit require reasons | B1 §06; proposed SCOPE | must | Rejection leaves state unchanged; edits reset approvals; required owners approve same version |
| R5 | Append-only proposal, decision and execution audit with evidence references | B1 governance/oversight; proposed SCOPE | must | One event per action; timeline includes actor, rationale and evidence snapshot |
| R6 | Evidence-backed lifecycle/migration review; archive only after approval | B1 §02; W1 rules 4/6/8 | nice | Dependencies and usage visible; candidate labels do not auto-apply |
| R7 | Simulated clock | Team idea, SCOPE P2 | nice | Only if useful; expiry flags review, never auto-archives |
| R8 | Optional separate SQL conflict fixture with documented definitions | Team idea, SCOPE P1 | nice | Clearly separate provenance; query/results reproducible; not claimed as pack content |
| R9 | Promotion ladder | Team idea, SCOPE P2 | nice | Requires approval; no quarterly-distinct count from monthly sums |
| R10 | Missing/inactive owner detection blocks changes | W1 Owners / rules 3; proposed SCOPE | must | Detect 21 blank asset owners; unresolved approvers prevent execution |
| R11 | Portfolio before/after | Team idea, SCOPE P1 | nice | Counts reflect applied local changes, not pending proposals |
| R12 | Health score, export and cost estimates | Team idea, SCOPE P2 | nice | Explain assumptions; no invented savings |
| R13 | Show model trust/refresh, usage window, quality and lineage | W1 START_HERE / rules 4/5/7/8 | must | Cite model, usage and directed upstream/downstream evidence |
| R14 | Working workflow and README/architecture note | B1 §07 | must | Demonstrate full workflow; document assumptions, AI, controls and BI integration path |
| R15 | Use only Pharma scenario; label synthetic values and honor exclusions | W1 START_HERE | must | No cross-division/clinical demo; no actual Bayer performance claims |
| R16 | Shared evidence/lineage panel for app-rendered charts, values and candidate assets | W1 rules 4/8; team design D6 | must | Catalog edges for imported assets; actual query/source rows for app-computed values; missing mappings explicit; no distinct audience claims across assets/months; proposal stores snapshot |
| R17 | Dashboard and prompting workspaces share catalog, evidence, proposals and audit | KayTee design request; D7 | must | User searches an existing asset; manager clarifies a request and proposes a change; approval depends on owner/steward role, not prompting access |

## Demo script

See [SCOPE](SCOPE.md#pitch-and-demo): supplied request → clarification → existing
assets/KPIs/models → governance evidence → human decision → local result/audit.
60–90 seconds is our target; published limit remains unknown. No lifecycle
simulation, four planted variants or numeric attribution needed for core demo.

## Out of scope

W1 exclusions apply: Crop Science/Consumer Health, clinical/treatment decisions,
pharmacovigilance, patient profiling, real Bayer systems or actual performance
claims. No live integration, production auth or certified compliance.

## Unknowns

| Unknown | Affects | Who resolves it |
| --- | --- | --- |
| IP, source redistribution, external AI processing terms | Data handling / submission | Organizers / Bayer |
| Video limit and current portal rules | Demo / submission | Organizers |
| Whether DSO / 90-day review adds value | Optional scope | Bayer |
| How text/context disagreements should be resolved | Intake behavior | Bayer / user clarification |
| Final approach, stack, action vocabulary and contract | Implementation | Viet + KayTee |

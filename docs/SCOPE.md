# Analytics Steward — proposed scope

Updated 2026-11-06 after final-brief intake. This replaces the earlier
cross-division, planted-data proposal. [CHALLENGE](CHALLENGE.md) holds organizer
facts; [DATA_SOURCES](DATA_SOURCES.md) holds source references and data limits.
Approach, stack, lanes and interface remain proposed until both developers agree.

## Pitch and demo

Help a Pharmaceuticals business user find a trustworthy answer in the existing
BI estate before commissioning another dashboard. Show the evidence and let a
human decide. Migration context: do not recreate low-value Tableau content in
Power BI simply because it exists.

Core demo (60–90 seconds is our target, not a published limit):

1. Open a supplied business request. If text and structured context disagree,
   show both and ask the user to resolve intent (REQ-0001 is an observed example).
2. Resolve product, market, period, decision and canonical KPIs; show ranked
   existing reports/models and missing capabilities.
3. Explain ownership, endorsement, refresh/AI readiness, usage, KPI flags and
   upstream/downstream dependencies with sheet/record references. The user
   clicks a chart or number and opens its lineage view (see below).
4. Propose reuse/extend or human review with concrete evidence. If demonstrating
   migration, explain why a legacy asset should migrate, consolidate or retire;
   a backlog candidate is not an approved answer.
5. Reject with a reason and show no asset change; approve a revised proposal and
   show the simulated local change and audit trail. Never claim live BI changes.

Payoff: "Reuse what exists. Explain what disagrees. Keep people accountable."

## P0: one working workflow

- Load the provided synthetic estate with original IDs, types and provenance.
  Preserve missing owners, request inconsistencies and source labels.
- Structured intake and clarification; resolve KPIs against canonical groups.
- Search existing assets and shared models before proposing new content.
- Governance evidence: ownership, endorsement, usage window, model refresh,
  KPI approval/ambiguity, quality and upstream/downstream lineage.
- Lineage drill-down: click any chart, number or candidate asset to see where
  it comes from and what depends on it (see "Lineage drill-down").
- Evidence-backed proposal, required human decision, simulated local application
  and append-only audit timeline. No external systems are modified.
- Small team-authored scenario set with expected behaviors and source references;
  do not present it as organizer ground truth.

## Two workspaces, one application

Dashboard mode serves business users: search and filter existing assets by
product, market and KPI, inspect trust/ownership evidence, open an asset and
request a missing capability. Prompting mode serves managers and analysts:
clarify a business question, compare candidates and gaps, propose reuse,
extension or justified new work, and track human decisions. Portfolio health
and the approval inbox belong in the management workspace.

Both modes share one catalog, evidence service, proposal store and audit trail.
Prompting access does not grant approval authority: affected owners/stewards
approve according to the proposal. Demo identity selection remains simulated.

The P0 pipeline is dashboard search or prompt → parse and confirm intent →
resolve canonical KPIs and retrieve existing assets → check fit and governance
→ show ranked candidates with evidence → reuse, or propose extension/new work
→ versioned human review → simulated local execution and audit. Certification
alone does not establish fit: check dimensions, filters, period, refresh,
ownership and quality. Missing evidence stays unknown.

A new-build outcome in P0 is an approved build request; automatic BI dashboard
generation is deferred. A recommendation click/open is a local app event,
not proof of BI consumption and never an increment to imported BI usage.

## Corrections to the pipeline diagrams

The reviewed `Replaced by AI-1.pdf` is a design input, not the current contract.
Its TTL/no-response arrows must lead to review-required, not automatic archive.
Retirement needs explicit approval and dependency review; archive is restorable.
Temporary/personal/team/certified must not form one imported state ladder:
audience, endorsement, lifecycle and app review status are separate fields.
30/90-day leases, DSO cycles and a three-user promotion threshold are optional
team policies, not challenge requirements or P0 behavior.

The pack supports source-backed KPI ambiguity, not gross/net SQL reconciliation.
A separate synthetic formula fixture is optional P1. Warehouse integration,
live BI telemetry and query costs are future capabilities; do not imply that
they are available in the workbook. Persist evidence and concise rationale,
not private model reasoning traces.

## P1 / P2

P1: broader migration/consolidation review, portfolio counts, quantitative
business-fact queries with explicit units and value_type filters, richer impact
analysis and optional independently synthetic SQL definition-conflict fixture.
P2: clock simulation, promotion ladder, 90-day leases (only if Bayer confirms
value), health score, audit export and documented cost estimates.

The pack cannot support the previous four net-revenue SQL variants or returns /
rebate attribution directly. KPI conflict labels demonstrate ambiguity, not a
measured monetary disagreement. Optional SQL extensions must have their own
formulas/data/provenance and must not be attributed to the supplied pack.

## Matching and explanations

Extract requested metric IDs, dimensions, filters, period and business decision.
Preserve text and context independently; ask when they conflict or are ambiguous.
Show semantic similarity, structural matches and missing capabilities separately.
Scores are ranking heuristics, not probabilities; no exact 0.78 acceptance target.
Any thresholds and weighting are team design choices requiring validation.
Missing fields are not positive matches. A high similarity score does not bypass
ownership, certification, refresh or lineage risks.

Numbers are computed by code from source rows, never invented by the LLM. Store
query/parameters, units, filters, time window and result snapshot. Monthly unique
users cannot be summed into quarterly distinct users. Actual-like and forecast-
like values must remain distinguished. Explanations cite sheet + record IDs and
separate source evidence, inference, uncertainty and proposed action.

## Lineage drill-down (P0)

Workbook rule 4: recommendations affecting important reports show upstream
models and downstream impact. We make this visible on demand.

Every app-rendered chart, number and candidate asset has an evidence/lineage
entry point. This does not inspect charts inside external BI reports. Clicking opens
a lineage panel with two parts:

1. **Lineage graph.** Upstream semantic models (`MODEL_TO_MODEL`) → the model
   behind the asset (`MODEL_TO_ASSET`) → the asset → downstream assets
   (`ASSET_TO_ASSET`). Each node shows its ID, name, owner, endorsement and,
   for models, refresh status and AI readiness. Risky nodes (failed refresh,
   missing/inactive owner, unapproved KPI) are highlighted.
2. **How it was traced.** The exact `Lineage_Edges` rows used (source_id,
   target_id, edge_type, relationship), traversal direction and depth, and a
   note that lineage comes from catalog metadata, not from the AI. For a chart
   or number: the source sheet and rows, filters, period, units, value_type
   and the stored query/parameters that produced the value.

For imported assets, show catalog model/asset edges only: the pack contains no
internal BI visual definitions or executable metric queries. For values computed
by this app, show the actual stored query/parameters and source rows. Do not
invent links between product facts and BI assets; show missing mappings.

Downstream impact summary: count distinct affected asset IDs and show monthly
unique users per asset. Users cannot be deduplicated across assets or months
from this pack; any sum must be labelled non-distinct asset-user counts, never
people reached. Missing edges are shown as "no lineage recorded", never guessed.
Traversal must handle cycles, deduplicate nodes and report depth truncation.

Lineage is traced by deterministic code (`trace_lineage`); the agent may only
explain the returned graph. The lineage snapshot is stored with each proposal,
so the audit timeline shows the same graph the approver saw.

## Governance and approval proposal

Workbook rules: reuse before build; canonical approved KPIs unless a documented
exception; accountable owners; lineage; review high-reach unendorsed content;
rationalise before migration; AI-ready semantics; evidence for lifecycle actions.
These motivate controls; our exact workflow below is a proposed implementation.

Snapshot required approvers per proposal version. Reconciliation affecting two
assets requires both owners (deduplicate the same person); promotion to certified
requires owner and metric steward. Other changes require affected owners.
Missing/inactive owners block execution until a human assigns an accountable
approver. Demo identity selection is simulated, not production authentication.

Remain pending until every required approver approves the same version. Rejection
ends that version without mutation. Editing requires a reason and creates a new
pending version; all approvals reset. Apply once, atomically with an execution
audit event. Each proposal creation and each human decision writes one audit row;
execution is a separate event. Record evidence and rationale, not private chain
of thought. Human decisions must never be inferred from source candidate labels.

If leases are added, expiry flags review. It never auto-archives; retirement
requires human approval. Archive is restorable and never deletes the source.

## Proposed architecture and interface boundary

Python/FastAPI plus SQLite or DuckDB; Claude tool use; Next.js or Streamlit.
No stack chosen. Agent proposes and explains; deterministic services extract
records, calculate values, evaluate rules and execute approved local changes.
Backend writes audit events automatically; catalog content is data, not agent
instructions. Keep API keys in ignored environment configuration.

Source schema and enums are documented in DATA_SOURCES; do not rewrite them to
fit the previous temporary/personal/team/certified tier scheme. Imported
endorsement and lifecycle status are separate fields. App-owned proposals,
versioned approvals, audit events and overrides are separate local records.

Contract remains TBD: agree request/candidate/evidence/proposal/decision JSON and
fixture before either lane implements. Suggested tools: search_assets, get_asset,
get_kpi, get_model, get_usage, trace_lineage, get_governance, create_proposal.
P0 uses one orchestrator with deterministic retrieval, lineage, governance and
execution tools; diagram agent boxes are logical responsibilities. Separate
builder/lease agents and a scheduler are deferred. Exact endpoints, fields,
approval identities and supported action enums need both
developers' agreement. Production path should explain approved catalog and
Power BI/Fabric API replacement; live integrations are outside this demo.

## Explicit exclusions

Crop Science, Consumer Health, clinical/treatment decisions, patient profiling,
pharmacovigilance cases, patient/HCP data, real Bayer internal systems or claims
of actual Bayer performance. No production authentication, real compliance
certification or unsupported claims of accuracy/cost savings. Raw source files
stay local until redistribution terms are clarified.

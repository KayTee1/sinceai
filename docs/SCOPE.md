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
   upstream/downstream dependencies with sheet/record references.
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
- Evidence-backed proposal, required human decision, simulated local application
  and append-only audit timeline. No external systems are modified.
- Small team-authored scenario set with expected behaviors and source references;
  do not present it as organizer ground truth.

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
Exact endpoints, fields, approval identities and supported action enums need both
developers' agreement. Production path should explain approved catalog and
Power BI/Fabric API replacement; live integrations are outside this demo.

## Explicit exclusions

Crop Science, Consumer Health, clinical/treatment decisions, patient profiling,
pharmacovigilance cases, patient/HCP data, real Bayer internal systems or claims
of actual Bayer performance. No production authentication, real compliance
certification or unsupported claims of accuracy/cost savings. Raw source files
stay local until redistribution terms are clarified.

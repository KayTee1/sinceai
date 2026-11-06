# Architecture

Status: proposed (D3/D5). No interface contract approved. Final challenge facts
and source schema override previous draft assumptions: see CHALLENGE,
DATA_SOURCES and SCOPE.

## Proposed components

- UI: shared dashboard mode for asset discovery/consumption and prompting mode
  for manager/analyst requests, proposals and approval inbox. Both use the same
  catalog, evidence, proposal and audit services. Approval authority comes from
  owner/steward roles, not workspace access. Include request clarification,
  ranked candidates, governance evidence, proposals,
  simulated human decisions and audit timeline. App-rendered charts, numbers
  and candidate assets open an evidence/lineage panel (graph + source details).
- Backend: metadata retrieval, scoring, lineage, governance, approval executor
  and automatic audit writer. Model produces explanations/proposals, not numbers.
- Storage: SQLite or DuckDB, source import preserving workbook IDs/statuses;
  separate app-owned proposals, approvals, audit and local overlays.
- Agent: one orchestrator with deterministic tools in P0; discovery/conflict/
  lifecycle boxes are logical responsibilities. Builder and lease agents and
  scheduling are deferred. Claude tool use proposed; provider/model and external
  processing terms not confirmed. Stack: Python/FastAPI with Next.js or Streamlit, not chosen.
- Data: provided XLSX, no order-level warehouse or executable metric formulas.
  Raw files stay outside Git; local copies, if needed, go in ignored data/private/.
- Production path: approved catalog, Power BI/Fabric usage/lineage/model APIs
  replacing synthetic inputs. No live integration required for prototype.

## Contract still to agree

Define a lineage response for `trace_lineage(object_id, direction, depth)`:
nodes (id, type, name, owner, endorsement, refresh/AI readiness, risk flags),
edges (the source `Lineage_Edges` rows), distinct affected asset count,
per-asset monthly users, missing mappings and traversal truncation. Handle cycles
and deduplicate nodes. Do not claim distinct audience across assets or months.
For app-computed charts/numbers, return the actual stored query/parameters,
units, filters, period, value_type and source rows. Imported BI assets expose
catalog lineage only; internal BI visual queries are unavailable. No inferred
fact-to-asset links. Store the evidence snapshot with each proposal version.

New-build approval creates a local build request in P0, not a generated BI
report. Local click/open events remain separate from source usage telemetry.

Define request intent and conflicts, candidate score components, evidence source
references, governance risks, proposal versions/required approvers, human
responses and atomic local execution. Exact JSON, endpoints, supported actions,
source→app mappings and shared fixture remain TBD by both developers.

Source endorsement, lifecycle labels and migration candidates remain distinct;
there are no official evaluation labels. Use app-owned decision states rather
than overwriting imported evidence. Missing/inactive approvers block execution;
edits require fresh approval. Expiry never auto-archives. See SCOPE for proposed
semantics; do not treat them as organizer mandates or a frozen API.

## Configuration and run commands

TBD after stack approval. Keys belong in ignored .env; only names go in docs.
No install/run/test commands have been verified because no app exists yet.

## Demo reset and fallback

Proposed: reload immutable source snapshot, clear local decisions/overrides and
replay a fixed scenario. Distinguish live model explanations from saved fallback
output. Need to agree implementation and document tested commands later.

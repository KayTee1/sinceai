# Architecture

Status: proposed (D3/D5). No interface contract approved. Final challenge facts
and source schema override previous draft assumptions: see CHALLENGE,
DATA_SOURCES and SCOPE.

## Proposed components

- UI: request clarification, ranked candidates, governance evidence, proposals,
  simulated human decisions and audit timeline. Charts, numbers and candidate
  assets are clickable and open a lineage panel (graph + "how it was traced").
- Backend: metadata retrieval, scoring, lineage, governance, approval executor
  and automatic audit writer. Model produces explanations/proposals, not numbers.
- Storage: SQLite or DuckDB, source import preserving workbook IDs/statuses;
  separate app-owned proposals, approvals, audit and local overlays.
- Agent: Claude tool use proposed; provider/model and external processing terms
  not confirmed. Stack: Python/FastAPI with Next.js or Streamlit, not chosen.
- Data: provided XLSX, no order-level warehouse or executable metric formulas.
  Raw files stay outside Git; local copies, if needed, go in ignored data/private/.
- Production path: approved catalog, Power BI/Fabric usage/lineage/model APIs
  replacing synthetic inputs. No live integration required for prototype.

## Contract still to agree

Define a lineage response for `trace_lineage(object_id, direction, depth)`:
nodes (id, type, name, owner, endorsement, refresh/AI readiness, risk flags),
edges (the source `Lineage_Edges` rows), impact summary and, for a chart or
number, the stored query/parameters and source rows.
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

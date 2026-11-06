# Architecture

Status: **proposed** (D7–D9), based on the Miro architecture diagram. Contract
not yet agreed by both developers. Facts and data limits: CHALLENGE,
DATA_SOURCES; product scope: SCOPE.

## Stack (D7)

TypeScript everywhere.

- **App:** Next.js (App Router) for both tabs and the API routes.
- **Agents:** Mastra (agents, tools, one workflow with a suspend/resume step for
  human approval). P0 agents: Orchestrator, Discovery, Conflict detector;
  Builder and Lease steward in P1 (D11). Model: Claude via Mastra's model routing.
- **Storage:** SQLite through libSQL (Mastra supports it natively). One file.
- **Search:** keyword + vector, in process (about 500 objects; no vector DB).
  Embeddings provider TBD.
- **UI:** React; a graph library for the Pipeline and lineage views (e.g.
  React Flow) and a chart library (e.g. Recharts). Not chosen yet.
- **Import:** a TypeScript script reads the Bayer XLSX into SQLite once.

Check exact Mastra APIs against its docs when scaffolding; don't rely on memory.

## Components (Miro layers)

```text
Client (Next.js)
  Top middle: [Agentic | Dashboard]      Top right: [Employee | Manager]
  Agentic (Manager only): Chat view <-> Pipeline view, Approval inbox, Clock
  Dashboard: dashboard list, charts, lineage panel, portfolio (Manager)
        |
API routes (simulated RBAC from the role toggle)
        |
Agent layer (Mastra)
  P0: Orchestrator (incl. intent parsing) -> Discovery agent -> Conflict detector
  P1: Builder agent, Lease steward (P0 uses deterministic build/lease tools)
        | tool calls only
Platform services (plain TS, deterministic)
  Lifecycle engine | Policy engine | Semantic layer | Scheduler + sim clock
  Audit writer (called by the backend, never an agent tool)
        |
Data (SQLite)
  Imported read-only: Bayer pack tables (assets, KPIs, models, owners,
    lineage, usage, signals, migration backlog, requests, product facts)
  App-owned: asset_state (tier, lease_end, status), usage_events,
    proposals, approvals, audit_log, archive_snapshots, clock, vectors
```

Suggested folders (to agree): `app/` (Next.js routes and UI), `src/mastra/`
(agents, tools, workflow), `src/services/` (lifecycle, policy, semantic,
scheduler, audit, lineage), `src/db/` (schema, import), `data/private/`
(ignored; local copy of the XLSX).

## Contract to agree before both lanes start

1. **Step events** (one stream, read by both Agentic views):
   `{ runId, step, agent, status: running|done|waiting_approval|failed, summary, evidence[], ts }`.
   Steps: intent, clarify, discovery, conflict, propose, approve, build,
   register, done.
2. **Proposal:** `{ id, version, type, assetIds[], rationale, evidence[], lineageSnapshot, requiredApprovers[], status }`.
   Types: reuse, build_temporary, promote, renew, merge, retire, restore,
   reassign_owner.
3. **Decision:** `{ proposalId, version, actor, action: approve|reject|edit, reason }`.
4. **Asset state:** `{ assetId, tier: temporary|personal|team|certified, status: active|lease_due|archived|merged, owner, leaseEnd, ttlEnd, sourceEndorsement }`.
5. **Lineage:** `trace_lineage(objectId, direction, depth)` → nodes (id, type,
   name, owner, tier/endorsement, refresh, AI readiness, risk flags), edges
   (source `Lineage_Edges` rows), distinct affected asset count, per-asset
   monthly users, missing mappings and truncation. Handle cycles; deduplicate
   nodes. Imported assets expose catalog edges only; app-computed values return
   the actual stored query/parameters, units, filters, period, `value_type` and
   source rows. No inferred fact-to-asset links. Snapshot stored per proposal
   version.
6. **Endpoints (draft):** `POST /api/runs` (start run), `GET /api/runs/:id/events`
   (stream), `GET /api/proposals`, `POST /api/proposals/:id/decision`,
   `GET /api/assets`, `GET /api/assets/:id/lineage`, `GET /api/assets/:id/audit`,
   `POST /api/usage`, `POST /api/clock/advance`, `GET /api/portfolio`.

Role toggle controls visibility only; approval checks the proposal's required
approvers (owner / team lead / steward). App open events are stored apart from
imported usage. The UI lane can build against fixtures of these shapes until
the backend is ready.

## Configuration

Names only; values go in `.env` (ignored):

- `ANTHROPIC_API_KEY`
- `DATABASE_URL` (libSQL file path)
- Embeddings key: TBD with the provider

## Run commands

None verified yet; no app code exists. Add exact tested commands after scaffolding.

## Demo reset and fallback

Reset: rebuild SQLite from the XLSX, reseed synthetic usage with a fixed seed,
reset the clock. Fallback: a recorded run of the step events can be replayed in
both views if the model API fails; label it as a replay.

## Production path (for the README note)

Replace the imported pack with the approved catalog and Power BI/Fabric APIs
(workspaces, semantic models, lineage, usage); real SSO/RBAC instead of the
role toggle; scheduler as a real cron. No live integration in the prototype.

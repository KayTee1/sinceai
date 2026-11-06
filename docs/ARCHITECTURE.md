# Architecture

Status: stack and UI accepted (D7–D9); contract **proposed** (D12, D13), based
on the Miro architecture diagram and not yet agreed by both developers. Facts and data limits: CHALLENGE,
DATA_SOURCES; product scope: SCOPE.

## Stack (D7)

TypeScript everywhere.

- **App:** Next.js (App Router) for both tabs and the API routes.
- **Agents:** Mastra (agents, tools, one workflow with a suspend/resume step for
  human approval). P0 agents: Orchestrator, Discovery, Conflict detector;
  Builder and Lease steward in P1 (D11). Model: Claude via Mastra's model routing.
- **Storage:** SQLite through libSQL (Mastra supports it natively). One file.
- **Search:** keyword + local word-overlap (TF-IDF) vectors, in process (about
  500 objects; no vector DB, no external embeddings service in P0; D13).
- **UI:** React; a graph library for the Pipeline and lineage views (e.g.
  React Flow) and a chart library (e.g. Recharts). Not chosen yet.
- **Import:** a TypeScript script reads the Bayer XLSX into SQLite once.

Check exact Mastra APIs against its docs when scaffolding; don't rely on memory.

## Components (Miro layers)

```text
Client (Next.js)
  Top middle: [Agentic | Dashboard]      Top right: [Employee | Manager]
  Agentic (Manager only): Chat view <-> Pipeline view, Approval inbox,
    "acting as" approver picker, God-mode clock panel
  Dashboard: dashboard list, charts, lineage panel, "viewing as" picker
    (Employee), counts panel (Manager)
        |
API routes (toggle = visibility; approvals checked against required approvers)
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
(ignored; local copy of the XLSX). The semantic layer holds the computable
KPI mapping from SCOPE (D14).

## Contract to agree before both lanes start

1. **Step events** (one stream, read by both Agentic views):
   `{ runId, step, agent, status: running|done|waiting_approval|failed, summary, evidence[], ts }`.
   Steps: intent, clarify, discovery, conflict, confirm_reuse, propose, approve, build,
   register, done. The scheduler emits the same shape with `runId: "clock"`
   and `agent` set to the service (scheduler, lifecycle) for steps expire,
   lease_review, archive and restore, so the Pipeline view can light them up.
2. **Proposal:** `{ id, version, type, assetIds[], rationale, evidence[], lineageSnapshot, requiredApprovers[], status }`.
   Types: build_temporary, promote, renew, merge, retire, restore,
   reassign_owner. Reuse is not a proposal: the requester confirms the reuse
   candidate (no approver) and it is logged as a usage event plus an audit
   row (D13, D14). Merge proposals add
   `candidates[]` (same model + overlapping KPIs) and the owner's chosen
   `targetAssetId`; execution requires an active target whose scope covers
   the source and redirects the source's downstream assets. Required approvers (D13, D14): build_temporary → any active
   Lead in the requester's region; promote to Team → any active Lead in the
   owner's region; promote to Certified → the region's data steward; renew /
   merge / retire / restore → asset owner; reassign_owner → the region's data
   steward (Global steward for Asia Pacific). Temporary → Personal is
   automatic and logged. Promotion never changes the owner. Any decision
   closes a lease review; rejecting retire or merge renews the lease.
3. **Decision:** `{ proposalId, version, actor, action: approve|reject|edit, reason }`.
   `actor` is the identity from the "acting as" picker; the API rejects an
   approve when `actor` is not in `requiredApprovers`.
4. **Asset state:** `{ assetId, tier: temporary|personal|team|certified, previousTier, status: active|lease_due|archived|merged, owner, requester, leaseStart, leaseEnd, leaseSeeded, reviewDeadline, ttlEnd, sourceEndorsement }`.
   Leases are per asset: `leaseEnd = leaseStart + 90` simulated days; renew
   keeps `tier` and resets `leaseStart`. Restore sets `tier = previousTier`,
   `status = active` and starts a new lease; a restored Temporary gets a
   fresh 30-day `ttlEnd` instead. Imported assets get a seeded lease
   (`leaseSeeded: true`): `leaseStart` is the latest date on or before the
   clock start that equals `last_modified` + k × 90 days. `reviewDeadline =
   leaseEnd + 14` days; silence past it applies the default archive.
5. **Clock:** `{ simDate, startDate: "2026-11-01", running, msPerDay: 1000, reviewWindowDays: 14, nextDueEvent }`. 1 simulated
   day = 1 s while running; starts paused after reset. Actions: pause, resume,
   advance by N days, advance to next due event. Forward only; no rewind.
   Advancing processes every due event in date order.
6. **Lineage:** `trace_lineage(objectId, direction, depth)` → nodes (id, type,
   name, owner, tier/endorsement, refresh, AI readiness, risk flags), edges
   (source `Lineage_Edges` rows), distinct affected asset count, per-asset
   monthly users, missing mappings and truncation. Handle cycles; deduplicate
   nodes. Imported assets expose catalog edges only; app-computed values return
   the actual stored query/parameters, units, filters, period, `value_type` and
   source rows. No inferred fact-to-asset links. Snapshot stored per proposal
   version.
7. **Endpoints (draft):** `POST /api/runs` (start run; body includes
   `requesterId`), `GET /api/runs/:id/events`
   (stream), `GET /api/proposals`, `POST /api/proposals/:id/decision`,
   `GET /api/assets`, `GET /api/assets/:id/lineage`, `GET /api/assets/:id/audit`,
   `POST /api/usage` (`{ assetId, viewerId }`), `GET /api/clock`, `POST /api/clock/pause`,
   `POST /api/clock/resume`, `POST /api/clock/advance` (`{ days }` or
   `{ toNextEvent: true }`), `GET /api/portfolio`.

Role toggle controls visibility only; approval checks the proposal's required
approvers (owner / team lead / steward) against the acting identity. Runs are
started by the manager for a named requester; employees never start runs. App open events are stored apart from
imported usage. The UI lane can build against fixtures of these shapes until
the backend is ready.

## Configuration

Names only; values go in `.env` (ignored):

- `ANTHROPIC_API_KEY`
- `DATABASE_URL` (libSQL file path)

## Run commands

Tested on 2026-11-06 (Node 22):

```sh
npm install
mkdir -p data/private && cp <path>/Bayer_..._FINAL_Builder_Data_Pack.xlsx data/private/pack.xlsx
npm run db:import      # XLSX -> data/private/steward.db (one table per sheet)
cp .env.example .env.local   # add ANTHROPIC_API_KEY for the chat
npm run dev            # http://localhost:3000
npm run lint && npx tsc --noEmit && npm run build
```

Code layout: `src/app` (page + `api/chat`), `src/components` (shell, dashboard,
agentic chat), `src/lib` (catalog loader, shared types), `src/mastra` (agent +
read-only catalog tools), `src/db` (SQLite client, import).

## Demo reset and fallback

Reset: rebuild SQLite from the XLSX, reseed synthetic usage with a fixed seed,
reset the clock to its start date, paused. Fallback: a recorded run of the step events can be replayed in
both views if the model API fails; label it as a replay.

## Production path (for the README note)

Replace the imported pack with the approved catalog and Power BI/Fabric APIs
(workspaces, semantic models, lineage, usage); real SSO/RBAC instead of the
role toggle; scheduler as a real cron. No live integration in the prototype.

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
   Built in T5 (beyond the draft): `GET /api/lifecycle` (clock, inbox,
   counts, recent audit for the UI), `POST /api/lifecycle/reset` (demo reset of
   app-owned tables) and `POST /api/assets/:id/restore` (`{ actor, reason? }`).
   Built in T17: `POST /api/builds` (`{ requestId, answer?, requesterId? }`)
   runs the steward analysis and stores a `build_temporary` proposal only when
   it recommends a build; `POST /api/proposals/:id/decision` on that proposal
   computes the insight (per market, latest month, actual-like) and registers
   it as Temporary. Built insights live in the app-owned `insights` table.

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
npm test               # fixture tests; add PACK_XLSX=<path> for the local workbook checks
cp .env.example .env.local   # add ANTHROPIC_API_KEY for the chat
npm run dev            # http://localhost:3000
npm run lint && npx tsc --noEmit && npm run build
```

`db:import` is non-destructive (T14): it validates the workbook (sheet set,
headers, DATA_SOURCES row counts), writes a temporary file and publishes it
only if `steward.db` does not exist. It never deletes or overwrites a
database; to reimport, delete the file first. Every table keeps its original
columns plus `_source_row`, the exact Excel row (header = row 1).
Backend services (`src/services/steward`) take a libSQL client as a parameter
(`src/db/open.ts`), so they run in tests and scripts without Next.js:
`npx tsx src/services/steward/cli.ts REQ-0001 [product market]` prints the
structured analysis.
KPI computation (T15, `src/services/semantic`) applies the D14 mapping
(team-authored, proposed) to `Product_Market_Monthly`: one `value_type` per
calculation, additive M EUR measures summed, growth as a ratio of sums,
coverage % per product and market only. Results are `computed`,
`unsupported` or `insufficient_data`, with units, filters, the query and
source rows: `npx tsx src/services/semantic/cli.ts KPI-004 P-NUB DE
2026-10-01` (add `--by-market` for one result per market).

### Steward tools (T16, provisional until agreed with Viet)

`src/mastra/tools/steward-tools.ts` exposes the services to Mastra as thin
adapters: `createStewardTools(getDb)` returns three `createTool()` tools. Each
validates the input shape, calls the service and returns its result unchanged;
service errors are re-thrown unchanged (Mastra streams them as
`tool-output-error`). T16B wires them into the live orchestrator; see "Live
orchestrator (T16B)" below.

| Tool (id / key) | Input | Calls | Errors |
| --- | --- | --- | --- |
| `analyze-request` / `analyzeRequest` | `requestId`, optional `answer {product, market}` (an offered option) | `analyzeRequest` | unknown ID: `RequestNotFoundError`; answer not offered: `Error` |
| `compute-kpi` / `computeKpi` | `kpiId`, `product` (name or All Pharma), `market` (ID, region or Global), optional `month`, `valueType`, `breakdown` (total / by_market) | `scopeIds`, `latestFactMonth`, `computeKpi` / `computeKpiByMarket` | unknown scope: `StewardToolInputError`; bad month: `InvalidKpiQueryError` |
| `check-kpi-definitions` / `checkKpiDefinitions` | `text` | `checkKpis` | none |

Malformed input (empty ID, unknown `valueType`) returns Mastra's validation
object `{ error: true, message }` instead of a result.

Payloads: the full results keep row-level provenance (REQ-0001 Nubeqa / Global
is ~55 KB) and are what `execute` returns. The model (`toModelOutput`) and the
chat UI stream (`transform.display`) both receive the same compact view from
`steward-views.ts` (`steward-analysis/v1`, `kpi-result/v1`,
`kpi-by-market/v1`, `kpi-checks/v1`): values, statuses, reasons, IDs, formula
text and source-row counts. Structured provenance (SourceRefs, SQL and its
arguments, source-row lists) is omitted, and every view's `omitted` note says
so. Human-readable diagnostic reasons are kept verbatim and may name a workbook
row (e.g. "… is forecast_like_synthetic (row 11)"); no raw source records are
included. `steward-analysis/v1` keeps the request's origin as
`request.sourceSheet` (`Business_Requests` or `Team_Requests (team-authored)`)
and `request.teamAuthored`, without a row, so TEAM-REQ-01 (D18) is never shown
as Bayer data. Reuse candidates are cut to 5 with the same rule as discovery
(`presentCandidates`): if none of the top 5 is a complete match, the best one
takes the last slot, so the asset behind `reuse_candidates` is always shown. Validation errors pass through
both projections unchanged. Measured on the pack: REQ-0001 Nubeqa / Global
55 KB full → 12.3 KB view; a follow-up turn's model-visible replay is the view
(12.7 KB), because Mastra keeps the model output in
`providerOptions.mastra.modelOutput`. That copy doubles the browser-held
message (~25 KB); whether the model provider sends it on the wire is not
verified (no Anthropic provider package to inspect; no live run).

Future evidence detail (not built): the services are deterministic over the
read-only imported pack, so an endpoint such as
`GET /api/evidence/analysis?requestId=&product=&market=` or
`GET /api/evidence/kpi?kpiId=&product=&market=&month=&valueType=` can recompute
the full result with the inputs echoed in the view (`request.id`,
`clarification.resolved`, KPI `filters`) and return provenance on demand. Once
app-owned state (lifecycle, proposals) affects results, evidence must come from
the snapshot stored per proposal version (contract §6), not a recompute.

### Live orchestrator (T16B, provisional until agreed with Viet)

`src/mastra/agents/orchestrator-config.ts` holds the production prompt
(`ORCHESTRATOR_INSTRUCTIONS`) and governed tool map
(`createOrchestratorTools(getDb)`); `orchestrator.ts` binds them to the
server DB and adds `search-assets`. Production tools: `analyzeRequest`,
`computeKpi`, `checkKpiDefinitions`, `proposeBuild`, `searchAssets`.
`get-business-request` and `find-kpi-definitions` left the map (still
exported in `catalog-tools.ts`): `analyzeRequest` loads the request, and the
LIKE-based KPI check conflated Net Sales with Net Sales Growth.

| Tool (id / key) | Input | Calls | Output (model and UI) |
| --- | --- | --- | --- |
| `propose-build` / `proposeBuild` | `requestId`, optional `answer {product, market}` | `proposeBuild` (T17) at the lifecycle clock date (`ensureLifecycle` + `tick`, as `POST /api/builds`) | `build-proposal/v1`: `proposed` / `already_proposed` (proposal ID, insight ID, scope, KPIs, gaps, requester, approvers, request source label, `knownIssues`), `not_proposed` (recommendation, rationale), or `intent_required` |

Governance of `propose-build`:

- The service re-runs the steward analysis; only `build_proposal` with a
  resolved scope stores a `build_temporary` proposal. Clarification (an
  offered `answer` only) and eligibility stay in the services.
- Explicit intent (ours): the tool reads the latest user message from the
  agent context and stores nothing unless it asks to submit or propose a
  build (`SUBMIT_INTENT`, a narrow English pattern with a negation check).
  Outside an agent loop it refuses. This is a deterministic guard, not
  understanding: odd phrasing may need "Submit a build proposal for <ID>".
- No `requesterId` input: the chat has no identity, so the requester comes
  from the D12 region mapping (`team_mapping`). The model cannot choose the
  requester and so cannot steer the approvers.
- No approve, reject or register tool exists. A proposal is decided only in
  the approval inbox (`POST /api/proposals/:id/decision` → `decideBuild`).
- Service errors (unknown request, answer not offered, no requester) are
  tool errors; malformed input returns the validation object.
- Known T17 defect, not worked around: `build.ts` stores
  `{ sheet: "Business_Requests" }` as the request source, so a TEAM-REQ-01
  proposal's evidence and `build_proposed` audit row cite the Bayer sheet.
  The chat view labels the request from the loader (`Team_Requests
  (team-authored)`) and lists the defect in `knownIssues`; the inbox labels
  `TEAM-` IDs by prefix.

Chat UI: step labels and summaries for the new tools; when a
`propose-build` output is `proposed`, the chat calls the lifecycle context's
`refresh()` so the inbox shows it without a clock tick.

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

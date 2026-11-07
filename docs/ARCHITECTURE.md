# Architecture

Implementation snapshot: `43a1157d49702f8b7a285e8f82a4d2059554c584`
(`integrate/T24-scheduler`), inspected 2026-11-08. Later commits are outside this refresh.
Local `master` remains at `85c8494`. The already-available `origin/master` ref is
`a93248f46542165dd3a64be283b78e9a835e7ba4` (#37), whose committed tree exactly matches this
snapshot; B1–B4 are therefore also present in that mainline snapshot. No fetch was
performed.

This describes committed behavior. [SCOPE](SCOPE.md) and historical decisions
also contain targets; they do not imply every target is implemented.

## Runtime and boundaries

Next.js 16.4.5 App Router serves React 19.3 UI and route handlers. TypeScript
services use SQLite via `@libsql/client`; scheduler writes use dedicated
short-lived `libsql` connections. Recharts draws business charts. Pipeline
storyboard/diagram components are repository UI, not a selected React Flow stack.

```text
Employee: team dashboards + built insights + viewing-as usage
Manager: dashboards / catalog / estate + Agentic chat
                              Pipeline | Scheduler | Inbox
                                  |
Next.js routes / server catalog loader
                                  |
Mastra orchestrator -> request-pipeline workflow -> service facts
  tools: explore, compute, draft request, propose; no decision tool
                                  |
Deterministic steward | semantic | estate | build | lifecycle | pipeline
Separate manual scheduler -> overlap findings, never automatic approval
                                  |
SQLite: imported workbook tables + app-owned state/evidence/audit
```

`src/components/steward-app.tsx` controls visibility. Role and identity
selectors provide demo attribution only. [API](API.md) lists actual handlers;
there is no implemented generic assets API or lineage endpoint.

## Request execution

`src/mastra/index.ts` registers only `orchestrator`. Its tool map starts
`createRequestPipeline` for stored request IDs. The workflow steps are intent,
discovery, conflict, duplicate, recommend. Intent invokes `analyzeRequest`,
which already computes deterministic candidate/definition/computability facts;
subsequent steps expose those facts and check the lifecycle-aware estate.
Discovery and Conflict agents word short summaries with template fallbacks.
They do not independently search, adjudicate KPI definitions or compute values.
See [MASTRA](MASTRA.md) for registrations, tool names and command gates.

The workflow's analysis leg completes; human waits persist in app tables
`runs` and `run_events`, not Mastra suspend/resume snapshots. Build proposal,
build decision and reuse hooks continue the application run. The Pipeline view
polls `/api/runs/latest`; chat uses a separate AI SDK UI message stream.
Run events include `waiting_input` and `waiting_approval`. There is no
`POST /api/runs` or per-run SSE events route. This is not a unified stream of
lifecycle clock events and chat events.

## Services and persistence

| Source | Responsibility |
| --- | --- |
| `src/services/steward` | Load pack/team/chat requests, resolve scope, canonical KPI checks, catalog candidates, computability gate |
| `src/services/semantic` | Whitelisted mapping and calculations with units, filters, SQL/args and source rows |
| `src/services/estate` | Catalog plus app-built assets and lifecycle state; duplicates, merges, restore offers, portfolio |
| `src/services/build` | Revalidate build/reuse, persist proposals, compute approved insight and provenance |
| `src/services/lifecycle` | Clock, leases, usage, proposals/decisions, TTL, escalation, archive/restore, audit |
| `src/services/pipeline` | Request run state and ordered events, continuation hooks |
| `src/services/scheduler` | Manual incremental overlap detection and known-finding reassessment |
| `src/lib/catalog.ts` | Server loader separating estate metadata from business facts for dashboard UI |

The imported workbook tables remain source records, including catalog assets,
KPI/model/owner metadata, lineage, usage and product facts. App state lives in
`asset_state`, `usage_events`, `proposals`, `audit_log`, `insights`, clock,
`chat_requests`, request runs/events and `scheduler_*` tables. Schema creation
is lazy through service initializers. Audit update/delete triggers protect the
current generation; a deliberate demo reset drops app tables, including audit
and scheduler state, then reseeds. It is not an immutable cross-reset archive.

Build values are stored only after approval with their provenance. Chat/model
views omit structured SQL and row-level references; built insight detail can
show that stored evidence. Imported lineage remains catalog edges. There is no
complete interactive lineage graph/on-demand evidence API or automatic proof
that an imported dashboard uses the business fact calculations.

## Search and coverage limits

`steward/discovery.ts` ranks catalog candidates by mapped approved/variant
KPIs, scope fit and endorsement with explicit team-authored weights. It still
reads imported `Analytics_Assets`, independently of app lifecycle state.
`estate` search/duplicate checks cover app-built and archived assets separately.
Do not claim the catalog candidate list is fully lifecycle-aware. Hybrid
keyword/local vector terminology appears in the UI and estate tools; it does
not mean external embeddings, a vector database, or that every retrieval path
uses TF-IDF. Catalog period, dimensions, filters and answer fitness remain unknown.

## Governance and monitoring

[Governance](GOVERNANCE.md) specifies supported KPIs, approvers, lease policy
and gaps. Numbers and mutations come from services; the model has no approve,
reject, register or direct archive tool. HTTP routes remain directly callable
in this unauthenticated demo, so chat command gates are not API authorization.

B0 comparator (`estate/merge.ts`) is in the mainline ancestry. B1 incremental
monitoring, B2 reassessment, B3 gated proposal bridge and B4 Scheduler UI are
present on this integration snapshot. Both job descriptors permit manual
triggers only. Neither runs on clock advancement or a background timer.

Incremental scans audit IDs since its committed checkpoint, watching
`temporary_registered`, `insight_built`, `restored`, `promoted`. It records
eligible overlap findings using the estate merge comparator. It does not sweep
the full estate or close vanished overlaps. Reassessment rechecks only open or
dismissed findings, resolves vanished overlaps and reports stale proposals
without changing them. `superseded` is reserved but never produced.

One finding-writing run can be active at a time. Claim, evaluation and atomic
commit/checkpoint stages prevent partial success; failures do not advance the
checkpoint. A stuck run requires manual abandon with a reason, with no automatic
timeout. Findings preserve latest observation and separate dismissed evidence,
not every historical observation. Source changes outside app audit are invisible.
Finding proposal previews exist but submission always returns 409 pending
`MERGE-APPROVERS` and `CODEX-REVIEW`. The merge approver fix is committed but
independent review remains required. Certified replacement policy is unresolved.

## Configuration and operating limits

See [README](../README.md#run-locally) for installation and actual environment
variables. Lifecycle time advances via `tick` on service/HTTP activity and UI
polling, with one simulated day per second when running. Forward advancement
processes due lifecycle events in order. It is separate from manual monitoring.
No external BI API, production scheduler, authenticated user sessions or server
chat-history store is implemented. See [DEMO](DEMO.md) for a disposable reset
and deterministic fallback; recorded replay is a proposed fallback, not a feature.

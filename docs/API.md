# HTTP API

Implementation snapshot: `1beff2ebd1e4df5393bc6b065795ca1ddb845edc` (`origin/master`, T26 merged in #38),
verified 2026-11-08. Original refresh baseline: `43a1157`; reconciled against the
committed final master revision. Local `master` is stale and was not moved.

Routes below are verified against `src/app/api/**/route.ts`. Paths use `:id`
for a dynamic segment. Bodies are JSON unless noted. These are local demo
endpoints without authentication; acting identities are caller supplied.

## Application routes

| Method and path | Request | Result / purpose |
| --- | --- | --- |
| POST `/api/chat` | AI SDK UI message parameters | Stream via Mastra orchestrator; 503 without API key |
| POST `/api/builds` | `requestId`, optional `answer: {product, market}`, `requesterId` | Reanalyse and propose eligible build; not a built insight |
| POST `/api/reuse` | `requestId`, `assetId`, optional `answer` | Revalidate candidate; log requester usage and reuse audit |
| GET `/api/proposals` | — | `{proposals}` open/escalated inbox |
| POST `/api/proposals/:id/decision` | `actor`, `action: approve\|reject`, optional `reason` (required for reject) | Build service or lifecycle decision; no edit action/version input |
| GET `/api/lifecycle` | — | Clock, pending proposals, counts, portfolio comparison, audit, app usage and people for UI |
| POST `/api/lifecycle/reset` | — | `{ok: true}`; reset/reseed app tables, including audit, runs and scheduler; imported tables unchanged |
| GET `/api/clock` | — | Clock / next lifecycle due event |
| POST `/api/clock/pause` | optional `actor` | Pause, default actor manager |
| POST `/api/clock/resume` | optional `actor` | Resume simulated clock |
| POST `/api/clock/advance` | `days` or `toNextEvent: true`, optional `actor` | Forward lifecycle processing |
| POST `/api/usage` | `assetId`, `viewerId` | `{state}` after app usage; archived opens refused |
| GET `/api/assets/:id/audit` | — | Asset audit timeline |
| POST `/api/assets/:id/restore` | `actor`, optional `reason` | `{state}` restored with fresh lease/TTL |
| GET `/api/runs/latest` | — | `{run}` latest application request run and events |
| GET `/api/runs/:id` | — | `{run}` or 404 |

Lifecycle wrappers initialize state and tick before handling operations. Known
lifecycle errors map not-found→404, not-allowed→403, invalid→400; other caught
failures return 500 `{error}`. This is not a promise of one global error format:
chat and scheduler use separate handlers, and some input parsing is outside the
wrapper. Inspect the route for exact payloads before writing clients.

There is no `POST /api/runs`, `/api/runs/:id/events`, generic `/api/assets`,
`/api/assets/:id/lineage`, `/api/portfolio` or on-demand evidence route.
Catalog/dashboard data is loaded server-side, and run events are polled.

## Scheduler routes (B1–B5, merged master)

| Method and path | Input | Purpose |
| --- | --- | --- |
| GET `/api/scheduler` | — | Job descriptors, checkpoints, run/finding counts |
| GET `/api/scheduler/simulated` | — | Stored `simDate`, `settings`, per-job last evaluation and due preview; does not tick |
| POST `/api/scheduler/simulated` | `actor` | `{result: {simDate, source, decisions}}`; check due jobs at stored date, no clock movement |
| GET `/api/scheduler/runs` | optional `limit`, `jobId` query | Run history |
| POST `/api/scheduler/runs` | `actor`, optional `jobId` | Synchronous run now; default `incremental_overlap`; alternative `periodic_reassessment` |
| GET `/api/scheduler/runs/:id` | — | Run detail/window/assessments/error |
| POST `/api/scheduler/runs/:id/abandon` | `actor`, `reason` | Recover a stuck running job |
| GET `/api/scheduler/findings` | optional `status`, `assetId`, `limit` query | Findings; status open/dismissed/resolved/superseded/any |
| GET `/api/scheduler/findings/:id` | — | Finding detail, current evidence and proposal outcome |
| POST `/api/scheduler/findings/:id/dismiss` | `actor`, `reason` | Suppress unchanged evidence, not resolve asset governance |
| GET `/api/scheduler/findings/:id/proposal` | optional `sourceId`, `targetId` query | Read-only direction/eligibility preview, `enabled: false` and blockers |
| POST `/api/scheduler/findings/:id/proposal` | disabled | Always 409 with `MERGE-APPROVERS`, `CODEX-REVIEW`; no proposal created |

Run/dismiss/abandon and simulated-check writes require `SCHEDULER_DEMO_ACTIONS=1` and
`actor: "manager"` before DB access. Errors use `{error}` and 400/403/404/409.
A completed run can return 200 with status `failed`: inspect the status and
`error.code` (`evaluation_failed` / `commit_failed`). Conflict may also report
`outcome: abandoned|reset|unrecorded`, run ID and original failure. An unrecorded
failure can leave a running row that needs manual abandon. Concurrent
finding-writing jobs return 409. Reads expose current findings and derived
proposal outcomes; `superseded` is accepted but not generated.

## T26 simulated-date behavior

GET `/api/scheduler/simulated` returns `settings: {autoOnClock, reassessEveryDays}`
and `jobs[]` with `jobId`, `last` (nullable evaluation: date, decision, reason,
run ID, source, update time), and `due: {due, reason, pendingChanges?, nextOn?}`.
Scheduler routes return 409 before lifecycle initialization: open the app once
first. GET can initialize scheduler tables but does not tick lifecycle.
The POST requires `SCHEDULER_DEMO_ACTIONS=1` and demo actor `manager`; it works
without `SCHEDULER_SIM_TRIGGER=1`. Source is `manual_check`.

With **both** flags enabled, POST pause/resume/advance (including toNextEvent)
adds `scheduler: {simDate, source: clock_action, decisions}` or `{error}` to the
existing clock response. A stored clock action remains successful (200) even
when scheduler evaluation fails/deferred. Check each decision and run status;
HTTP 200 alone does not prove monitoring succeeded. Flags off: clock response
retains its old shape. GET clock/lifecycle and ordinary ticks never run jobs.

Each decision contains `jobId`, `decision` (ran/not_due/already_processed/deferred),
`reason`, nullable `run`. Failed runs returned as `ran` can retry; successful
simulated runs deduplicate by job/date. New changes later that day wait for the
next date or manual Run now. Busy finding writers/clock movement can defer.
Checks do not replay intermediate fast-forward dates. See
[governance](GOVERNANCE.md) for due policy and optional demo cadence.

Operator CLI (export custom database/settings; no HTTP demo gate):

```sh
npx tsx src/services/scheduler/cli.ts sim-status
npx tsx src/services/scheduler/cli.ts sim
```

These are status/check commands at the stored date, not a background scheduler.

## Deterministic build example

On your disposable imported demo database with the server running:

```sh
curl -sS -X POST http://localhost:3000/api/builds \
  -H 'Content-Type: application/json' -d '{"requestId":"TEAM-REQ-01"}'
```

Read the returned proposal and required approvers. In the UI, select one of
those people and approve in Inbox. Do not use a guessed approver ID. This route
does not need the chat command gate or a model key. See [DEMO](DEMO.md).

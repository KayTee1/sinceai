# HTTP API

Implementation snapshot: `43a1157d49702f8b7a285e8f82a4d2059554c584`
(`integrate/T24-scheduler`), inspected 2026-11-08. Later commits are outside this refresh.
Local `master` remains at `85c8494`. The already-available `origin/master` ref is
`a93248f46542165dd3a64be283b78e9a835e7ba4` (#37), whose committed tree exactly matches this
snapshot; B1–B4 are therefore also present in that mainline snapshot. No fetch was
performed.

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

## Scheduler routes (B1–B4, integration snapshot)

| Method and path | Input | Purpose |
| --- | --- | --- |
| GET `/api/scheduler` | — | Job descriptors, checkpoints, run/finding counts |
| GET `/api/scheduler/runs` | optional `limit`, `jobId` query | Run history |
| POST `/api/scheduler/runs` | `actor`, optional `jobId` | Synchronous run now; default `incremental_overlap`; alternative `periodic_reassessment` |
| GET `/api/scheduler/runs/:id` | — | Run detail/window/assessments/error |
| POST `/api/scheduler/runs/:id/abandon` | `actor`, `reason` | Recover a stuck running job |
| GET `/api/scheduler/findings` | optional `status`, `assetId`, `limit` query | Findings; status open/dismissed/resolved/superseded/any |
| GET `/api/scheduler/findings/:id` | — | Finding detail, current evidence and proposal outcome |
| POST `/api/scheduler/findings/:id/dismiss` | `actor`, `reason` | Suppress unchanged evidence, not resolve asset governance |
| GET `/api/scheduler/findings/:id/proposal` | optional `sourceId`, `targetId` query | Read-only direction/eligibility preview, `enabled: false` and blockers |
| POST `/api/scheduler/findings/:id/proposal` | disabled | Always 409 with `MERGE-APPROVERS`, `CODEX-REVIEW`; no proposal created |

Run/dismiss/abandon writes require `SCHEDULER_DEMO_ACTIONS=1` and
`actor: "manager"` before DB access. Errors use `{error}` and 400/403/404/409.
A completed run can return 200 with status `failed`: inspect the status and
`error.code` (`evaluation_failed` / `commit_failed`). Conflict may also report
`outcome: abandoned|reset|unrecorded`, run ID and original failure. An unrecorded
failure can leave a running row that needs manual abandon. Concurrent
finding-writing jobs return 409. Reads expose current findings and derived
proposal outcomes; `superseded` is accepted but not generated.

## Deterministic build example

On your disposable imported demo database with the server running:

```sh
curl -sS -X POST http://localhost:3000/api/builds \
  -H 'Content-Type: application/json' -d '{"requestId":"TEAM-REQ-01"}'
```

Read the returned proposal and required approvers. In the UI, select one of
those people and approve in Inbox. Do not use a guessed approver ID. This route
does not need the chat command gate or a model key. See [DEMO](DEMO.md).

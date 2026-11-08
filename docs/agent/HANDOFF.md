# Handoff

## Demo readiness (`fix/demo-readiness`, 2026-11-08)

Base `origin/master` 3cdfb60. Fixes demo blockers only. No new features, and no change to
approval rules, KPI math, governance or the scheduler. PR open against master, awaiting
independent Codex review; not merged. Cinematic demo PR #40 is untouched.

- **Chat errors:** `/api/chat` passes `onError` to `handleChatStream` (and wraps
  pre-stream failures) through `src/lib/chat-error.ts`. The user sees one short message
  (no credit, bad key, rate limit, unavailable or other). The server logs kind, status,
  URL and a shortened message, never the request body, headers or stack. `readError` in
  chat-view refuses to show JSON or stack text.
- **Provenance label:** `MAPPING_LABEL` now reads "team-authored, proposed; not yet
  approved", with no personal name. D14 is still proposed in DECISIONS. Insights built
  before this change keep their stored label.
- **Inbox refresh:** the inbox re-reads the lifecycle snapshot when opened and when the window
  regains focus or visibility. Previously, while the clock was paused, a proposal created
  outside the tab (API, another window) did not appear.
- **Fallback CLI:** `src/mastra/workflows/request-pipeline-cli.ts` runs the real request
  pipeline with template summaries (no model), so the Pipeline view works offline.
  Always present it as a fallback, never as live AI.
- **Runbook:** `docs/DEMO-RUNBOOK.md`: TEAM-REQ-01, about 3:40, model preflight with
  GO/NO-GO. Preflight on 2026-11-08 returned 400 (no credit): NO-GO until the account is funded.
- **Validation:** `PACK_XLSX=data/private/pack.xlsx npm test` 368/368 (4 new),
  `npx tsc --noEmit`, `npm run lint` and `npm run build` pass after all changes. Browser checks on
  a production build covered the friendly error, the inbox after an out-of-band proposal,
  the fallback pipeline, approval, the provenance label, Next event, +30d, reject with a reason
  and the before/after strip (53 renewed · 43 escalated · 1 expired · 1 built · 1 rejected).
- **Open:** fund the Anthropic account and rerun the preflight. Scheduler B3 blocker text
  still names Viet (`src/services/scheduler/proposals.ts`, not on the demo path). Mastra's
  own logger prints the upstream error to the server console (not to users).

## Previous snapshot (unchanged)

Implementation snapshot: `1beff2ebd1e4df5393bc6b065795ca1ddb845edc` (`origin/master`, T26 merged in #38),
verified 2026-11-08. Original refresh baseline: `43a1157`; reconciled against the
committed final master revision. Local `master` is stale and was not moved.

- Owner approved the documentation refresh. Worktree:
  `/private/tmp/sinceai-docs-refresh`; branch `docs/mvp-repository-refresh`.
  Active developer checkouts and dirty REVIEW were not modified.
- README, architecture, Mastra, API, governance and demo now distinguish
  committed behavior from targets. Scope/requirements carry a snapshot status;
  decisions and historical task IDs/approval states are retained.
- Current flow: one registered Mastra orchestrator, two local summary helpers,
  deterministic services, application-table run waits and polled Pipeline.
  No Mastra snapshot approval pause, agent approval tool or production auth.
- B0 is in mainline ancestry. B1/B2 jobs support manual and explicit simulated-date checks; B3 POST
  remains 409 (`MERGE-APPROVERS`, `CODEX-REVIEW`), B4 UI is implemented.
  Merge approver fix is committed but still needs independent review.
  Personal/Team replacing Certified policy remains unresolved.
- Lifecycle: 30-day Temporary TTL, 90-day leases, used owned assets auto-renew;
  unanswered 14-day retire reviews escalate (D16), never silently archive.
  Audit protects normal writes but demo reset intentionally drops app audit.
- Open limits: catalog-only discovery vs lifecycle-aware estate checks,
  provisional D14/D15 mapping, unsupported KPIs, incomplete lineage graph,
  edit/reassign/certification gaps, live model acceptance, source/external AI
  terms and video/submission requirements. Synthetic sprawl is still planned.
- Owner confirmed final MVP integration and authorized merging master into the docs
  branch, pushing and opening a PR against master. Remote master verified by fetch:
  `1beff2ebd1e4df5393bc6b065795ca1ddb845edc` (#38, T26). Local master was not moved.
- T26 reconciled without a fresh repository audit: both demo flags enable checks
  after explicit clock actions; Check due jobs uses only the action gate. No cron,
  background worker or free-running tick trigger. Same-day success deduplicates;
  failure retries; busy writer/clock move defers; new same-day changes remain pending.
  Clock state persists on scheduler failure. API has GET/POST scheduler/simulated;
  UI shows status, last decisions and error/deferred notices. D26 retained verbatim.
- Integration conflicts from the squash history retained exact final-master source
  and tests. Final PR diff must contain only the 12 approved documentation paths.
- Validation: 28/28 route method/path registrations match API inventory;
  44 relative links/heading anchors, npm scripts, lockfile, environment names and registered
  tool IDs checked. `git diff --check` passed; complete approved-file diff reviewed.
  No paid model calls, shared DB use, workbook import or app tests run. No source,
  tests, configuration, datasets, historical proposal/HTML or REVIEW changed.
- Next: human reviews the documentation PR; independent implementation gates and
  Certified replacement policy remain unresolved. No PR merge is authorized.
  No remaining T26 documentation discrepancy is known after source verification;
  live model, browser and workbook scenarios still require owner rehearsal.

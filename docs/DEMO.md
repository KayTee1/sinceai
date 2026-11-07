# Demo runbook

Implementation snapshot: `43a1157d49702f8b7a285e8f82a4d2059554c584`
(`integrate/T24-scheduler`), inspected 2026-11-08. Later commits are outside this refresh.
Local `master` remains at `85c8494`. The already-available `origin/master` ref is
`a93248f46542165dd3a64be283b78e9a835e7ba4` (#37), whose committed tree exactly matches this
snapshot; B1–B4 are therefore also present in that mainline snapshot. No fetch was
performed.

## Prepare a disposable demo

Follow [README setup](../README.md#run-locally) in a separate checkout/database.
Use the approved workbook locally and export a unique `DATABASE_FILE` for import
and server if overriding the default. Never reset a shared developer database.
The in-app Reset demo / `POST /api/lifecycle/reset` clears app state, runs,
insights, scheduler data and audit, then reseeds; it leaves workbook tables.
It is not a workbook reimport. Reset clock is paused at 2026-11-01.

Live chat needs a valid Anthropic key and configured model access. Rehearse
before recording: this refresh did not execute live chat, browser flows or pack
checks. If the model is unavailable use the deterministic HTTP build below;
there is no implemented recorded-event replay player. Label all values synthetic.

## Build with evidence (main story)

1. Employee: choose a viewing identity/team, open a catalog dashboard and show
   the synthetic wallboard. Explain that catalog metadata and business facts
   are separate; these are not live Power BI dashboards.
2. Manager → Agentic: ask `Analyse TEAM-REQ-01`. The team-authored request is
   net sales and forecast variance for Xarelto in North America. Watch Pipeline
   (Storyboard or Diagram), then show the gap and supported approved KPIs.
3. Press Submit build proposal, or type exactly
   `Submit a build proposal for TEAM-REQ-01`. It waits for a Lead; nothing has
   been built yet. Read actual approvers from Inbox rather than guessing IDs.
4. Acting as a listed Lead, approve. Open the resulting Temporary insight in
   Dashboard; show TTL and click a value for formula, filters, query and source
   rows. Capture it before an owner open promotes it to Personal.
5. Show audit timeline and manager before/after counts. Do not claim counts
   prove conflicts were resolved or quantify monetary savings.

Deterministic fallback (same services, no model call):

```sh
curl -sS -X POST http://localhost:3000/api/builds \
  -H 'Content-Type: application/json' -d '{"requestId":"TEAM-REQ-01"}'
```

Then approve in Inbox as above. A direct API build does not itself demonstrate
the Mastra analysis workflow or a complete request Pipeline run. A prior
pending/built duplicate can block a second proposal; use a fresh demo reset
rather than describing duplicate suppression as an error.

## Reuse and clarification

Ask `Analyse REQ-0026`, inspect returned candidates and unknown coverage, then
press Use this on an offered asset. Verify the logged usage/audit rather than
claiming an automatic approval. Exact assets depend on reset state.
Ask `Analyse REQ-0001` to show text/context clarification and KPI-004 vs KPI-005
conflict. Choose an offered product/market; do not promise a build from this
request: missing data and partial coverage can correctly stop it.

## Lifecycle with human decisions

Pause the clock; advance to next lifecycle event or +90 days. Show an automatic
renewal for used, owned assets or a retire review for unused ones, depending on
the seeded asset. Reject a retire with a reason to keep it and renew its lease.
For a separate pending review, advance through its 14-day deadline: it escalates
to a steward, it does not silently archive. Approve an eligible retire, then
Restore as an authorized identity; inspect timeline and new lease.

For Temporary expiry, use a fresh build, avoid opening as owner or generating
three non-owner in-region views, and advance 30 days. Otherwise promotion or a
pending Team proposal changes/holds TTL. Only a separate reset can rewind time.

## Monitoring B0–B4 (verified snapshot)

Start with `SCHEDULER_DEMO_ACTIONS=1` and restart server. In Manager → Agentic →
Scheduler, run Incremental overlap check as the demo manager after a build,
restore or promotion. The audit checkpoint and assessments explain what was
considered. A valid zero-findings result is possible: do not invent overlap.

If a finding exists, inspect evidence, dismiss with a reason and run again:
unchanged evidence stays dismissed. Run Periodic reassessment manually to
recheck open/dismissed findings after lifecycle changes. Show resolution only
when the recorded pair no longer qualifies. It is not a full-estate scan and
clock advance does not run either job. If a run is stuck, inspect it and use
Abandon with a reason; there is no stale-run timeout.

Finding-to-proposal submission is disabled. Explain the review blockers and
human authority instead of promising a working proposal button. For a merge
demo through chat, rehearse a comparator-supported pair separately and obtain
both sides' required approvals; do not guess a universally eligible pair.

## Recording and submission

Suggested short cut: employee dashboard → TEAM-REQ-01 build proposal → Lead
approval → computed provenance → lease escalation/audit. Monitoring can be a
separate segment. Portal video limit, IP/source redistribution and external AI
terms remain unknown; confirm with the owner/organizers. Do not expose keys,
local private workbook contents or claim production integrations. Include AI
tool disclosure and the exact demonstrated implementation revision.

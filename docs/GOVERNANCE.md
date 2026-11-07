# KPI and asset governance

Implementation snapshot: `43a1157d49702f8b7a285e8f82a4d2059554c584`
(`integrate/T24-scheduler`), inspected 2026-11-08. Later commits are outside this refresh.
Local `master` remains at `85c8494`. The already-available `origin/master` ref is
`a93248f46542165dd3a64be283b78e9a835e7ba4` (#37), whose committed tree exactly matches this
snapshot; B1–B4 are therefore also present in that mainline snapshot. No fetch was
performed.

## KPI definitions and calculations

The pack catalog supplies definition/status metadata, not executable SQL.
`src/services/semantic/d14-mapping.ts` is our provisional team-authored D14
mapping, still labelled pending agreement. Definition checking groups canonical
metrics and approved/variant definitions; KPI-004 vs KPI-005 is a conflict,
not a license to substitute either formula or invent a monetary discrepancy.

| KPI | Implemented formula / unit | Limits |
| --- | --- | --- |
| KPI-001 Net Sales | Sum `net_sales_m_eur_syn`, M EUR | Mapping expects catalog unit EUR; output explicitly M EUR |
| KPI-004 Net Sales Growth | `(sum current - sum previous) / sum previous * 100`, % | Same cells/value type; prior month required; zero base undefined |
| KPI-042 Forecast Variance | Sum net sales minus sum forecast, M EUR | Absolute variance, not `forecast_variance_pct` |
| KPI-027 Market Access Coverage | `market_access_coverage_pct_syn`, % | One product/market cell; no invented denominator or aggregate average |

KPI-014, KPI-016, KPI-020, KPI-006 and KPI-054 are explicitly unsupported by
the current mapping implementation. Other unmapped/unapproved KPIs are not
silently computed. Results are `computed`, `unsupported`, `insufficient_data`;
analysis can additionally report incomplete coverage. Results carry filters,
month, value type, units, formula, SQL/arguments and source rows.

`Product_Market_Monthly` has product×market×month rows. Value type belongs to
the row; actual-like and forecast-like values are never blended. Alternating
row types can make growth unavailable. Build eligibility probes the latest
fact month with actual-like data and requires every requested approved KPI to
compute for every requested market. Historical month selection is not inferred
from the request text. No model-generated calculation is persisted as a KPI.

## Build, reuse and authority

A build re-runs analysis and estate duplicate checks. Only eligible gaps become
`build_temporary` proposals; values are computed and persisted on Lead approval,
then registered Temporary. The requester is excluded from build approvers.
Chat has no authenticated requester input: the region mapping supplies it.
The direct API permits an optional requester ID. Team/chat request origin is
stored in evidence; imported requests and records remain separate.

Reuse confirmation validates the listed candidate against fresh analysis,
logs mapped requester usage and `reuse_confirmed`; it is not a Lead approval.
Archived candidates cannot be used. Catalog discovery itself still ignores
lifecycle state; estate checks do not make every catalog recommendation current.

| Action | Implemented decision boundary |
| --- | --- |
| Build Temporary | Active Lead in requester's region, excluding requester |
| Temporary → Personal | Automatic on owner app open; owner unchanged |
| Temporary → Team | Three distinct in-region non-owner viewers trigger proposal; active regional Lead other than owner decides (steward fallback); TTL held while pending |
| Lease review | Used with active owner auto-renews; otherwise retire review / steward escalation |
| Retire / renew | Required owner or escalated regional steward; reject needs reason; rejecting retire renews |
| Merge | Active approver for each side: owner, otherwise regional steward; both sides required; one person can represent both |
| Restore | Active owner or regional steward; direct human operation, not restore proposal |

Merge proposal creation refuses if either side lacks an approver. Approval also
refuses old stored merge evidence missing either side's required approver.
Each approval is retained; last required approval archives the source and
records a redirect; target coverage/active state is revalidated. One rejection
closes the merge. Merge proposals have no expiry/escalation deadline.
Do not describe redirect evidence as a rewrite of imported lineage edges.

Current proposal types: renew, retire, promote, build_temporary, merge.
Current statuses: open, escalated, approved, rejected, expired. Asset status is
active, lease_due or archived; merged sources are archived, not a separate
`merged` status. Proposal edits/resetting approvals, a reassign-owner proposal,
and a complete Team→Certified flow are not implemented.

## Clock, usage and leases

Reset starts paused at 2026-11-01. Running means one simulated day per real
second when ticks are processed; fast-forward is forward-only and handles due
lifecycle events in order. UI polling/requests drive ticks, not a durable worker.
Temporary TTL is 30 days; Personal/Team/Certified leases are 90 days. Imported
leases are seeded from last-modified dates. Restore returns the previous tier
with a fresh lease, or a fresh TTL for Temporary.

At lease review, used means any app view in the last 90 days or average pack
monthly users at least 10 for months in that window. Pack telemetry and app
opens stay separate: monthly audiences cannot be summed into distinct people.
The pack ends October 2026, so it eventually ages out of the review window.
Used assets with active owners auto-renew; used assets lacking an active owner
go to the steward. Unused assets enter retire review. After 14 days of silence,
review escalates to the region's data steward (Global for Asia Pacific).
**Silence never archives a lease-reviewed asset (D16).** Unused Temporary TTL
expiry is a separate automatic policy transition. Historical default-archive
language in early decisions and requirements is superseded by D16.

## Monitoring is evidence, not permission

B0 merge comparisons can suggest merge, keep_both or partial based on scope,
KPIs, tier and dashboard usage. Usage is never per-metric evidence.
B1/B2 jobs are manually run, deterministic and non-LLM. They create/refresh
findings or resolve obsolete overlaps, never decide proposals or alter KPI
approvals. Dismissal suppresses unchanged evidence; material fingerprint change
can reopen it. Unknown/unsupported comparisons are not a clean bill of health.

B3's finding-to-proposal module and read-only preview exist, but HTTP submission
is disabled until independent reviews clear `MERGE-APPROVERS` and
`CODEX-REVIEW`. A Personal/Team asset replacing Certified is blocked pending
policy. B4 provides the Scheduler tab. There is no automatic governance job
on clock advance, full-estate sweep or source refresh monitoring here.

## Audit and prototype trust

Audit append-only triggers protect normal operation; proposal/state operations
store actor, reason and evidence. Demo reset intentionally replaces app state
including audit, findings and runs, so export/retain evidence separately if
needed. Finding observations are not a complete history: only latest evidence
and separate dismissal evidence survive. Source tables are not approval records.

Role toggle and acting/viewing pickers are demo identity controls. No SSO,
production RBAC, regulatory certification, live BI write or patient-level
processing is implemented. External AI/source redistribution permission remains
unknown; compact model views still contain catalog/request data. See
[requirements](REQUIREMENTS.md) for preserved targets and [decisions](DECISIONS.md)
for their history.

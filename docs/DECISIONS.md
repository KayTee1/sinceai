# Decisions

Only consequential choices (challenge, approach, stack, contract, cuts).

```text
D<n>: Title (YYYY-MM-DD)
Status: proposed / accepted / replaced by D<n>
Choice and why:
Alternatives considered:
Agreed by:
```

D1: Challenge: Bayer BI lifecycle (2026-11-06)
Status: accepted
Choice and why: Bayer's challenge on analytics sprawl and the BI lifecycle.
Alternatives considered: other company challenges.
Agreed by: Viet, KayTee

D2: Approach: Analytics Steward (2026-11-06)
Status: replaced by D5 (the pack has no KPI formulas, so conflicts are
definitional, not SQL-computed numbers)
Choice and why: an agent that proposes reuse before build, explains metric
conflicts with SQL-computed numbers, runs 90-day ownership leases, and logs
every proposal and decision. Full scope in docs/SCOPE.md.
Alternatives considered: none recorded.
Agreed by: pending

D3: Stack (2026-11-06)
Status: replaced by D7
Choice and why: Python + FastAPI, SQLite or DuckDB, Claude API with tool use,
in-memory embeddings, Next.js or Streamlit, Recharts or Plotly. Simple, one
file of data, real SQL for the conflict explainer.
Alternatives considered: Streamlit-only for speed.
Agreed by: pending

D4: Narrow first demo and clarify governance (2026-11-06)
Status: replaced by proposed D5; SQL fixture assumption unsupported by final pack
Choice and why: P0 is intake, reuse, SQL metric comparison, versioned human
approval, applied reconciliation and audit. Lifecycle and simulated time move to
P1. Expiry flags review; archive requires approval. Scores are explained ranking
heuristics; conflict counts use explicit metric pairs. Approval requirements are
snapshotted per version; edits require fresh approvals.
Alternatives considered: full lifecycle in P0; automatic archiving on expiry.
Agreed by: pending. KayTee requested documentation fixes; final scope, stack and
interface still need team agreement after the briefing.

D5: Rebase draft scope on final brief and Pharmaceuticals pack (2026-11-06)
Status: proposed; stack replaced by D7, lifecycle placement by D9
Choice and why: KayTee requested source intake. CHALLENGE/DATA_SOURCES record
confirmed facts. Revised SCOPE uses supplied BI estate and source-cited evidence;
Pharmaceuticals replaces Crop Science, and KPI ambiguity replaces unsupported
four-variant SQL attribution. Migration and lineage become explicit context.
Synthetic data is confirmed acceptable; evaluation weights and deliverables
are known. No official ground truth, KPI formulas or 90-day requirement exists.
Alternatives considered: retain custom generator; add a separately labelled SQL
fixture later. Existing stack choices remain pending.
Agreed by: pending for design/contract. Source facts are evidence, not a team vote.

D6: Lineage drill-down in P0 (2026-11-06)
Status: accepted
Choice and why: Bayer rule 4 asks for upstream/downstream lineage. Users can
click any chart, number or candidate asset to see its lineage graph and how it
was traced (edge rows, stored query, source rows). Builds trust and shows
governance in the demo.
Alternatives considered: lineage only as text inside proposals.
Agreed by: Viet. Refined by KayTee's lineage limits (see D10): imported
assets show catalog edges only; app-computed values show their actual query;
no distinct-audience claims across assets or months.

D7: Stack: TypeScript, Next.js + Mastra + SQLite (2026-11-06)
Status: accepted
Choice and why: whole project mainly TypeScript. Next.js serves both tabs and
the API routes; Mastra builds the agent layer (agents, tools, workflow with a
human-approval pause); SQLite via libSQL, which Mastra supports. Claude via
Mastra model routing. One repo, one language, quick to change.
Alternatives considered: Python + FastAPI (D3); Vite React + separate Mastra
server.
Agreed by: Viet

D8: UI layout and roles (2026-11-06)
Status: accepted
Choice and why: one full-screen app. Top middle: Agentic | Dashboard tabs. Top
right: Employee / Manager toggle (simulated RBAC). Employee sees only the
Dashboard and only browses (no questions to agents). Manager sees everything:
Agentic tab with a switch between a responsive Chat view (streamed step states)
and a visual Pipeline view of the Miro agent layer + platform services, plus the
approval inbox and clock. Keeps the employee experience as simple as possible.
Alternatives considered: employee ask bar; chat-only Agentic tab.
Agreed by: Viet

D9: Miro lifecycle is P0, with a simulated clock (2026-11-06)
Status: accepted. Supersedes the P2 placement in D5.
Choice and why: the Miro lifecycle (Temporary TTL 30d → Personal → Team →
Certified, 90-day lease, owner review renew/merge/retire, default archive,
restore) is the core of the pitch. Bayer's pack has only monthly usage totals,
so promotion uses seeded, labelled team-synthetic per-user usage events; pack
data stays read-only next to app-owned tiers. Fast-forward shows 90 days in
seconds.
Alternatives considered: simplified states without a clock; keep at P1/P2.
Agreed by: Viet

D10: Shared workspaces and Miro diagram review (2026-11-06)
Status: accepted with two exceptions (see D9, D11). Proposed by KayTee as D7
in PR #7; renumbered because D7–D9 were already taken.
Choice and why: one application; dashboard and agentic workspaces share one
catalog, evidence service, proposal store and audit trail. Accepted: approval
authority follows the proposal's required approvers (owner / team lead /
steward), not workspace access; source audience, endorsement and lifecycle
fields stay separate from app tiers; app open events stay separate from
imported usage; lineage limits in SCOPE; store evidence and concise rationale,
not private reasoning; no claim of warehouse, live telemetry or query costs.
Not accepted: "expiry/silence never auto-archives" (Viet keeps D9, with
mitigations in SCOPE) and "one orchestrator only in P0" (see D11).
Alternatives considered: independent systems; automatic archive; full agent set.
Agreed by: Viet (exceptions decided 2026-11-06); KayTee proposed

D11: P0 agent set (2026-11-06)
Status: accepted
Choice and why: middle ground between six agents (our scope) and one
orchestrator (KayTee). P0 Mastra agents: Orchestrator (with intent parsing),
Discovery, Conflict detector, so the Pipeline view shows a real multi-agent
run. Builder and Lease steward agents move to P1; in P0 a deterministic build
tool renders the Temporary insight and the lifecycle engine runs lease reviews.
Alternatives considered: all six agents in P0; one orchestrator only.
Agreed by: Viet

D12: Resolve scope contradictions; real-time simulated clock (2026-11-06)
Status: proposed (KayTee). Refines D8, D9 and D10; needs Viet's agreement
because it changes the contract (clock, decision actor, asset state, runs).
Choice and why:
- Pitch: "a human approves every change" contradicted D9 auto-archive. D9
  stays; the wording becomes "agents propose, humans decide; silence has a
  logged, reversible policy default".
- Who asks: employees still don't ask (D8). The manager runs a request on a
  named requester's behalf. `Business_Requests` has no requester field, so the
  requester is picked from the pack's owners and labelled as our mapping. The
  requester owns the resulting Temporary insight.
- Approval: the manager picks an "acting as" identity; Approve is enabled only
  when that identity is a required approver. Removes the gap between "toggle
  is visibility only" and "the manager approves".
- Renew keeps the asset's current tier (the Miro diagram sent every renew to
  Team).
- Leases are per asset: 90 days from promotion or renewal, not a shared cycle.
- Clock: 1 simulated day = 1 real second while running (30-day TTL = 30 s,
  90-day lease = 90 s). A god-mode panel pauses, resumes and fast-forwards
  (+1 / +30 / +90 days, next due event). No rewind: it would need clock
  snapshots. Starts paused after reset; clock actions are audited.
Alternatives considered: silence only proposes archive; employee request box;
shared 90-day cycle; fast-forward-only clock; time travel with snapshots.
Agreed by: KayTee; Viet pending (docs merged in #10)

D13: Fill lifecycle and approval gaps found in the scope review (2026-11-06)
Status: proposed (KayTee). Refines D9 and D12; needs Viet's agreement because it
changes the contract (proposal types, asset state, clock, usage events).
Choice and why:
- Imported leases: seeded from each asset's `last_modified` (latest date
  before the clock start that is a whole number of 90-day periods after it).
  Without this all 360 imported assets reach review on day 90 at once.
- Approvers: build_temporary needs the requester's team lead; reuse needs no
  approval and is logged. The demo's "manager approves" means the manager
  acting as that team lead.
- Usage identity: Employee mode gets a "viewing as" picker; opens count for
  that person next to the seeded team-synthetic events.
- Merge in P0: rule-based candidates (same semantic model + overlapping KPIs);
  the owner picks the target. Lease steward reasoning stays P1.
- Restore: back to the previous tier with a new 90-day lease.
- Search: keyword + local word-overlap (TF-IDF) vectors in P0; an embeddings
  API only if results are poor (P2). No extra key; no data sent to another
  service.
- Demo conflict: REQ-0001 asks for sales growth, so the demo shows Net Sales
  Growth (KPI-004) vs. Net Sales Growth Local (KPI-005).
- A simple before/after counts panel moves to P0 (the demo ends on it); the
  full portfolio view stays P1.
- Smaller defaults: auto-archive also skips assets with an inactive owner
  (65 in the pack); owner review shows no cost (the pack has none); 14-day
  review window before the default applies; clock starts 2026-11-01;
  scheduler events reuse the step-event shape with `runId: "clock"`.
Alternatives considered: no lease until touched; demo-only leases; data
steward or requester approves builds; seeded usage only; merge to P1; restore
to Personal; embeddings API in P0; Net Sales trio in the demo; dropping
before/after from the demo.
Agreed by: KayTee; Viet pending

D14: Close gaps from Codex's MVP review (2026-11-06)
Status: proposed (KayTee). Refines D13; needs Viet's agreement because it
changes the contract (approvers, reuse step, restore, clock).
Choice and why:
- KPIs: the pack has no executable formulas, so a small team-authored
  mapping turns supported approved KPIs into source columns (SCOPE, Data).
  Other KPIs return "cannot compute from this pack".
- Reuse: catalog metadata can't prove a dashboard answers a question, so
  discovery returns reuse candidates with known/unknown coverage and the
  requester confirms one (no approver). Replaces D13's silent reuse.
- Teams: a team is an owner region (`scope`). Any active Lead in the region
  may approve as team lead. Data steward per region; Global covers Asia
  Pacific, which has no active steward.
- Ownership: reassign_owner is approved by the region's data steward.
  Promotion never changes the owner. Temporary → Personal is automatic and
  logged.
- Reviews: any decision closes a lease review; rejecting retire or merge
  renews the lease, so silence can't archive it later.
- Restore: a restored Temporary gets a fresh 30-day TTL; other tiers keep
  D13 (previous tier, new 90-day lease).
- Merge: executes only for an active target whose scope covers the source,
  with the source's downstream assets redirected.
- Clock: fast-forward processes due events in date order.
- Counts: from applied state changes, including expiries and policy archives;
  conflicts shown as detected vs. resolved.
- Build order: golden path first (PLAN). Test set of 6 human-reviewed
  scenarios as T13 (R30), labelled ours.
Alternatives considered: one picked lead per region; silent reuse; review
stays open after a rejection; restore Temporary as Personal; Lead reassigns
owners; owner moves up on promotion; no build order; no test set.
Agreed by: KayTee; Viet pending

D15: KPI computation policies for T15 (2026-11-07)
Status: proposed / pending owner approval (KayTee, Viet). Refines D14; the
D14 mapping itself is still proposed.
Choice and why:
- Value types: `Product_Market_Monthly` labels each row actual-like or
  forecast-like. One `value_type` per calculation, `actual_like_synthetic`
  by default; forecast-like only on request and labelled (DATA_SOURCES:
  don't blend). A row of the other type makes the result insufficient_data;
  it is never dropped from an aggregate, which would change the population.
- Aggregation: M EUR measures are summed; growth is a ratio of sums over the
  same cells; coverage % is computed per product and market only, because
  the pack has no weights (SCOPE: percentages are never summed).
- Latest-month probe: the steward analysis checks computability per market
  at the latest month in the pack (not of the scope, so missing recent rows
  show), on actual-like rows, and reports statuses, values and provenance.
  It approves and builds nothing.
- Every-market build gate: a build is proposed only when every requested
  approved KPI computes for every requested market; otherwise the result is
  insufficient_evidence with per-market reasons (SCOPE: builds use the
  computable mapping only).
- Known effect: on the pack, no real request reaches a build proposal
  (REVIEW F1); the demo strategy is an open owner decision.
Alternatives considered: blend value types; drop mismatched cells; average
percentages; probe the scope's own latest month; allow a build when some
markets compute (partial build).
Agreed by: pending (proposed by KayTee / Claude Code)

D16: Silence escalates, never archives (2026-11-07)
Status: accepted. Replaces D9's default archive on silence; refines D13/D14.
Choice and why: archiving must always follow an approved proposal. When an
owner does not answer a lease review within 14 days, the review is marked
escalated and the region's data steward (D14; Global covers Asia Pacific and
assets with no owner) is added as an approver. The asset stays under review;
nothing is archived by policy. Temporary insights still expire on their
30-day TTL, which is the tier's rule rather than a review default. Policy
version lifecycle-v2.
Alternatives considered: archive on silence (D9); renew on silence; archive
only silent retire proposals.
Agreed by: Viet

D17: Team use of a Temporary insight proposes Team (2026-11-07)
Status: accepted. Refines D13/D14 (Temporary -> Personal stays owner-only).
Choice and why: under the original rule only the owner's repeat use saved a
Temporary insight, so one that colleagues relied on was still archived after
30 days. Now, once 3 or more distinct people in the owner's region (the team,
D14) have opened it in the app, a promote proposal goes to the active Leads in
that region, excluding the owner (no self-approval; the region's data steward
if no other Lead). The 30-day expiry is held while it waits; approval makes it
Team with a 90-day lease and the owner unchanged; rejection lets the expiry
resume. The owner's own repeat use still promotes to Personal automatically.
Policy version lifecycle-v3.
Alternatives considered: owner-only (original rule); any repeat use promotes
to Personal.
Agreed by: Viet

D18: F1 demo strategy: one team-authored demo request (2026-11-07)
Status: accepted. Resolves REVIEW F1; D15's every-market build gate is unchanged.
Choice and why: no request in the pack reaches a build proposal (F1), so the
demo uses TEAM-REQ-01, written by the team and labelled as ours: "Net sales
and forecast variance for Xarelto in North America, by country." Checked on
the real pack: Net Sales is covered by existing assets, Forecast Variance
(KPI-042) by none in scope, and both KPIs compute for US and CA, so the
analysis honestly recommends a build. Only the request text is ours; the
catalog, KPIs, values and rules are the pack's and ours as before. The
request lives in code (src/services/steward/team-requests.ts), is never
written into Business_Requests, and every source reference names
"Team_Requests (team-authored)". The agent says so when it uses one.
Alternatives considered: partial builds for computable markets (changes D15);
no live build in the demo.
Agreed by: Viet

D19: Business performance and analytics estate are separate views (2026-11-07)
Status: accepted. Refines D8 (screen layout).
Choice and why: asset pages used to draw Product_Market_Monthly charts filtered
by the asset's scope, which presented business facts as if they were a
report's content (the pack has no report contents). The Dashboard tab now has
three sections: Business performance (both roles: Commercial, Market access,
Supply, Launch built on Product_Market_Monthly + Products + Markets,
Market_Access, Supply_Operations, Launch_Milestones, plus steward-built
Temporary insights); Analytics catalog (both roles: asset list; asset pages
show metadata only: KPIs with status, semantic model, governance signals,
usage, lifecycle); Estate overview (Manager: landscape, low usage,
duplication, KPI variants, governance, model health). Actual-like and
forecast-like rows are never summed together; coverage % is never averaged
(D15). The agent's discovery stays on estate metadata; values come only from
the facts via KPI computation.
Alternatives considered: two views (catalog + overview on one page);
employees see business performance only.
Agreed by: Viet

D20: Employees see simple team dashboards; managers judge them by views (2026-11-07)
Status: accepted. Changes D8 (employees no longer browse the asset catalog);
refines D19.
Choice and why: employees want to glance at a board and understand the data,
like the wallboard in the Bayer briefing, not read catalog metadata. Employees
now see only four team dashboards (Commercial, Market Access, Supply Chain,
Launch Excellence, matching the KPI catalog domains), built on the business
facts as wallboards: big KPI tiles (status tiles coloured and labelled) and a
2x2 chart grid, actual-like rows only, coverage never averaged (D15). The
boards are app assets (origin "team", Certified, owned by the Global Lead of
that team, 90-day lease from the clock start). Each employee board open logs
one usage event; managers see views, distinct viewers, last 30 days and last
viewed on each board, and the boards' lease reviews use these in-app views as
evidence for renew or retire. The analytics catalog and estate overview are
manager-only.
Alternatives considered: keep the catalog for employees (D8); employees see
business performance and catalog side by side (D19 as first built).
Agreed by: Viet

D21: Used assets renew automatically at lease end (2026-11-07)
Status: accepted. Refines D12-D16 (lease review).
Choice and why: reviewing every asset every 90 days creates work for IT and
owners even when the asset is clearly in use. At lease end the engine now
checks use: any in-app view in the last 90 days, or pack telemetry averaging
at least 10 monthly users over its latest 3 months (the pack is a snapshot
ending Oct 2026; its latest months stand in for current telemetry). A used
asset with an active owner renews automatically for 90 days in the same tier,
logged as a policy action. A used asset without an active owner goes straight
to the region's data steward (Rule 8: missing owners block automatic
changes). Only unused assets get a retire proposal for the owner; silence
still escalates and never archives (D16). On the pack a 90-day fast-forward
renews 178 assets automatically, opens 134 retire reviews and sends 52 to
stewards. Policy version lifecycle-v4.
Alternatives considered: review every asset (D12-D14); auto-archive unused
assets (rejected in D16).
Agreed by: Viet

D22: Employees see their team's real catalog dashboards (2026-11-07)
Status: accepted. Replaces D20's four invented team boards; refines D19.
Choice and why: with four boards of our own, employee views never reached
the 360 real dashboards the lifecycle governs, and the boards were too
summarized. Now the employee's team (domain + region) is derived from the
"viewing as" person's role and region (our mapping: Commercial, Finance,
Market Access, Supply, Launch roles to their KPI domain; platform, model, data
product owners and stewards to BI Governance) and can be switched. The list
shows catalog dashboards whose primary KPIs are mostly in that domain, scoped
to the region or Global (2-45 per team on the pack). Opening one renders a
wallboard from the dashboard's KPI domain over the pack's facts for its
product and market (Commercial/Finance: Product_Market_Monthly; Market Access:
Market_Access; Supply Chain: Supply_Operations; Launch: Launch_Milestones; BI
Governance: estate metadata). Values follow D15. The pack has no report
layouts, so the view is labelled as built from the dashboard's catalog KPIs
with our layout. Each open logs one app view on that dashboard, which feeds
D21 auto-renewal. The DSH-* team boards are removed from existing databases.
Alternatives considered: keep the four team boards (D20); show catalog
metadata to employees (D8).
Agreed by: Viet

D23: Pack telemetry only counts within the 90 days before a review (2026-11-07)
Status: accepted. Refines D21.
Choice and why: the pack's Asset_Usage is a fixed snapshot (Jan-Oct 2026).
D21 treated its latest months as current, so in a long simulation dashboards
kept auto-renewing on 2026 data (1,068 renewals by Apr 2028). Now a pack month
counts only if it starts within the 90 days before the review date, so pack
telemetry supports reviews until about the end of Jan 2027; after that only
in-app views keep a dashboard alive. The catalog usage chart labels months
with the year and warns when the snapshot is older than the simulated 90-day
window. Policy version lifecycle-v5.
Alternatives considered: keep the snapshot as current (D21); extrapolate the
snapshot forward (would invent usage).
Agreed by: Viet

D24: LLM-authored synthetic analytics sprawl scenarios (2026-11-07)
Status: accepted direction (both developers); implementation is planned, not
built. Complete T16B and the current golden-path integration first.
Choice and why: augment the original Bayer-provided synthetic estate with
additional **team-authored, LLM-generated synthetic data** to demonstrate
realistic analytics sprawl beyond querying the workbook. Candidate scenarios
include KPI forks with different formulas, filters or meanings; duplicate or
near-duplicate dashboards; noncanonical, unapproved or misleading definitions;
overlapping assets; stale or underused products; and ownership, lineage or
other governance inconsistencies. These are scenario ideas, not claims that
the current system detects or resolves every case. A forked KPI may express a
legitimate business requirement; a difference alone does not make it invalid.

- Preserve the original Bayer workbook and imported source records. Generated
  records and planted problems must never be attributed to Bayer's dataset.
  Keep origins distinguishable in analysis, recommendations, audit and UI.
- Prefer generating scenarios once, reviewing them and storing deterministic
  fixtures with known expected outcomes for regression tests. Deterministic
  validation and governance logic must evaluate them; do not hardcode
  successful detection results. The LLM assists fixture authoring, not approval.
- Planned demo: labelled original-plus-generated estate -> explain duplication
  and KPI conflicts -> evidence-backed reuse, consolidation, canonicalization
  or retirement recommendations -> human-governed decisions and required
  lifecycle transitions -> measurable before/after results. This is not yet an
  implemented capability. "Eliminating" sprawl means approved consolidation,
  retirement, deprecation or other governed actions, never silent deletion of
  source records or audit history. The LLM cannot bypass governance or
  independently authorize retirement.
- Separate from T16A, T16B, T17 and D18's existing TEAM-REQ-01; complements
  their contracts rather than replacing them. D14-D23 remain unchanged.

Open: fixture schema, seed workflow, detection methods, UI presentation,
implementation owner, schedule and final dataset size. No approval of these
implementation details is implied. Plan and implement only after T16B and the
golden path; see T19 in PLAN.
Alternative: regenerating scenarios each demo; reviewed fixtures are preferred
for repeatability.
Agreed by: KayTee + Viet (direction only, confirmed by the user)

D25: Governance scheduler: incremental and periodic runs, findings, proposals from findings (2026-11-07)
Status: proposed (KayTee, T25 B1-B4 on `integrate/T24-scheduler`; awaiting
Codex re-review). Needs Viet's agreement on: the reset-list lines in
`src/services/lifecycle/schema.ts`; the MERGE-APPROVERS fix in
`src/services/estate/merge.ts` and the merge approval guard in
`src/services/lifecycle/engine.ts` (his code; made in the T25 integration
with the owner's authorisation); the sentence B3 appends to
`proposals.rationale` when a proposal is raised from a finding. B0
(archiving closes other open proposals; no decision on an archived asset)
is Viet's and is on master since `16c868d` (#36).
Choice and why:
- Scheduler runs, checkpoints and findings live in their own tables
  (`scheduler_*`), apart from request pipeline `runs` and from `proposals`.
  Run IDs are random (`SCH-<uuid>`), finding IDs `FND-<uuid>`.
- Mode 2 (incremental) reads `audit_log` IDs after the last committed
  checkpoint up to a bound fixed when the run is claimed (inside a write
  transaction, so no lower ID can commit later). Watched actions:
  `temporary_registered`, `insight_built`, `restored`, `promoted`;
  `scheduler_*` rows are ignored. No change, no estate read.
- Rule `active_overlap` (`overlap-v2`) reuses `suggestMerge` unchanged, in both
  directions (the changed asset as covered or covering side). Only its
  `merge` verdict becomes a finding; `keep_both` / `partial` are counted.
  A finding is not a proposal and never merges, archives or changes KPIs.
- Findings: one row per rule + asset pair; `open` or `dismissed`. Dismiss
  needs a reason and is audited. Fingerprint (material evidence) = verdict
  + per asset: scope, KPI set and governance tier. Tier is material
  (Codex F2): it is the governed standing, `suggestMerge` ranks by it, and
  a dismissal of an overlap with a Temporary insight says nothing once it
  is Personal or Team. Excluded (evidence only): usage counts and merge
  direction (move with the clock), name, lease/TTL dates, owner (no in-app
  transfer; revisit when B3 routes findings to owners), active vs
  lease_due. Same fingerprint: open stays open, dismissed stays
  dismissed; new fingerprint on a dismissed finding reopens it (audited).
  Every observation (incremental or periodic) refreshes the current
  evidence, also when the fingerprint is unchanged; the evidence a finding
  was dismissed on is kept apart (`dismissed_evidence`) until the dismissal
  is cleared (Codex B2-F2).
  `overlap-v1` findings (local demo DBs only; B1 is unmerged) reopen once
  on their next observation because the basis changed.
- Concurrency: one running run per job (partial unique index), and one
  running run across all finding-writing jobs (incremental + periodic,
  second partial unique index checked in the claim transaction; Codex
  B2-F1: an older incremental run could otherwise reopen a finding a
  periodic run had just resolved). A blocked claim is a conflict (HTTP
  409); abandoning or finishing the run releases it. Claim,
  read-only evaluation, and one commit transaction that marks the run
  succeeded and moves the checkpoint by compare-and-set together with the
  findings. Failures are recorded and never move the checkpoint.
- Database access (Codex F1): libsql 0.5 keeps the lock of a statement that
  failed with SQLITE_BUSY until that statement is run again or
  garbage-collected, and @libsql/client puts the connection back in its
  pool; a failed COMMIT then blocks every writer. Scheduler writes
  therefore use their own short-lived `libsql` connection per attempt
  (BEGIN IMMEDIATE, `cache_spill` off, closed afterwards); a busy BEGIN
  holds nothing and is retried asynchronously on a new connection; a
  failed COMMIT is rolled back and that COMMIT statement is run once more
  so it releases its lock at once. Evaluation reads use a scheduler-owned
  client closed after the run. The app's shared client is never written
  through or closed by the scheduler. `libsql` (already installed under
  @libsql/client) is now a direct dependency.
- Failure reporting (Codex C4): after an evaluation or commit failure the
  run is marked failed if possible, then the stored state decides what is
  reported: failed run; conflict `abandoned`; conflict `reset`; or conflict
  `unrecorded` (recording failed too, the run stays running, abandon it).
  The original failure and run ID are always in the error detail.
- Crash recovery: no automatic stale-run timeout (no heartbeat to tell a dead
  run from a slow one). A manager abandons a stuck run with a reason
  (audited); a late commit of that run is refused.
- Reset: `resetLifecycle` drops the `scheduler_*` tables with `audit_log`, so
  no checkpoint, run or finding outlives the audit IDs and assets it points at.
- HTTP writes (run, dismiss, abandon) are off unless the server sets
  `SCHEDULER_DEMO_ACTIONS=1`, then accept only the demo `manager` actor. This
  is attribution, not authentication (no auth in the prototype). The gate
  is checked before any database access (Codex C3). Reads are open like
  other GET routes. Operators can use the CLI.
- The scheduler does not tick the clock (ticking writes lifecycle state); it
  evaluates at the stored clock date.
- Mode 3 (B2, job `periodic_reassessment`, manual trigger only): re-checks
  open and dismissed findings with the same rule; a finding whose overlap no
  longer holds is `resolved` (with a reason). `superseded` is reserved in the
  schema, types and API filter, but no transition produces it yet; no
  superseding behaviour is implemented. Pending proposals that rest on
  changed findings are reported (`staleProposals`, relation `linked` / `same_pair` / `shares_asset`),
  never changed.
- Proposals from findings (B3): a manager picks the direction (source merged
  into target); the backend re-validates both assets, scope, KPIs, tier and
  open proposals, re-runs the comparator, and calls `proposeMerge`
  unchanged. Link table `scheduler_finding_proposals` keeps actor,
  direction, fingerprint and an evidence snapshot. The outcome shown for a
  finding (pending / approved / rejected / expired) is derived on every
  read from the lifecycle `proposals` row (Codex B3-F1); a stored outcome
  is a cache only, and a missing row (reset) is never shown as pending. The
  comparator's preferred direction is recorded as comparison evidence,
  never as authorisation (B3-F2). A Personal or Team asset replacing a
  Certified dashboard is blocked as an unresolved product policy (B3-F4).
- The POST that raises a proposal is hard-disabled
  (`FINDING_PROPOSALS_ENABLED = false`, 409 `blockedBy`
  `["MERGE-APPROVERS", "CODEX-REVIEW"]`) until Viet has reviewed the
  MERGE-APPROVERS fix and Codex has reviewed the module. No UI control
  raises proposals.
- MERGE-APPROVERS (Codex P1, fixed in the T25 integration): `proposeMerge`
  resolves the source and target approvers separately (active owner, else
  the region's active data steward, as before) and refuses, writing
  nothing, when either side has none. Identities are deduplicated only
  after both sides are found, so one steward may represent both. The
  engine refuses to approve a stored merge whose evidence lacks an approver
  for a side or whose `required_approvers` omit one (a pre-fix proposal);
  the row is left as stored and can still be rejected or cleared by a reset.
Not covered (later): clock/cron triggers, a full-estate sweep, external
catalog changes (imported tables are read-only; nothing to observe), merge
expiry/escalation (merge proposals have no due date).
History (Codex C1): a finding keeps only its latest evidence (and, while
dismissed, the evidence it was dismissed on); earlier observations are not
reconstructible. B3 must snapshot the evidence a proposal is made from.
Alternatives considered: reusing `runs`/`run_events` (request-specific);
timestamp-based reset detection (not reliable); a stale-run timeout (no
evidence for any value); persisting `keep_both`/`partial` overlaps as findings
(suggestMerge itself treats them as no action).
Agreed by: KayTee (proposed); Viet pending

D26: Simulated-time scheduler trigger (B5) (2026-11-07)
Status: proposed (KayTee, T26 on `feat/T26-scheduler-simulated-time`;
awaiting review). Touches Viet's `src/app/api/clock/shared.ts` (additive,
behind a setting) and one reset-list line in
`src/services/lifecycle/schema.ts`.
Choice and why:
- No cron, no worker. `runSimulatedTriggers` runs at explicit moments only:
  after a manager clock action (advance, next event, pause, resume) when
  `SCHEDULER_SIM_TRIGGER=1` and `SCHEDULER_DEMO_ACTIONS=1`, and from the
  Scheduler tab's "Check due jobs" (demo gate). It reads the stored date and
  never ticks or changes the clock; a free-running clock (1 day/s) runs
  nothing until the next clock action or check. Off by default: clock
  responses and behaviour are unchanged.
- Jobs run in order incremental, then periodic, through the unchanged
  `runIncremental` / `runReassessment` with trigger `simulated_clock`.
  Due: incremental when watched audit rows exist after the checkpoint;
  periodic when `reassessmentDue()` says so. No cadence by default; an
  optional demo cadence (`SCHEDULER_SIM_REASSESS_DAYS`) only spaces
  simulated reassessments and is not a production policy. Unrelated to the
  90-day usage window and the 30-day Temporary TTL.
- Idempotency: a job whose simulated run already SUCCEEDED at this date is
  `already_processed` (read from `scheduler_runs`). Failed runs do not
  count, so the next trigger at the same date retries (recovery). Changes
  after that day's successful run wait for the next date or a manual run.
- Concurrency: any running finding-writing run (manual or simulated) defers
  the simulated jobs (`deferred`, nothing started); the existing claim
  indexes still refuse overlaps, and a lost claim race is also `deferred`.
  A manual run during a simulated run gets the existing 409.
- `scheduler_sim_state` keeps the last evaluation per job for display only;
  dropped by the demo reset with the other scheduler tables.
- Never proposes, decides, merges, retires or approves; B3 stays disabled.
Alternatives considered: ticking-time hooks in `tick()` (would change
real-time semantics and run on every GET); a fixed production cadence (no
evidence for a value); client-only triggering from the Scheduler tab (would
not run when the tab is closed).
Agreed by: KayTee (proposed); Viet pending

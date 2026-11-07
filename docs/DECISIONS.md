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


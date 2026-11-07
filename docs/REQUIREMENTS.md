# Requirements

## Implementation status at the documentation snapshot

Implementation snapshot: `1beff2ebd1e4df5393bc6b065795ca1ddb845edc` (`origin/master`, T26 merged in #38),
verified 2026-11-08. Original refresh baseline: `43a1157`; reconciled against the
committed final master revision. Local `master` is stale and was not moved.

The sections below preserve product targets and historical planning. They are
not a checklist of delivered functionality. Current behavior is specified in
[ARCHITECTURE](ARCHITECTURE.md), [MASTRA](MASTRA.md), [API](API.md),
[GOVERNANCE](GOVERNANCE.md) and the executable [DEMO](DEMO.md) runbook.
D16 supersedes default lease auto-archive: silence escalates to a steward.

Implemented: persisted request Pipeline, chat drafts, governed build/reuse,
four mapped KPIs, usage/lease/TTL services, inbox, restore and merge proposals.
Partial: catalog-only discovery remains separate from lifecycle-aware estate
checks; lineage is catalog metadata plus built-value provenance, not a complete
graph; counts do not establish KPI conflict resolution; owner reassignment,
proposal editing and complete certification promotion are unfinished.
B0–B5 are in the verified master snapshot: B1/B2 runners support manual runs,
B3 proposal bridge stays disabled, B4 supplies Scheduler UI, and T26/B5 adds
opt-in checks after explicit clock actions plus manual Check due jobs. No cron,
background worker, freely ticking clock trigger or full-estate sweep. Synthetic sprawl generation remains
planned. External BI/SSO integration and regulatory certification are absent.

Organizer facts: [CHALLENGE](CHALLENGE.md). Dataset semantics:
[DATA_SOURCES](DATA_SOURCES.md). Product scope: [SCOPE](SCOPE.md) (Miro
pipeline + UI vision, D7–D9). Historical contract/lanes agreement remains a coordination item; actual interfaces are documented in API.

"Must" means the demo fails without it. "Stretch" means build it if time remains after P0/P1.

| ID | Requirement | Source | Must / nice | How we check it |
| --- | --- | --- | --- | --- |
| R1 | Import Bayer pack read-only with IDs, types and provenance | B1 §05; W1 START_HERE | must | Sheet counts match DATA_SOURCES; blanks preserved; Excel dates decoded |
| R2 | Intake: manager runs a request on a named requester's behalf (D8, D12); parse intent, clarify text/context conflicts, map canonical KPIs | B1 §03–04; W1 rules 1–2; Miro seq. | must | REQ-0001 conflict surfaced and asked; corrected intent drives search; requester recorded and labelled as our mapping |
| R3 | Discovery: hybrid search (keyword + local word-overlap vectors; embeddings API only if needed, D13) over assets, KPIs and models; reuse before build; returns reuse candidates with known/unknown coverage; requester confirms reuse (no approver) and it is logged | W1 rule 1; Miro seq.; D14 | must | Ranked candidates with score parts, source IDs and coverage gaps; nothing reused without requester confirmation |
| R4 | Conflict detector: same canonical metric, different definition/status; no invented formulas or monetary gaps | W1 KPI_Catalog; Miro seq. | must | For REQ-0001: Net Sales Growth (KPI-004) vs. Net Sales Growth Local (KPI-005) flagged with KPI IDs and status; Net Sales group (KPI-001/002/003) detected the same way |
| R5 | Build path: an active Lead in the requester's region approves → build step (deterministic in P0, Builder agent in P1) on KPIs in the computable mapping only → Temporary insight with TTL 30d and expiry shown | Miro seq.; W1 rule 2; D13, D14 | must | Insight cites only mapped approved KPIs; expiry date visible; approve disabled unless acting as a Lead in that region |
| R6 | Lifecycle engine: Temporary → Personal → Team → Certified, 90-day lease, owner review renew/merge/retire, steward escalation after a 14-day review window (D16 supersedes default archive), restore to the previous tier with a new lease (Temporary: fresh 30-day TTL); Temporary → Personal automatic and logged; promotion keeps the owner; any decision closes a review and rejecting retire/merge renews; leases per asset; renew keeps the tier; imported leases seeded from `last_modified`; rule-based merge candidates (same model + overlapping KPIs), executed only for an active target covering the source's scope with downstream assets redirected | Miro lifecycle; D9, D12, D13, D14, D16 | must | Each transition reachable in demo; renewed and restored assets keep their tier; imported reviews spread over the first 90 days; archive restorable; no deletes; silence escalates and never archives; a rejected retire renews |
| R7 | Simulated clock at 1 day = 1 s; god-mode panel with pause, resume, fast-forward (no rewind); scheduler runs TTL expiry and lease reviews | D9, D12 | must | Running 30 s expires a new Temporary; 90 s after promotion an owner review proposal appears; clock starts paused after reset; clock actions audited; advancing 120 days processes intermediate events in date order |
| R8 | Per-user app usage events for promotion: seeded team-synthetic events plus opens under the "viewing as" identity; app events and pack monthly usage kept separate | D9, D10, D13; W1 Data_Dictionary | must | Promotion uses app events; UI labels seeded ones team-synthetic; imported usage never incremented; no monthly sums as distinct users |
| R9 | Approval inbox: approve / reject / edit; reject and edit need a reason; edits reset approvals; authority from required approvers (owner / team lead / steward) via the manager's "acting as" picker, not the role toggle | B1 §04 human-in-the-loop; D10, D12 | must | Reject without reason blocked; rejecting a build or promotion leaves state unchanged; rejecting a retire or merge at lease review renews the lease (D14); Approve disabled when the acting identity is not a required approver; decision logged under that identity |
| R10 | Missing/inactive owner blocks execution until the region's data steward assigns one (Global steward for Asia Pacific) | W1 rule 3; D14 | must | 21 blank-owner and 65 inactive-owner assets detected; execution blocked; reassign approved only by that steward |
| R11 | Append-only audit log on every proposal, decision and state change + per-asset timeline | B1 governance; SCOPE rules | must | One row per event; timeline shows actor, reason, evidence, lineage snapshot |
| R12 | UI shell: Agentic / Dashboard tabs top middle; Employee/Manager toggle top right | D8 | must | Employee sees only Dashboard; Manager sees both |
| R13 | Employee Dashboard: "viewing as" picker; browse dashboards with tier, owner, expiry; opening logs usage for that person | D8, D13 | must | Opening a dashboard adds a usage event with the viewer's ID |
| R14 | Agentic Chat view: responsive chat, each step streamed with its state and evidence | D8 | must | States running / done / waiting for approval / failed visible live |
| R15 | Agentic Pipeline view (simple): Miro layout, nodes highlight from the same step events; switchable with Chat view | D8 | must | Switching views mid-run shows the same run state |
| R16 | Lineage drill-down: click chart, number or asset → graph + "how it was traced"; simple for Employee, full for Manager | W1 rules 4/8; D6, D10 | must | Imported assets show catalog edges only; app-computed values show actual query and source rows; missing mappings explicit; cycles handled; no distinct-audience claims across assets/months; proposal stores snapshot |
| R17 | Mastra agents for Orchestrator, Discovery and Conflict detector (P0); platform services are deterministic TypeScript tools; LLM never produces numbers | D7, D11 | must | Numbers trace to code/query; agents only create proposals |
| R18 | README / architecture note: data assumptions, AI approach, governance controls, Power BI/Fabric path | B1 §07 | must | Note exists and matches the build |
| R19 | Pharma only; synthetic values labelled; exclusions honoured | W1 START_HERE | must | Footer label; no Crop Science / clinical content |
| R28 | Manager counts panel: before/after counts of tiers, leases due, conflicts, archived | Miro client; D13 | must | Counts come from applied state changes (decisions, expiries, policy archives); conflicts shown as detected vs. resolved; used in demo step 7 |
| R29 | Computable KPI mapping: team-authored KPI → source column/calculation for supported approved KPIs; others return "cannot compute from this pack" | D14; W1 KPI_Catalog | must | KPI-004, KPI-042 and KPI-027 computed for REQ-0001 with the query shown; an unmapped KPI returns the message |
| R20 | Pipeline view polish (animated edges, request moving through lifecycle) | D8 | nice | — |
| R21 | Builder agent and Lease steward agent (overlap reasoning for merge proposals) | Miro arch.; D11 | nice | Overlapping assets proposed for merge with evidence |
| R22 | Full portfolio view (sprawl charts, drill-down) beyond the P0 counts panel (R28) | Miro client | nice | Figures reflect applied changes only |
| R23 | Tableau→Power BI migration review ("don't migrate waste") | B1 §02; W1 rule 6 | nice | Backlog items assessed with evidence, not copied |
| R24 | Optional separately labelled SQL conflict fixture | Team idea | nice | Not attributed to the pack |
| R25 | Health score, audit export, cost estimates | Team idea | nice | Assumptions explained; no invented savings |
| R26 | Stretch: scheduled data-source health checks (arrival consistency, freshness, validity) on the simulated clock, using pack refresh and quality fields; warning badge propagated through lineage | Team idea; SCOPE "Stretch goal" | stretch | The clock (running or fast-forwarded) runs the check; a model with failed refresh marks its dashboards with a badge and reasons; result in audit log |
| R30 | Team-authored test set: 6 human-reviewed scenarios (reuse, justified build, unclear request, KPI conflict, missing owner, not enough evidence) with expected outcomes | D14 | nice | Run checks retrieval relevance, citations, unsupported claims and approval rules; labelled ours, not Bayer ground truth |
| R27 | Stretch: domain validity windows (finance period close, legal retention/holds, HR retention/GDPR, GxP) with audit evidence | Team idea | stretch | One or two example policies shown; no compliance certification claimed |

## Demo script

See [SCOPE](SCOPE.md#demo-story-target-3-min-portal-limit-unknown): employee
browse + lineage → manager chat on REQ-0001 → pipeline view → reuse vs. build
Temporary → reject with reason → run / fast-forward the clock in god mode →
audit + counts panel.

## Out of scope

Crop Science, Consumer Health, clinical/treatment decisions, pharmacovigilance,
patient profiling, real Bayer systems, real SSO/RBAC, live BI changes,
production scale, certified compliance.

## Unknowns

| Unknown | Affects | Who resolves it |
| --- | --- | --- |
| IP, source redistribution, external AI processing terms | Data handling / submission | Organizers / Bayer |
| Video limit and current portal rules | Demo / submission | Organizers |
| Whether DSO / 90-day framing resonates with Bayer | Pitch | Bayer Q&A (Sat) |
| Final agreement on contract and lanes (implemented interfaces now documented in API) | Coordination | Viet + KayTee |

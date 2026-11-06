# Requirements

Organizer facts: [CHALLENGE](CHALLENGE.md). Dataset semantics:
[DATA_SOURCES](DATA_SOURCES.md). Product scope: [SCOPE](SCOPE.md) (Miro
pipeline + UI vision, D7–D9). Team must still agree the contract and lanes.

"Must" means the demo fails without it. "Stretch" means build it if time remains after P0/P1.

| ID | Requirement | Source | Must / nice | How we check it |
| --- | --- | --- | --- | --- |
| R1 | Import Bayer pack read-only with IDs, types and provenance | B1 §05; W1 START_HERE | must | Sheet counts match DATA_SOURCES; blanks preserved; Excel dates decoded |
| R2 | Intake: manager runs a request on a named requester's behalf (D8, D12); parse intent, clarify text/context conflicts, map canonical KPIs | B1 §03–04; W1 rules 1–2; Miro seq. | must | REQ-0001 conflict surfaced and asked; corrected intent drives search; requester recorded and labelled as our mapping |
| R3 | Discovery: hybrid search (keyword + vector) over assets, KPIs and models; reuse before build | W1 rule 1; Miro seq. | must | Ranked candidates with score parts and source IDs |
| R4 | Conflict detector: same canonical metric, different definition/status; no invented formulas or monetary gaps | W1 KPI_Catalog; Miro seq. | must | Net Sales / Net Sales Local / Net Sales v2 flagged with KPI IDs and status |
| R5 | Build path: approval to build → Builder on certified KPIs only → Temporary insight with TTL 30d and expiry shown | Miro seq.; W1 rule 2 | must | Insight cites only approved canonical KPIs; expiry date visible |
| R6 | Lifecycle engine: Temporary → Personal → Team → Certified, 90-day lease, owner review renew/merge/retire, default archive, restore; leases per asset; renew keeps the tier | Miro lifecycle; D9, D12 | must | Each transition reachable in demo; renewed asset keeps its tier; archive restorable; no deletes; auto-archive logged as policy action and skipped for assets with dependencies or no owner |
| R7 | Simulated clock at 1 day = 1 s; god-mode panel with pause, resume, fast-forward (no rewind); scheduler runs TTL expiry and lease reviews | D9, D12 | must | Running 30 s expires a new Temporary; 90 s after promotion an owner review proposal appears; clock starts paused after reset; clock actions audited |
| R8 | Labelled synthetic per-user usage events for promotion; app open events and pack monthly usage kept separate | D9, D10; W1 Data_Dictionary | must | Promotion uses app events; UI labels them team-synthetic; imported usage never incremented; no monthly sums as distinct users |
| R9 | Approval inbox: approve / reject / edit; reject and edit need a reason; edits reset approvals; authority from required approvers (owner / team lead / steward) via the manager's "acting as" picker, not the role toggle | B1 §04 human-in-the-loop; D10, D12 | must | Reject without reason blocked; rejection leaves state unchanged; Approve disabled when the acting identity is not a required approver; decision logged under that identity |
| R10 | Missing/inactive owner blocks execution until a human assigns one | W1 rule 3 | must | 21 blank-owner assets detected; execution blocked |
| R11 | Append-only audit log on every proposal, decision and state change + per-asset timeline | B1 governance; SCOPE rules | must | One row per event; timeline shows actor, reason, evidence, lineage snapshot |
| R12 | UI shell: Agentic / Dashboard tabs top middle; Employee/Manager toggle top right | D8 | must | Employee sees only Dashboard; Manager sees both |
| R13 | Employee Dashboard: browse dashboards with tier, owner, expiry; opening logs usage | D8 | must | Opening a dashboard adds a usage event |
| R14 | Agentic Chat view: responsive chat, each step streamed with its state and evidence | D8 | must | States running / done / waiting for approval / failed visible live |
| R15 | Agentic Pipeline view (simple): Miro layout, nodes highlight from the same step events; switchable with Chat view | D8 | must | Switching views mid-run shows the same run state |
| R16 | Lineage drill-down: click chart, number or asset → graph + "how it was traced"; simple for Employee, full for Manager | W1 rules 4/8; D6, D10 | must | Imported assets show catalog edges only; app-computed values show actual query and source rows; missing mappings explicit; cycles handled; no distinct-audience claims across assets/months; proposal stores snapshot |
| R17 | Mastra agents for Orchestrator, Discovery and Conflict detector (P0); platform services are deterministic TypeScript tools; LLM never produces numbers | D7, D11 | must | Numbers trace to code/query; agents only create proposals |
| R18 | README / architecture note: data assumptions, AI approach, governance controls, Power BI/Fabric path | B1 §07 | must | Note exists and matches the build |
| R19 | Pharma only; synthetic values labelled; exclusions honoured | W1 START_HERE | must | Footer label; no Crop Science / clinical content |
| R20 | Pipeline view polish (animated edges, request moving through lifecycle) | D8 | nice | — |
| R21 | Builder agent and Lease steward agent (overlap reasoning for merge proposals) | Miro arch.; D11 | nice | Overlapping assets proposed for merge with evidence |
| R22 | Portfolio view with before/after counts (sprawl, tiers, leases due, conflicts, archived) | Miro client | nice | Counts reflect applied changes only |
| R23 | Tableau→Power BI migration review ("don't migrate waste") | B1 §02; W1 rule 6 | nice | Backlog items assessed with evidence, not copied |
| R24 | Optional separately labelled SQL conflict fixture | Team idea | nice | Not attributed to the pack |
| R25 | Health score, audit export, cost estimates | Team idea | nice | Assumptions explained; no invented savings |
| R26 | Stretch: scheduled data-source health checks (arrival consistency, freshness, validity) on the simulated clock, using pack refresh and quality fields; warning badge propagated through lineage | Team idea; SCOPE "Stretch goal" | stretch | The clock (running or fast-forwarded) runs the check; a model with failed refresh marks its dashboards with a badge and reasons; result in audit log |
| R27 | Stretch: domain validity windows (finance period close, legal retention/holds, HR retention/GDPR, GxP) with audit evidence | Team idea | stretch | One or two example policies shown; no compliance certification claimed |

## Demo script

See [SCOPE](SCOPE.md#demo-story-target-3-min-portal-limit-unknown): employee
browse + lineage → manager chat on REQ-0001 → pipeline view → reuse vs. build
Temporary → reject with reason → run / fast-forward the clock in god mode →
audit + portfolio.

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
| Embeddings provider for hybrid search (Claude has no embeddings API) | R3 | Viet + KayTee |
| Team derivation from owner role + scope | R6, R8 | Viet + KayTee |
| Final contract (step events, proposal JSON, endpoints) and lanes | Implementation | Viet + KayTee |

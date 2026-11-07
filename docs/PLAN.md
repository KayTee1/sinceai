# Plan

Status: challenge chosen (D1). Scope follows the Miro pipeline and UI vision
(SCOPE, D7–D9). Lanes and tasks below are proposed until both developers agree.

## Team

| Developer | Agent | Lane | Strengths |
| --- | --- | --- | --- |
| Viet | Claude Code | TBD | TBD |
| KayTee | Codex / Claude Code | TBD | TBD |

Proposed lanes (not agreed yet):

- **Lane A: agentic + platform.** Mastra agents and workflow, platform
  services (lifecycle, policy, semantic layer, scheduler/clock, audit, lineage),
  data import, API routes.
- **Lane B: client + demo.** Next.js shell, role toggle, Dashboard tab, Agentic
  Chat and Pipeline views, approval inbox, lineage panel; demo script and video.

Both lanes meet at the contract in ARCHITECTURE (step events, proposal,
decision, asset state, lineage). Lane B builds on fixtures until Lane A is ready.

- Merges to `master`: TBD
- Records the demo video: TBD
- Submits in sinceai.app: TBD

## Tasks

States: todo, doing, review, done, blocked. Claim a task by putting your name
on it and telling the other developer before starting.

| ID | Task | Owner | Branch | Files | Depends on | Done when | State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | Pick the challenge and plan it | Viet | docs/bayer-challenge | docs/ | Bayer briefing | Challenge chosen (done); scope re-checked after briefing; contract and tasks agreed | doing |
| T2 | Resolve scope review findings in draft docs | KayTee / Codex | feat/T2-scope-review-fixes | docs/ | User requested fixes and final-source intake | Review issues resolved; final brief/workbook facts and limitations recorded; human reviews draft | review |
| T3 | Correct pipeline diagrams in docs; define shared modes and lineage limits | KayTee / Codex | feat/T3-pipeline-docs | docs/ | User requested validation fixes and PR | Scope, requirements and architecture aligned; diff/links checked; PR ready for independent review | done (merged #7) |
| T4 | Scaffold Next.js + Mastra + SQLite; import Bayer XLSX | Viet / Claude | feat/initial-ui-mastra | src/, package.json | D7 agreed | App runs; sheet counts match DATA_SOURCES | review |
| T10 | Resolve scope/design contradictions; 1 day = 1 s clock with god mode | KayTee / Claude Code | docs/T10-scope-contradictions | docs/, summary/ | D9, D10 | D12 recorded; SCOPE, REQUIREMENTS, ARCHITECTURE and summary agree; Viet reviews | merged (#10); D12 awaits Viet |
| T11 | Fill lifecycle/approval gaps from the scope review | KayTee / Claude Code | docs/T11-scope-gaps | docs/, summary/ | D12 | D13 recorded; SCOPE, REQUIREMENTS, ARCHITECTURE and summary agree; Viet reviews | merged (#11); D13 awaits Viet |
| T12 | Fill gaps from Codex's MVP review | KayTee / Claude Code | docs/T12-review-gaps | docs/ | D13 | D14 recorded; SCOPE, REQUIREMENTS, ARCHITECTURE agree; Viet reviews | merged (#13); D14 awaits Viet |
| T13 | Team-authored test set: 6 scenarios with expected outcomes (R30) | TBD | feat/T13-test-set | docs/, tests/ | T4 | Scenarios reviewed by a human; runnable against the golden path | todo |
| T14 | Backend catalog slice: safe import with source rows, request clarification, KPI conflict check, reuse candidates, structured analysis | KayTee / Claude Code | feat/T14-backend-catalog | src/db/, src/services/steward/, tests/ | T4 | Fixture + local workbook tests pass; REQ-0001 clarifies and flags KPI-004 vs. KPI-005; StewardAnalysis shape agreed with Viet before UI use | done (merged #14, Codex approved); StewardAnalysis still provisional |
| T15 | Deterministic KPI computation (R29) on the D14 mapping; computability check in the steward analysis | KayTee / Claude Code | feat/T15-kpi-computation | src/services/semantic/, src/services/steward/, tests/ | T14, D14 (provisional) | KPI-004, KPI-042, KPI-027 (and base KPI-001) computed with units, filters, query and source rows; unsupported vs. insufficient data explicit; fixture + local workbook tests pass; KayTee reviews | done (merged #15, Codex verified); F1 resolved by D18 |
| T16 | Mastra steward tool adapters over T14/T15 (analyze-request, compute-kpi, check-kpi-definitions) with compact chat views | KayTee / Claude Code | feat/T16-mastra-steward-integration | src/mastra/tools/steward-*.ts, src/services/semantic/, tests/ | T14, T15 | Adapters return service results unchanged; model and UI get compact views; mock-model stream and follow-up replay tests pass; orchestrator wiring proposed to Viet (not applied) | done (merged #18, `97b14ba`) |
| T16B | Live orchestrator: steward tools + governed propose-build tool and prompt | KayTee / Claude Code | feat/T16B-live-orchestrator | src/mastra/, src/components/agentic/chat-view.tsx, src/components/lifecycle/lifecycle-context.tsx, tests/ | T16, T17 | TEAM-REQ-01 analysed and, on explicit request, proposed into the approval inbox through the production prompt + tool map (mock model); no self-approval; clarification and eligibility gates hold | done (merged #28, `26de465`) |
| T21 | Interactive chat assistant: colleague tone, collapsed steps, reuse / conflict / build / inbox cards with buttons, follow-up chips; read-only inbox tool; reuse confirmation (Miro step 6) | Viet / Claude | feat/T21-chat-assistant | src/components/agentic/, src/components/lifecycle/inbox.tsx, src/mastra/, src/services/build/reuse.ts, src/app/api/reuse/, tests/ | T16B | Assistant lists inbox proposals but never decides; Approve / Reject are human clicks on the inbox card; Use this logs an app use + audit; mock-model and fixture tests pass | done (merged #31) |
| T22 | Orchestrator estate tools: searchEstate, checkDuplicate, listArchived, getAsset, whoSignsOff, portfolioSummary, prepareRestore, draftRequest, proposeRetire, suggestMerge, proposeMerge (both owners approve); duplicate gate in proposeBuild | Viet / Claude | feat/T22-orchestrator-tools | src/services/estate/, src/services/steward/drafts.ts, src/services/lifecycle/engine.ts, src/mastra/, src/components/agentic/, tests/estate.test.ts | T21 | Typed request → draft → analysis → duplicate check → build or reuse/restore; no tool approves, restores or archives; retire needs the exact command; tests pass | done (merged #33) |
| T23 | Request pipeline (Miro page 2) as a Mastra workflow with step events, run continuations on submit / approval / reuse, Discovery + Conflict agents for findings, live Pipeline view | Viet / Claude | feat/T23-request-pipeline | src/mastra/workflows/, src/services/pipeline/, src/mastra/tools/pipeline-tools.ts, src/components/agentic/pipeline-view.tsx, tests/pipeline.test.ts | T22 | A stored or drafted request runs intent → discovery → conflict → duplicate → recommend; waits for Use this or Submit then the Lead; resumes to build/register; Pipeline view shows it live | done (merged #34) |
| T24 | Pipeline storyboard (default view: steps, counters, human gate, result card), Steps/Diagram switch, accurate TTL expiry note, no usage on archived assets, insufficient-evidence wording | Viet / Claude | feat/T24-pipeline-storyboard | src/components/agentic/, src/mastra/, src/services/lifecycle/engine.ts, tests/pipeline.test.ts | T23 | Storyboard plays reuse / build / covered runs in the browser; expiry note names who opened it; tests pass | review |
| T25 | Governance scheduler: B1 core (incremental audit-log checkpoint, `active_overlap` over suggestMerge, findings + dismissal), B2 periodic reassessment (resolve / supersede, stale-proposal report), B3 proposals from findings (POST disabled), B4 Scheduler tab. Branches keep the historical `feat/T24-scheduler-*` prefix; renumbered T25 because T24 is the pipeline storyboard | KayTee / Claude Code | integrate/T24-scheduler (from feat/T24-scheduler-core, -periodic, -finding-proposals, -tab) | src/services/scheduler/, src/app/api/scheduler/, src/lib/scheduler-*.ts, src/components/agentic/scheduler-*.tsx, src/components/steward-app.tsx (side tabs), src/services/lifecycle/schema.ts (reset list only), tests/scheduler*.test.ts | T22 (suggestMerge, proposeMerge), T5 audit log, B0 (#36) | Manual runs evaluate changed assets / reassess findings with evidence; dismissal audited; finding-writers serialised; proposal outcome read from proposals; proposal POST stays 409 until Viet reviews the MERGE-APPROVERS fix and Codex reviews; reset clears scheduler state; no merge, archive or KPI change by the scheduler; tests, build pass | review (D25 proposed; Codex REQUEST CHANGES on B2 `4233306` and B3 `35ea544` addressed; B4 filter race and MERGE-APPROVERS fixed in the integration; MERGE-APPROVERS awaits Viet's review) |
| T26 | B5 simulated-time scheduler: clock actions (opt-in `SCHEDULER_SIM_TRIGGER=1`) and "Check due jobs" run the governance jobs due at the stored simulated date through the unchanged B1/B2 runners; idempotent per job and date, failed runs retried, deferred while another finding writer runs; Scheduler tab shows last evaluated day per job | KayTee / Claude Code | feat/T26-scheduler-simulated-time | src/services/scheduler/simulated.ts, src/app/api/scheduler/simulated/, src/app/api/clock/shared.ts (additive, behind the setting), src/lib/scheduler-client.ts, src/components/agentic/scheduler-*.tsx, src/services/lifecycle/schema.ts (reset list only), tests/scheduler-simulated.test.ts | T25 (#37) | Advance the clock -> due job runs once per date with trigger simulated_clock; repeats are no-ops; failure retried; manual runs never overlap; reset clears it; clock unchanged with the setting off; no proposal, merge or archive; tests, build pass | review (D26 proposed) |
| T5 | Platform services: lifecycle engine, policy, semantic layer, clock/scheduler, audit, lineage | Viet / Claude (lifecycle part) | feat/T5-lifecycle | src/services/lifecycle/, src/app/api/ | T4 | Transitions, TTL, lease review, archive/restore covered by tests | done for lifecycle (merged #17; lifecycle, clock, audit, API); merge proposals, reassign_owner and lineage not included |
| T17 | Build step: build proposal → Lead approval → computed Temporary insight (golden path step 4) | Viet / Claude | feat/T17-build-temporary | src/services/build/, src/components/dashboard/ | T14, T15, T5 | REQ-S01 fixture builds; values trace to query and source rows; requester cannot approve | done (merged #21); demo trigger TEAM-REQ-01 (D18, #22); agent trigger is T16 |
| T6 | Mastra agents + workflow with approval pause; step event stream | TBD (Lane A) | feat/T6-agents | src/mastra/ | T4, contract | REQ-0001 run emits step events; build path creates a Temporary insight | todo |
| T7 | UI shell: tabs, role toggle, Dashboard tab, lineage panel | Viet / Claude | feat/initial-ui-mastra | src/app, src/components | Contract fixtures | Employee sees only Dashboard; lineage opens on click | doing (shell, dashboard, chat done; lineage panel todo) |
| T8 | Agentic Chat view, Pipeline view, approval inbox, clock control | Viet / Claude (inbox, clock, timeline) | feat/T8-lifecycle-ui | src/components/lifecycle/ | T5 (#17) | Both views show the same run; reject needs a reason | doing (approval inbox, clock bar, audit timeline + restore done; Pipeline view and run approvals todo) |
| T9 | README / architecture note, demo script, video | TBD | feat/T9-docs-demo | README.md, docs/ | T5–T8 | R18 met; video recorded | todo |
| T19 | Plan, then implement reviewed LLM-generated synthetic estate scenarios (D24) | TBD | TBD | TBD (design first) | T16B and current golden-path integration complete; implementation design approved | Original pack preserved; generated records labelled team-authored/LLM-generated throughout; reviewed deterministic fixtures with known outcomes evaluated by real validation/governance; evidence-backed recommendations, required human decisions and measurable before/after demonstrated | todo (future; implementation not assigned) |

D24 sets direction only. T19 follows T16B and the current golden path; schema,
seed workflow, detection methods, UI, owner, schedule and dataset size remain
undecided. T13's evaluation work can inform the fixture expectations. Existing
task states and T16A/T16B/T17 contracts are not changed by this planning item.

## Build order (D14)

Golden path first, end to end on `master`, before the rest of P0:

1. REQ-0001: clarify the text vs. context conflict.
2. Discovery returns reuse candidates with source IDs and coverage gaps.
3. Conflict detector explains KPI-004 vs. KPI-005 without invented numbers.
4. Requester confirms reuse, or a Lead approves one Temporary insight on
   mapped KPIs.
5. One lease review, one default archive and restore, audit trail.

Then: remaining promotions, merge execution, Pipeline view, counts panel,
lineage polish. Nothing is cut; this only sets the order.

T3 (KayTee) was merged in #7 and folded into Viet's scope on
docs/bayer-challenge: accepted parts in D10, exceptions in D9 and D11.

For bigger tasks, add details under the table:

```text
T<id>: <outcome>
Requirement: R<ids>
Scope / not included:
Done when: <observable result>
How to check: <command or manual steps, expected result>
Estimate:
```

## Final-source intake (T2)

Final DOCX/PDF and workbook inspected on 2026-11-06; see DATA_SOURCES.
Pharmaceuticals-only scope replaces the Crop Science demo. Team must approve
revised SCOPE and contract before assigning app work. T1 remains Viet’s task;
this intake does not claim his planning decisions.

## Timeline

A proposal; adjust as we go.

| When | Goal |
| --- | --- |
| Fri 17:30-22:00 | Challenge chosen, approach + contract agreed, riskiest piece proven |
| Sat 12:00 | Golden path (Build order) works on `master` (ugly is fine) |
| Sat (Q&A) | Ask the company our open questions |
| Sat 22:00 | **Scope freeze.** Only fixes and polish after this |
| Sun 06:00-08:30 | Record and upload the demo video, write the description |
| Sun 09:00 | Submit (1-hour buffer) |
| Sun 10:00 | Submission closes |

If we fall behind, cut "nice" features first. Never cut the video.

## Submission checklist

- [ ] Project name and one-sentence tagline
- [ ] Description (problem, solution, how it works, AI tools used)
- [ ] Technologies list
- [ ] Repo link (public or shared as the rules require)
- [ ] YouTube demo video
- [ ] Source code .zip
- [ ] IP terms accepted
- [ ] Optional: demo URL, pitch deck

# Plan

Status: challenge chosen (D1). Scope follows the Miro pipeline and UI vision
(SCOPE, D7–D9). Lanes and tasks below are proposed until KayTee agrees.

## Team

| Developer | Agent | Lane | Strengths |
| --- | --- | --- | --- |
| Viet | Claude Code | TBD | TBD |
| KayTee | Codex | TBD | TBD |

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
| T10 | Resolve scope/design contradictions; 1 day = 1 s clock with god mode | KayTee / Claude Code | docs/T10-scope-contradictions | docs/, summary/ | D9, D10 | D12 recorded; SCOPE, REQUIREMENTS, ARCHITECTURE and summary agree; Viet reviews | review |
| T4 | Scaffold Next.js + Mastra + SQLite; import Bayer XLSX | TBD | feat/T4-scaffold | app/, src/db/ | D7 agreed | App runs; sheet counts match DATA_SOURCES | todo |
| T5 | Platform services: lifecycle engine, policy, semantic layer, clock/scheduler, audit, lineage | TBD (Lane A) | feat/T5-services | src/services/ | T4 | Transitions, TTL, lease review, archive/restore covered by tests | todo |
| T6 | Mastra agents + workflow with approval pause; step event stream | TBD (Lane A) | feat/T6-agents | src/mastra/ | T4, contract | REQ-0001 run emits step events; build path creates a Temporary insight | todo |
| T7 | UI shell: tabs, role toggle, Dashboard tab, lineage panel | TBD (Lane B) | feat/T7-shell | app/ | Contract fixtures | Employee sees only Dashboard; lineage opens on click | todo |
| T8 | Agentic Chat view, Pipeline view, approval inbox, clock control | TBD (Lane B) | feat/T8-agentic-ui | app/ | Contract fixtures | Both views show the same run; reject needs a reason | todo |
| T9 | README / architecture note, demo script, video | TBD | feat/T9-docs-demo | README.md, docs/ | T5–T8 | R18 met; video recorded | todo |

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

A proposal. Adjust once the challenge is known.

| When | Goal |
| --- | --- |
| Fri 17:30-22:00 | Challenge chosen, approach + contract agreed, riskiest piece proven |
| Sat 12:00 | End-to-end slice works on `master` (ugly is fine) |
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

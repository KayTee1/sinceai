# Requirements

Status: **draft** from our scope idea ([SCOPE](SCOPE.md), D2). Re-check after
the Bayer briefing before building.

Each requirement links to the brief (CHALLENGE), our scope (SCOPE) or an agreed
decision (D#). "Must" means the demo fails without it. Everything else is "nice".

| ID | Requirement | Source | Must / nice | How we check it |
| --- | --- | --- | --- | --- |
| R1 | Seeded synthetic dataset with all planted problems + `ground_truth.json` | SCOPE P0 | must | Same output every run; planted counts match ground truth |
| R2 | Intake: question → Reuse / Extend / Build new with score and evidence | CHALLENGE, SCOPE F2 | must | Anna's question returns Extend at ~0.78 with reasons |
| R3 | Metric conflict explainer on the 4 "net revenue" variants; numbers from SQL | CHALLENGE, SCOPE F3 | must | All 4 detected; gap from executed query; query text stored |
| R4 | Proposals queue: Approve / Reject / Edit; reject and edit need a reason | CHALLENGE (human oversight), SCOPE | must | Reject without reason is blocked |
| R5 | Append-only audit log on every proposal and decision + per-asset timeline | SCOPE F4 | must | One row per proposal/decision; timeline renders |
| R6 | Lease review for one team: Renew / Merge / Retire with evidence; unrenewed archived | SCOPE F1, F2 | must | Cycle review lists due assets; archive sets status, never deletes |
| R7 | Simulated clock with fast-forward | SCOPE P0 | must | Fast-forward moves date and replays usage |
| R8 | Gap attribution per definition difference | SCOPE F3 P1 | nice | Parts add up to the total gap |
| R9 | Promotion ladder; rising star reaches Certified with approval | SCOPE F2 P1 | nice | After fast-forward a promote proposal appears |
| R10 | Orphan detection and owner reassignment | SCOPE F1 P1 | nice | 10 planted orphans flagged with owner proposal |
| R11 | Portfolio view with before/after counts | SCOPE P1 | nice | Counts change after cycle review |
| R12 | Health score breakdown, audit export, cost saved | SCOPE P2 | nice | Only if time remains |

## Demo script

Target 5 minutes per SCOPE; the submission video may need to be shorter
(unknown). Full beats in [SCOPE](SCOPE.md#demo-script-5-minutes).

1. The pain: portfolio view, 4 revenue definitions, zombie share.
2. Anna asks; agent asks which decision it supports.
3. Reuse first: Extend over Build new, with score and evidence.
4. Conflict explainer: two numbers, the gap, the causes, the proposal.
5. Presenter rejects a proposal with a reason; it lands in the audit log.
6. Fast-forward 90 days: rising star promoted; cycle review renew / merge / retire.
7. Audit timeline for one asset.
8. Before/after numbers; "Every dashboard must earn its next 90 days."

## Out of scope

- Real Bayer data or systems; all data is synthetic and labelled as such.
- Real BI tools (we draw simple charts ourselves).
- Login, SSO, permissions.
- Production scale and performance.
- Real compliance certification (we show ALCOA+ / EU AI Act principles only).

## Assumptions and unknowns

| Assumption / unknown | Affects | Who resolves it |
| --- | --- | --- |
| Synthetic data is acceptable (no Bayer data provided) | R1, whole demo | Bayer briefing |
| Bayer cares about DSO / 90-day cycle fit | F1 pitch angle | Bayer briefing |
| Required outputs and judging criteria | Priorities | Bayer briefing / organizers |
| Required or preferred tech (e.g. their BI stack) | Stack | Bayer briefing |
| IP terms | Submission | Organizers |
| Video length limit | Demo script | Organizers |

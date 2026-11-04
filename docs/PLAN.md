# Task plan

Status: infrastructure prepared; awaiting challenge selection.

Use one row per task. Allowed states: ready, active, blocked, review, done.
An active task must have a named human owner and agent/session, dependencies,
acceptance criteria, and claimed files. Agree on claims directly between developers
before starting; reconcile the shared plan during integration.

| ID | Task | Owner / agent | Branch | Claimed files | Dependencies | Acceptance criteria | State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | Bootstrap the selected challenge | Unassigned | TBD | docs/ and README.md | Official brief available | Brief captured; MVP checks, stack decisions, runnable-slice tasks and demo time agreed | blocked |

## Scheduling

- Deadline and timezone: unknown
- MVP integration checkpoint: set after deadline is known
- Scope freeze and demo rehearsal: reserve explicitly during bootstrap
- Integration owner: agree between the two developers

Start with a runnable vertical slice, then split independent tasks by file
ownership. Add optional work only after must-have scope is secure. If time runs
short, cut optional scope and record the decision; never silently drop a must-have.

# Task plan

Status: initialization T3 validated and independently approved; human integration pending. Challenge not announced.

Use one row per task. Allowed states: draft, ready, active, blocked, review, done.
Draft means proposed scope or unresolved inputs; ready means actionable and
dependencies satisfied, not permission to implement. Use the
[task template](../prompts/task-template.md) below the table for challenge tickets.
An active task must have a named human owner and agent/session, dependencies,
acceptance criteria, and claimed files. Agree on claims directly between developers
before starting; reconcile the shared plan during integration.
Move active → review after validation; move review → done only after the required
review path in AGENTS is satisfied (independent review for high-risk work, human
integration review for low-risk work). Human integration must be recorded.

| ID | Task | Owner / agent | Branch | Claimed files | Dependencies | Acceptance criteria | State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | Bootstrap the announced challenge | Unassigned | TBD | docs/ and README.md | Challenge summary or official brief available; intake writer/coordinator agreed | Source/provenance captured; proposed MVP and tickets with validation; unknowns and pending decisions explicit; human checkpoint presented | blocked |
| T2 | Evaluate and tighten the shared AI workflow | Requesting developer / Codex, current session | master (serial documentation work) | AGENTS.md, README.md, docs/PLAN.md, docs/CHALLENGE.md, docs/REQUIREMENTS.md, docs/agent/HANDOFF.md, docs/agent/REVIEW.md, prompts/bootstrap-challenge.md, prompts/implement-task.md, prompts/prepare-next-task.md, prompts/task-template.md | Existing workflow inspected; clean checkout | Planning-only intake handles summaries and unknowns; tickets have traceable acceptance and validation; shared claims and implementation gate are explicit; local links and diff checked; independent review | done |

T2: independently approved; see [review evidence](agent/REVIEW.md). Human
integration pending; changes remain uncommitted. No integration was authorized.

| ID | Task | Owner / agent | Branch | Claimed files | Dependencies | Acceptance criteria | State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T3 | Complete initialization against the expanded specification | Requesting developer / Codex, current session | master (serial documentation work) | AGENTS.md, CLAUDE.md, README.md, .gitignore if needed, docs/, prompts/ | Preserve uncommitted T2 work; inspect all existing files | Requested workflow covered without application assumptions; links and Git checks pass; independent review | done |

T3: independently approved after F2 clarification; human integration pending.
No commits, pushes, branch changes or remote configuration performed.

Challenge backlog order will express priority. For each challenge ticket record
MVP-critical: yes/no, and parallel-safe with: task IDs or none, including the
interface contract that permits independent work. Human A and Human B are role
labels to replace with agreed names; pair each with Claude, Codex, or unassigned.

## Scheduling

- Deadline and timezone: unknown
- MVP integration checkpoint: set after deadline is known
- Scope freeze and demo rehearsal: reserve explicitly during bootstrap
- Integration owner: agree between the two developers
- Shared-doc writer and claim coordinator: agree before challenge bootstrap;
  one writer at a time. Acknowledge claims in a channel visible to both humans.

Start with a runnable vertical slice, then split independent tasks by file
ownership. Add optional work only after must-have scope is secure. If time runs
short, cut optional scope and record the decision; never silently drop a must-have.

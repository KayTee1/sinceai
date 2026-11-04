# Independently review a task

Input: task ID, base/head commits or explicit uncommitted diff scope, and author.
Use a reviewer who did not implement the task. If you implemented it, request
an independent reviewer instead of approving your own changes.

Read AGENTS.md, relevant requirements, task acceptance criteria, and architecture.
Inspect Git state and establish a stable review scope. Review the actual changes
and surrounding behavior, not just the author's summary. Do not modify the code.

Check requirement coverage, correctness, regressions, secrets/data handling,
failure cases, complexity, and whether the documented run/demo path works.
Run appropriate checks when possible; record unrun checks and limits honestly.
Avoid speculative improvements outside the task.

Record reviewer, exact scope, validation evidence, verdict, and actionable findings
in docs/agent/REVIEW.md. Each finding needs an ID, severity, location, impact, and
requested fix. Approve only when acceptance is supported and no blocking or important findings
remain. Include reproduction steps when applicable and identify missing or failed
tests. Rank findings by impact; distinguish important nonblocking fixes from
optional improvements.
Human integration approval is still required. Summarize blockers first;
do not commit or push unless authorized.

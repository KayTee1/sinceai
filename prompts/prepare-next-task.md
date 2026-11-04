# Prepare the next task or session

Read AGENTS.md and inspect Git status, branch, recent commits, PLAN, HANDOFF,
and active REVIEW findings. Preserve all unfinished work.

Reconcile task status with actual acceptance and review evidence. Record completed
work without declaring unreviewed work done. Identify remaining blockers, dirty
files and their owners, integration needs, and the shortest path to a working demo.

Select the next ready task based on dependencies and time remaining. Give it a
clear owner, file scope, acceptance criteria, and validation steps. If no task is
ready, state the exact dependency or human decision needed. Coordinate claims
between developers before parallel work. Cut optional scope if needed through
an explicit team decision.
Selection is a proposal until the human coordinator acknowledges ownership;
do not claim another developer's task or treat preparation as permission to code.
Check overlapping ownership and recommend any safely parallel task, naming the
contract and file boundaries that make it safe. Prefer the highest-priority
MVP-critical task whose dependencies are satisfied.

Replace HANDOFF with a concise restart snapshot: task/owner, branch/commit,
working-tree state, result, checks and outcomes, review/blocker links, and one next
action. Update PLAN; change other docs only when their content has changed.
Report readiness and the next action. Do not start implementation, commit, or
push as part of this preparation unless explicitly requested.

# Implement one task

Input: task ID from docs/PLAN.md and the human owner/agent session.

Follow AGENTS.md. Inspect Git state and read the relevant requirements, plan,
architecture, and handoff. Confirm the task is ready, dependencies are satisfied,
the human has authorized implementation and accepted relevant scope/decisions,
acceptance criteria are testable, and file ownership is coordinated. If the task
ID is absent, propose a ready task; obtain authorization before coding unless the
human has already authorized selecting and executing ready tasks.

Use an isolated task branch/checkout for parallel work. Mark the task active;
implement the smallest complete change within scope. Keep the application runnable.
Inspect affected code before editing. Add appropriate tests for changed behavior
and relevant failures; avoid tests that merely repeat the implementation.
Raise major decisions instead of silently resolving them. Do not edit files owned
by another active task without coordination.

Run relevant checks and acceptance steps. Inspect the final diff for unrelated
changes and secrets. Update PLAN to review and refresh HANDOFF with exact results,
limitations, dirty files, and the next action. Request an independent review of a
stable, identified diff. Report what changed and what was verified. Do not claim
approval, commit, or push without the required authorization. When a commit is
explicitly authorized, stage only task paths, inspect the staged diff and create
a scoped commit. Preserve unrelated dirty files; never include them for convenience.
Low-risk tasks may use human integration review per AGENTS.md; record that path
instead of requesting unnecessary separate agent review.

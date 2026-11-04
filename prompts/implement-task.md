# Implement one task

Input: task ID from docs/PLAN.md and the human owner/agent session.

Follow AGENTS.md. Inspect Git state and read the relevant requirements, plan,
architecture, and handoff. Confirm the task is ready, dependencies are satisfied,
acceptance criteria are testable, and file ownership is coordinated. If the task
ID is absent, select a ready task and establish its scope before coding.

Use an isolated task branch/checkout for parallel work. Mark the task active;
implement the smallest complete change within scope. Keep the application runnable.
Raise major decisions instead of silently resolving them. Do not edit files owned
by another active task without coordination.

Run relevant checks and acceptance steps. Inspect the final diff for unrelated
changes and secrets. Update PLAN to review and refresh HANDOFF with exact results,
limitations, dirty files, and the next action. Request an independent review of a
stable, identified diff. Report what changed and what was verified. Do not claim
approval, commit, or push without the required authorization.

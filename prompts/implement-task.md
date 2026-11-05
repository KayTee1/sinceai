# Implement a task

Input: task ID from `docs/PLAN.md`. Building it must be authorized by your human.

1. Follow AGENTS.md. Check `git status`/branch; read the task, the demo script
   (REQUIREMENTS) and the interface contract (ARCHITECTURE).
2. Work on the task's branch (`feat/T<id>-short-name`). Set the task to `doing`.
3. Build the smallest thing that meets "done when". Keep the app runnable.
   Stick to the contract; if it needs to change, stop and ask.
4. Add tests where they're cheap and useful (AI pipeline logic, parsing,
   contract shapes). Don't spend demo time on test coverage.
5. Run the task's "how to check" plus any tests. Check the diff for secrets
   and unrelated changes.
6. Update the task to `review` (or `done` if a human merged it), refresh
   HANDOFF, and add any new run commands to ARCHITECTURE.
7. Report: what changed, commands run with results, anything not checked.
   Commit/push only if your human asks.

## Fixing review findings

Given finding IDs from `docs/agent/REVIEW.md`: fix blocking and important
ones first, with small focused changes. If you disagree with a finding, say
why and let the humans decide; don't silently skip it. Re-run checks and
update the finding's state.

# Shared agent instructions

Applies to every coding agent in this repository. Claude Code also reads
`CLAUDE.md`. Keep shared rules here rather than duplicating them.

## Principles

- Challenge requirements in `docs/CHALLENGE.md` are the source of truth.
  Track derived, testable requirements in `docs/REQUIREMENTS.md`.
- Never invent requirements or turn assumptions into facts. Label unknowns.
- Prefer the simplest solution that meets the challenge. Build a runnable
  vertical slice before adding features; keep it runnable as work progresses.
- Favor proven libraries and simple architecture. Avoid speculative abstractions
  and unrelated refactoring.
- Do not silently make major product or architecture decisions. Present the
  tradeoff to a human and record the agreed choice in `docs/DECISIONS.md`.
- No challenge, stack, deployment target, or application architecture is selected
  yet. Initialization is not permission to implement an application.

## Git and parallel work

- Before editing, inspect `git status`, the branch, relevant files, and applicable
  instructions. Preserve existing work; never discard another contributor's edits.
- Use small, logically scoped commits. Stage explicit paths, inspect the staged
  diff, and exclude unrelated changes, secrets, credentials, and build artifacts.
- Never rewrite shared history or force-push. Do not automatically push.
- Commit only when requested or explicitly authorized by the team workflow.
- Two developers may work in parallel, each with their own agent. Use a separate
  branch and checkout/worktree for each active task. Do not run concurrent writers
  in the same checkout or branch, even if their intended files differ.
- Claim the task and intended files in `docs/PLAN.md` before implementation.
  Coordinate shared-file changes with the other owner; do not overwrite their work.
- Until the first commit exists, work serially. After a human creates the initial
  commit, branches/worktrees can be created from that shared baseline.
- Keep task ownership changes visible to both developers before parallel work
  starts. A task claim in an unshared branch is not a coordination mechanism.

## Task execution

1. Read relevant requirements, `docs/PLAN.md`, and `docs/agent/HANDOFF.md`.
2. Work on one scoped task. Identify its owner, dependencies, affected files,
   acceptance criteria, and a realistic validation command or manual check.
3. Implement the smallest complete result. Ask about consequential unknowns;
   continue independent work where possible. Escalate blockers promptly.
4. Run checks appropriate to the change. Report exact commands, outcomes, and
   any skipped checks. Never report an unrun check as passing.
5. Update task status and the handoff with the result, remaining risks, and next
   action. Update requirements, architecture, and decisions only when they change.
6. Request independent review before integration. The implementing agent must not
   approve its own work. A second human or a fresh reviewer agent with no role in
   implementation may review; a human owns the final integration decision.
7. Fix review findings, revalidate, and have material fixes rechecked. Do not mark
   a task done until acceptance criteria and required review are satisfied.

## Keep coordination lightweight

`docs/PLAN.md` owns task state; `docs/agent/HANDOFF.md` owns the current restart
point; `docs/agent/REVIEW.md` owns active review findings. Link rather than copy.
Use short stable IDs (R1, T1, D1, F1). Keep the handoff current, not a transcript.
Never put secrets or private credentials in documentation or prompts.

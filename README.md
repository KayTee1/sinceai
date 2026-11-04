# Since AI Hackathon 2026

Workspace for two developers using Claude Code and OpenAI Codex.
The challenge and technology stack have not been selected. This repository
currently contains development coordination and prompts, not an application.

## Start here

1. Read [AGENTS.md](AGENTS.md) and [the handoff](docs/agent/HANDOFF.md).
2. When the challenge arrives, designate one agent as the shared-doc writer and
   one human as claim coordinator. Paste the brief or summary using the intake
   prompt below to propose an MVP and tickets; keep unknowns and choices explicit.
3. Claim one task in [the plan](docs/PLAN.md), including acceptance criteria and
   ownership. Establish a first commit before starting parallel branches.
4. Use a separate branch and checkout/worktree per active task. Each developer
   coordinates their agent; agree on shared-file ownership before editing.
5. Implement and validate with [implement-task](prompts/implement-task.md).
   For high-risk work, have the other developer or a fresh agent use
   [review-task](prompts/review-task.md); low-risk changes use human integration review.
6. Resolve findings with [fix-review](prompts/fix-review.md). A human integrates
   reviewed work, then [prepare-next-task](prompts/prepare-next-task.md) refreshes
   the handoff and selects the next useful task.

Share task claims directly between developers before parallel work begins.
Integrate small changes frequently; revalidate the combined application.
Keep time for a complete demo path and rehearsal before the submission deadline.

## Challenge intake

Paste this into either developer's agent after agreeing who owns intake:

```text
Follow prompts/bootstrap-challenge.md. Planning only; do not implement.
Turn this challenge into sourced requirements, a proposed smallest demo,
dependency-ordered tickets using prompts/task-template.md, and questions for
consequential unknowns. Update the existing planning docs, preserving stable IDs.
Keep product/stack choices proposed until we agree. Finish with the decisions
we need to make and the first task you recommend authorizing.

Challenge brief or summary: <paste here>
Source and whether this is official or a team summary: <known or unknown>
Deadline/timezone, team availability and other constraints: <known or unknown>
Intake writer and human claim coordinator: <agreed names/sessions>
```

No background automation is installed: a developer invokes this prompt. Either
agent uses the same repository workflow. Review and accept the proposed scope
and consequential decisions, then authorize implementation of a ticket. The
coordinator acknowledges claims where both developers can see them before
agents work in separate worktrees. Shared planning files have one writer at a
time; task branches reconcile their updates serially during human integration.

Use [ticket details](prompts/task-template.md) in PLAN for actionable work;
no issue tracker or hosting provider is required. Before coding, agree on the
integration owner and checkpoint, scope freeze, and demo rehearsal time.

## Two-developer Git workflow

Recommended convention: retain the existing `master` as the integration branch
(confirm with both humans; no branch rename is needed), and use task branches
such as `feat/T1-short-description` or `fix/T4-short-description`. This preserves
the repository's T1-style IDs. One human owns integration; both can implement.
Keep the integration branch runnable once the first slice exists.

1. The coordinator acknowledges a ready task's human/agent owner, files and
   dependencies in a channel visible to both developers, and the designated
   planning writer records it in PLAN. Each agent reads its own checkout's
   instructions and handoff. Confirm shared interface contracts before splitting.
2. Start each concurrent task from the agreed integration commit in a separate
   checkout/worktree. After the current initialization changes have been reviewed
   and committed by an authorized human, an example from the repo root is:

   ```sh
   git status --short
   git worktree add -b feat/T1-short-description ../sinceai-T1 master
   ```

   Run that task's agent inside the new directory. Do not switch a working
   agent's branch underneath it. Git worktrees share repository history, not files.
3. Keep commits small and task-scoped when authorized. Shared docs have one writer
   at a time: send concise status to the coordinator; reconcile docs serially at
   integration instead of having every agent rewrite the common handoff.
4. Identify a stable diff for independent review where required. Fix findings and
   recheck material changes. A human reviews low-risk changes and owns every
   integration decision; no agent approves its own implementation.
5. The integration owner merges one reviewed task at a time, runs relevant
   combined checks and the demo smoke path, and records integration evidence.
   Check branch status first; do not integrate over someone else's unfinished work.
   Never push automatically or configure remote services as part of this workflow.
6. For conflicts, pause integration and involve the file/task owners. Inspect both
   versions, resolve the intended behavior and contracts, rerun affected checks,
   and re-review material resolutions. Do not blindly choose one side, discard
   another owner's work, rebase shared history or force-push.

## Event stages

Work in this order: challenge analysis and human solution selection; a runnable
end-to-end slice; independent features with frequent integration; stabilization
and demo rehearsal; final submission. At bootstrap, work backward from the actual
deadline to agree an integration checkpoint, scope freeze, rehearsal and submission
buffer. Include submission format/rules checks and an owner for the final upload.
No fixed time split is assumed. Cut optional features before consuming the time
needed to run the whole demo and submit it reliably.

## Reusable agent requests

After the intake prompt above and human approval, use these in either agent;
replace placeholders with actual task IDs, owners and review scope:

```text
Follow prompts/implement-task.md for <task ID>, owned by <human / agent session>.
Implementation of this task is authorized. Do not commit or push.

Follow prompts/review-task.md for <task ID>, author <agent/session>,
scope <base..head commits or explicit uncommitted file list and captured diff>.
Review independently; do not modify implementation.

Follow prompts/fix-review.md for <task ID>, findings <IDs>.
Fix only verified findings. Do not commit or push.

Follow prompts/prepare-next-task.md. Recommend the next assigned scope and
safe parallel work; do not start implementation.
```

After a context reset, inspect Git status/branch/log, then read AGENTS, PLAN,
HANDOFF and active REVIEW findings before resuming. Do not treat a stale handoff
as proof of the current Git state or ownership.

## Documentation map

| File | Purpose |
| --- | --- |
| [CHALLENGE](docs/CHALLENGE.md) | Original brief, rules, deadline, judging and unknowns |
| [REQUIREMENTS](docs/REQUIREMENTS.md) | Testable MVP scope and explicit exclusions |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Agreed structure, run/test instructions and demo path |
| [PLAN](docs/PLAN.md) | Task ownership, dependencies, acceptance and status |
| [DECISIONS](docs/DECISIONS.md) | Consequential choices and their rationale |
| [HANDOFF](docs/agent/HANDOFF.md) | Current restart point for the next session |
| [REVIEW](docs/agent/REVIEW.md) | Independent review evidence and unresolved findings |

There are no installation, run, build, or test commands yet. Add verified commands
to ARCHITECTURE and link them here when the stack is chosen. No deployment or
hosting service is assumed.

# Since AI Hackathon 2026

Workspace for two developers using Claude Code and OpenAI Codex.
The challenge and technology stack have not been selected. This repository
currently contains development coordination and prompts, not an application.

## Start here

1. Read [AGENTS.md](AGENTS.md) and [the handoff](docs/agent/HANDOFF.md).
2. When the challenge arrives, use [bootstrap-challenge](prompts/bootstrap-challenge.md)
   to capture the brief, define the MVP, and agree on a stack.
3. Claim one task in [the plan](docs/PLAN.md), including acceptance criteria and
   ownership. Establish a first commit before starting parallel branches.
4. Use a separate branch and checkout/worktree per active task. Each developer
   coordinates their agent; agree on shared-file ownership before editing.
5. Implement and validate with [implement-task](prompts/implement-task.md).
   Have the other developer or a fresh agent use [review-task](prompts/review-task.md).
6. Resolve findings with [fix-review](prompts/fix-review.md). A human integrates
   reviewed work, then [prepare-next-task](prompts/prepare-next-task.md) refreshes
   the handoff and selects the next useful task.

Share task claims directly between developers before parallel work begins.
Integrate small changes frequently; revalidate the combined application.
Keep time for a complete demo path and rehearsal before the submission deadline.

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

# Since AI Hackathon 2026

Team workspace for two developers (Claude Code + Codex) at the
[Since AI Hackathon](https://sinceai.ai/hackathon), Turku, 6-8 Nov 2026.
We're building **Analytics Steward** for Bayer's "Build Less, Build Better"
challenge: agents that reuse before they build and make every dashboard earn
its next 90 days. TypeScript, Next.js + Mastra + SQLite. See
[SCOPE](docs/SCOPE.md). Run instructions: [ARCHITECTURE](docs/ARCHITECTURE.md#run-commands).

## Key times (EET)

| When | What |
| --- | --- |
| Thu 5 Nov 15:00 | Challenge summaries open in sinceai.app |
| Fri 6 Nov 17:30 | Challenge selection closes (final) |
| Sat 7 Nov | Company Q&A, so bring questions |
| **Sun 8 Nov 10:00** | **Submission closes** |

Check sinceai.app on the day; organizer updates win over this table.

## How we work

1. **Pick and plan the challenge.** One developer runs the intake:
   - Claude Code: `/since-ai-challenge`
   - Codex (or Claude without the skill): paste the intake request below.

   The output is the brief in `docs/CHALLENGE.md`, an agreed approach in
   `docs/DECISIONS.md`, an interface contract in `docs/ARCHITECTURE.md`, and
   tasks in `docs/PLAN.md`.
2. **Agree, then split.** Both developers approve the approach and the
   contract. Each takes a lane (e.g. AI/backend vs. UI/demo) and a task.
3. **Build in parallel**, each in their own worktree:

   ```sh
   git worktree add -b feat/T2-short-name ../sinceai-T2 master
   cd ../sinceai-T2   # start your agent here
   ```

4. **Merge often.** Small branches into `master`; keep `master` runnable.
   Risky changes get a review from the other agent first.
5. **Freeze, record, submit.** Follow the timeline and submission checklist
   in `docs/PLAN.md`.

## Agent requests

```text
Intake: Follow prompts/bootstrap-challenge.md. Planning only.
Challenge brief: <paste>   Restricted/NDA: <yes/no/unknown>

Implement: Follow prompts/implement-task.md for T<id>. You're authorized to build it.

Review: Follow prompts/review-task.md for T<id>, branch <name>. Don't modify code.

Next: Follow prompts/next-task.md. Suggest what each developer does next.
```

## Docs

| File | What it holds |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Rules for both agents |
| [CHALLENGE](docs/CHALLENGE.md) | The brief, rules, judging, open questions |
| [SCOPE](docs/SCOPE.md) | What we build: pipeline, screens, priorities |
| [DATA_SOURCES](docs/DATA_SOURCES.md) | Bayer data pack facts and limits |
| [REQUIREMENTS](docs/REQUIREMENTS.md) | MVP scope and the demo script |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Stack, interface contract, run commands |
| [PLAN](docs/PLAN.md) | Tasks, owners, timeline, submission checklist |
| [DECISIONS](docs/DECISIONS.md) | Agreed choices and why |
| [HANDOFF](docs/agent/HANDOFF.md) | Where we are right now |
| [REVIEW](docs/agent/REVIEW.md) | Open review findings |

Run commands go in ARCHITECTURE once the stack is chosen.

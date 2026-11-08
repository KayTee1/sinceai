# Agent instructions

Shared rules for every coding agent in this repo (Claude Code and Codex).
Claude Code also reads `CLAUDE.md`, which just points here.

## Context

Two developers, each with their own agent, competing at the Since AI Hackathon
(Turku, 6-8 Nov 2026). We pick one company challenge on Friday and must submit
a working AI demo by **Sunday 10:00 EET**. Speed and a working demo beat process.

## Before you start any task

1. Check `git status` and the current branch.
2. Read `docs/agent/HANDOFF.md`, then the relevant parts of `docs/PLAN.md`,
   `docs/REQUIREMENTS.md` and `docs/ARCHITECTURE.md`.
3. Work on one task from PLAN. If no task is assigned, propose one and wait.

## Rules

- **The challenge is the source of truth.** `docs/CHALLENGE.md` holds the
  brief. Don't invent requirements; mark unknowns as `unknown`.
- **Plan before building.** A new challenge brief means planning only
  (`prompts/bootstrap-challenge.md`). Write app code only after a human has
  approved the approach and assigned the task.
- **Smallest thing that works.** Build an end-to-end slice first, keep it
  runnable, add features after. Use proven libraries. No speculative
  abstractions or unrelated refactors.
- **Ask about big decisions.** Stack, architecture or scope changes go to a
  human first; record the agreed choice in `docs/DECISIONS.md`.
- **Respect the contract.** The two lanes talk through the interface in
  `docs/ARCHITECTURE.md`. Changing it needs both developers to agree.
- **Verify, don't claim.** Run the checks you can. Report exact commands and
  results. Never say something passes if you didn't run it.

## Git

- One branch per task (`feat/T<id>-short-name`), branched from `master`.
  Exception: owner-approved documentation refresh uses
  `docs/mvp-repository-refresh` from the verified committed integration baseline.
  Document that SHA, use an isolated worktree during parallel development,
  edit only approved documentation paths, and reconcile against the final
  approved integration before publishing a PR. Documentation approval does not
  approve implementation or clear independent-review gates.
  When both developers work at once, use separate worktrees (see README).
- Small, focused commits. Stage explicit paths and check the diff for secrets.
- Commit and push only when your human asks. Never force-push or rewrite
  shared history.
- Don't edit files owned by the other developer's active task without asking.

## Review

- Changes to the interface contract, auth/secrets, data handling or the core
  AI pipeline: ask the other developer's agent (or the other human) to review
  with `prompts/review-task.md` before merging.
- Everything else: the human merging it reviews the diff and runs the demo.
- Agents never approve their own work.

## Security and event rules

- Never commit secrets. Keys go in `.env` (ignored by Git); commit `.env.example`.
- Don't commit NDA or confidential challenge data. Don't send restricted data to
  external AI services unless the challenge allows it.
- AI tools are allowed, but we must understand and explain what we ship, and
  disclose our main AI tools in the submission.
- Keep pre-existing work separate from what we build at the event.
- Respect licences and each challenge's data and IP terms.

## Keeping docs current

- `docs/PLAN.md`: task state (who's doing what).
- `docs/agent/HANDOFF.md`: short restart note. Replace it; don't append.
- `docs/agent/REVIEW.md`: open review findings only.
- Use stable IDs: R1 (requirement), T1 (task), D1 (decision), F1 (finding).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

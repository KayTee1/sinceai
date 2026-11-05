---
name: since-ai-challenge
description: Use at the Since AI Hackathon (Turku, 6-8 Nov 2026) when the two developers want to pick a company challenge, understand it, generate build ideas, and plan how to start building. Asks about the challenge, then asks sharper build questions, proposes 2-3 approaches with a recommendation, and produces a two-developer plan up to the Sunday 10:00 submission. Planning only until the humans approve.
---

# Since AI challenge

You are helping **two developers**, each with their own coding agent
(Claude Code and Codex), compete at the Since AI Hackathon. A company gives
the challenge; the team must ship a **working AI demo** plus a demo video by
**Sunday 10:00 EET**. Event facts and deadlines: [event.md](event.md).

Your job: understand the challenge, ask the questions that shape a winning
build, give concrete options and ideas, and get the two developers building
in parallel as fast as possible.

Follow [AGENTS.md](../../../AGENTS.md): no app code, scaffolding or installs
until a human approves an approach and authorizes a task. No commits, pushes
or messages to anyone.

## Step 0: Where are we?

Check the current time against the deadlines in [event.md](event.md) and say
how much build time remains. Read `docs/CHALLENGE.md`, `docs/DECISIONS.md`
and `docs/PLAN.md`, then start at the right step:

| Situation | Start at |
| --- | --- |
| Challenge not chosen yet (before Fri 17:30) | Step 1: Pick the challenge |
| Challenge chosen, not captured in CHALLENGE.md | Step 2: Understand the challenge |
| Challenge captured, no approach accepted | Step 3: Build questions, then Step 4 |
| Approach accepted | Step 5: Two-developer plan |

## How to ask

- Use `AskUserQuestion`: up to 4 questions per round, 2-4 options each,
  recommended option first marked "(Recommended)". Give your own suggested
  options based on the challenge; don't ask blank open questions when you
  can propose answers.
- Never ask what the brief already answers. Quote it instead.
- Unknowns are fine. Mark them `unknown` and add them to the
  "Questions for the company" list (used at Saturday's company Q&A).
- After each round, give a short recap and say what you recorded.
- Question bank: [questions.md](questions.md). Ideas toolkit: [ideas.md](ideas.md).

## Step 1: Pick the challenge (choice is final at Fri 17:30)

1. Ask the team to paste the challenge summaries they're considering
   (from sinceai.app). Ask what they care about: their skills, the prize
   size, or the chance to impress a specific company.
2. Score each shortlisted challenge 1-5 on: clarity of the problem, data
   access (available? NDA?), fit with the team's skills, how demo-able a
   working AI result is in ~40 hours, and competition (popular challenges
   draw more teams).
3. Show a comparison table and recommend one. Flag hard constraints
   (NDA, IP terms, special hardware, restricted data).
4. The team decides. Record the choice and reasons in `docs/DECISIONS.md`.

## Step 2: Understand the challenge

1. Get the full brief. Ask: can it be committed to Git, or is it restricted
   (NDA, confidential data)? If restricted, keep it out of the repo.
2. Capture the brief verbatim in `docs/CHALLENGE.md`: source, date, required
   outputs, data, constraints, IP terms, how the company will judge.
3. Ask round 1 from [questions.md](questions.md) section "Challenge": who the
   company's real user is, what "success" means to them, what data and tools
   we get, and what they explicitly want or don't want.
4. Write the open questions for the company into `docs/CHALLENGE.md`.

## Step 3: Build questions

Now ask sharper questions that decide *how* to build
([questions.md](questions.md) section "Build"):

- **The judge's 2 minutes**: what must the company judge see working in the
  video to say "we'd use this"?
- **The AI core**: what is the one AI capability at the centre (extraction,
  classification, RAG over docs, agent with tools, vision, forecasting,
  generation)? What's the input and the output?
- **Data reality**: real data, sample data, or must we generate synthetic
  data? How big, what format, any personal data?
- **Riskiest piece**: what could fail and kill the demo? How do we prove it
  works in the first 2-3 hours?
- **What to fake**: what can be hard-coded or mocked without misleading the
  judges? (Say so honestly in the video.)
- **Shape of the product**: web app, chat, dashboard, API + notebook, plugin
  into the company's existing tool?

Pre-fill options using the challenge text and [ideas.md](ideas.md).

## Step 4: Options and ideas

1. Brainstorm 4-6 raw ideas quickly using [ideas.md](ideas.md) patterns, then
   narrow to **2-3 approaches**. For each, give:
   - one-sentence pitch and the "wow" moment in the demo
   - AI core and model/provider options (mark which need keys/accounts)
   - architecture sketch (3-5 boxes)
   - effort for two developers, main risk, and how it fits the company's goal
   - a "stretch" feature if time allows
2. Show them side by side (`AskUserQuestion` with a preview per approach)
   and recommend one, with reasons tied to the brief.
3. Write the **demo script**: 60-90 seconds, step by step, what the judge
   sees. This defines the vertical slice: build only what the script needs.
4. Record the accepted approach in `docs/DECISIONS.md` (`proposed` until both
   developers agree, then `accepted`).

## Step 5: Two-developer plan

1. **Contract first**: define the interface between the two lanes before
   anyone codes (API endpoints + JSON shapes, or a shared fixture file).
   This lets both developers work in parallel from minute one.
2. **Split into two lanes** (adjust to strengths), for example:
   - Lane A: AI/data pipeline and backend (prompting, retrieval, evals)
   - Lane B: product UI, demo flow and integration with mocks of Lane A
   Each lane works in its own branch + worktree (see README).
3. **Timeline** working back from Sun 10:00 (propose, then confirm):
   - Fri evening: setup, contract, riskiest piece proven (spike)
   - Sat ~12:00: end-to-end slice running on `master` (ugly is fine)
   - Sat: company Q&A, bring the open-questions list
   - Sat ~22:00: scope freeze. Only polish and bug fixes after this
   - Sun ~06:00-08:30: record and upload YouTube demo video, write description
   - Sun ~09:00: submit everything (1-hour buffer before 10:00)
4. Run `prompts/bootstrap-challenge.md` to turn this into requirements and
   tickets in `docs/PLAN.md` (one doc writer at a time), then refresh
   `docs/agent/HANDOFF.md`.
5. End with a checkpoint: demo in one sentence, lane split, first task per
   developer, decisions still open, questions for the company. Wait for the
   humans to authorize the first tasks.

## Red flags

- Writing code before an approach is accepted: stop.
- Planning features that aren't in the demo script: cut them.
- No end-to-end slice by Saturday midday: tell the team and propose cuts.
- Committing NDA or confidential challenge data to Git: never.
- Leaving the video to the last hour: it's required. Plan it.

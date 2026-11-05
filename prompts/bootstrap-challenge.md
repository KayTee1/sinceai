# Bootstrap the challenge

Planning only. Don't write app code, scaffold, or install anything.
In Claude Code, the `/since-ai-challenge` skill runs this same flow
interactively.

Input: the challenge brief (or summaries to choose between), and whether it's
restricted/NDA.

1. **Capture the brief** in `docs/CHALLENGE.md`: verbatim text (or a
   sanitized summary if restricted), source, required outputs, data, IP terms,
   how the company judges. Put unanswered questions in the "Questions for the
   company" table.
2. **Propose 2-3 approaches.** For each, give: one-line pitch, demo "wow"
   moment, AI core (model/provider), 3-5 component sketch, effort for two
   developers, main risk, and fit to what the company wants. Recommend one.
3. **Wait for both developers to pick.** Record it in `docs/DECISIONS.md`.
4. **Write the demo script** (60-90 s, what the judge sees) and must/nice
   requirements in `docs/REQUIREMENTS.md`.
5. **Define the interface contract** between the two lanes in
   `docs/ARCHITECTURE.md`, with example JSON and a mock/fixture so both lanes
   can start at once. Fill in stack and components.
6. **Create tasks** in `docs/PLAN.md`: first the end-to-end slice, then
   features ordered by the demo script. Two lanes with no overlapping files.
   Each task has "done when" and "how to check". Adjust the timeline.
7. **Update `docs/agent/HANDOFF.md`.**

Finish with: the demo in one sentence, decisions still open, questions for the
company, and the first task for each developer. Wait for approval before
anyone builds.

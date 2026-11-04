# Bootstrap the challenge

Input: the official challenge brief/source, organizer rules, known deadline and
timezone, and team constraints. If essential inputs are missing, ask for them;
do not invent them.

Read AGENTS.md, inspect Git status/branch/history and existing documentation.
Preserve existing work. Then:

1. Capture authoritative facts and unresolved questions in docs/CHALLENGE.md.
2. Propose the smallest demonstrable vertical slice, must-have acceptance checks,
   optional scope, and exclusions in docs/REQUIREMENTS.md. Tie each to a source.
3. Present consequential product/stack choices and tradeoffs for human agreement.
   Keep proposals marked pending until agreed; record accepted choices in DECISIONS.
4. Document the agreed high-level architecture without assuming services or tools.
5. Split the slice into small tasks in PLAN with dependencies, file ownership,
   acceptance criteria, and validation. Allocate two developer/agent lanes only
   where independent work is possible. Reserve integration and demo rehearsal time.
6. Refresh HANDOFF with unknowns and the first ready task. Update README if needed.

Do not implement the application in this bootstrap task. Report proposed MVP,
decisions needing agreement, blockers, and the next action. Do not commit or push
unless explicitly authorized.

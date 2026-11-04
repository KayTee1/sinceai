# Bootstrap the challenge

Input: a pasted challenge summary or official brief/source, plus any available
rules, deadline/timezone and team constraints. Process available information
first; label provenance, completeness and unknowns. Ask only for consequential
missing inputs and continue independent planning. A summary is sufficient for
provisional tickets, not for pretending missing organizer rules are known.

Read AGENTS.md, CLAUDE.md and docs/CHALLENGE.md; inspect Git status/branch/history
and existing documentation. Confirm permission before processing restricted input.
Preserve existing work. Then:

Confirm one shared-doc writer and a human claim coordinator before editing.
If another agent owns intake, return analysis for that owner instead of writing
the same documents. Re-running intake must update existing IDs and flag changed
requirements and affected tickets rather than duplicate or silently replace them.

1. Capture authoritative facts and unresolved questions in docs/CHALLENGE.md.
   Extract explicit constraints, deliverables and judging criteria; identify
   ambiguities, permissions and technical risks separately from requirements.
2. Propose the smallest demonstrable vertical slice, must-have acceptance checks,
   optional scope, and exclusions in docs/REQUIREMENTS.md. Tie each to a source.
3. Present consequential product/stack choices and tradeoffs for human agreement.
   Propose 2–3 feasible approaches, comparing implementation complexity, demo
   value and risk. Recommend an achievable MVP, stack and smallest demonstrable
   vertical slice, with reasons grounded in the brief and team time budget.
   Keep proposals marked pending until agreed; record accepted choices in DECISIONS.
4. Populate ARCHITECTURE with a clearly proposed high-level approach and TBDs;
   mark it agreed only after human approval. Do not assume services or tools.
5. Split the slice into small tasks in PLAN with dependencies, file ownership,
   acceptance criteria, and validation. Allocate two developer/agent lanes only
   where independent work is possible. Reserve integration and demo rehearsal time.
   Use prompts/task-template.md for ticket details and R IDs for traceability.
   Include a concrete validation procedure and expected result on every ticket.
   Leave owners unassigned until acknowledged; keep unresolved choices in draft
   or blocked tickets. Do not block independent planning on unrelated unknowns.
6. Refresh HANDOFF with unknowns and the first ready task. Update README if needed.

Do not implement the application in this bootstrap task. Report proposed MVP,
decisions needing agreement, blockers, and the next action. Do not commit or push
unless explicitly authorized.

Completion check: every proposed must-have has a source, observable acceptance
and ticket coverage; dependency order reaches a complete demo; unknowns have
resolution owners (or explicitly unassigned); no application code, package setup
or deployment was created. Present a short human checkpoint: proposed demo,
consequential choices with tradeoffs, missing inputs, and recommended first task.
Planning completion is not authorization to execute those tickets.

# Ticket template

Use this structure for each challenge ticket in docs/PLAN.md below its summary
row. Keep PLAN as the source of task state; an external tracker is optional and
must link back rather than create a competing task list. Replace placeholders
with evidence or explicit unknowns. Do not invent commands before selecting a stack.

```text
T<number> — Concrete outcome
Requirement/source: R IDs, challenge section, or approved D ID
Priority / MVP-critical: ordered priority; yes/no
Scope and exclusions:
Human owner / agent session: unassigned until claimed
Branch / worktree: pending
Claimed files or directories: pending; narrow after architecture is agreed
Dependencies: task IDs and required decisions/inputs
Parallel-safe with: task IDs or none; agreed interface contract and ownership
Acceptance criteria: observable behavior, including relevant failure cases
Validation: exact known command or concrete manual steps and expected result
Estimate: rough timebox, labeled estimate; split if too large for one review
Review: independent for high-risk / human integration review for low-risk;
        reviewer and stable diff scope, assigned before review
Integration: human owner; pending / integrated at commit; combined checks
```

Order tickets by dependencies. First deliver a runnable end-to-end slice, then
independent extensions; include integration, submission artifacts required by the
brief, and demo rehearsal. Optional tickets must be identifiable and removable.
Do not create speculative infrastructure or assign both developers overlapping
files. A blocked ticket must name the missing input and who can resolve it.

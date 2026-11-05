# Review a task

Input: task ID and branch (or commit range). You must not have written this
code. Don't modify it.

1. Read AGENTS.md, the task's "done when", the demo script and the contract.
2. Review the actual diff (`git diff master...<branch>`), not just the
   author's summary.
3. Check: does it meet "done when"? Does it match the contract? Bugs,
   crashes on bad input, leaked secrets, confidential data in Git, anything
   that would break the demo?
4. Run the task's "how to check" and tests if you can. Say what you didn't run.
5. Add findings to `docs/agent/REVIEW.md` (ID, severity, where, problem, fix).
   Skip style nitpicks and ideas outside the task.
6. Verdict: **approve** (no blocking/important findings) or **changes needed**.
   A human still decides when to merge.

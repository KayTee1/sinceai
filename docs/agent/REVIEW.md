# Reviews

Open findings only. Delete a row once it's fixed and merged.

| ID | Task | Severity | Where | Problem | Fix | State |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | T15 | important | `src/services/steward/analyze.ts` (every-market build gate, D15) | Across 223 resolved real-data analyses, 0 reach `build_proposal` (28 reuse, 127 no supported metric, 33 split coverage, 35 blocked by computability); the fixture shows the path is reachable | Owner decides the demo strategy; no rule change until then | deferred (owner) |

Severity: **blocking** (breaks the demo or a must-have), **important**
(bug or security risk, fix before merge), **minor** (optional).

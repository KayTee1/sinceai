# Handoff

- **Now:** Bayer challenge (D1). Facts in CHALLENGE / DATA_SOURCES (raw files
  outside Git). SCOPE follows Viet's Miro board, merged with KayTee's review
  (PR #7). D12 (contradictions + 1 day = 1 s clock) merged in #10. T11 (branch
  `docs/T11-scope-gaps`) fills the lifecycle/approval gaps as proposed D13.
  No app code yet.
- **Decisions:** lifecycle is P0 with auto-archive on silence, logged and
  restorable, skipped for assets with dependencies or a missing/inactive owner
  (D9, D13). Lineage drill-down with KayTee's limits (D6, D10). Stack:
  TypeScript, Next.js + Mastra + SQLite (D7). UI: Agentic | Dashboard tabs,
  Employee / Manager toggle; employee only browses (D8). P0 agents:
  Orchestrator, Discovery, Conflict detector (D11). Proposed D12: clock, god
  mode, per-asset leases, "acting as" approvals. Proposed D13: imported leases
  seeded from `last_modified`; team lead approves builds, reuse needs no
  approval; Employee "viewing as" picker; rule-based merge candidates; restore
  to previous tier; local keyword + TF-IDF search; REQ-0001 shows the Net Sales
  Growth conflict; counts panel in P0.
- **Next:** Viet reviews D12 and D13 (both change the contract); agree the
  contract (ARCHITECTURE) and lanes (PLAN), then T4 scaffold.
- **Open:** team derivation from owners; IP / external AI processing terms (ask
  Bayer Sat: we send pack data to Claude); video limit; whether Bayer values
  the DSO framing (term not yet defined in our docs).

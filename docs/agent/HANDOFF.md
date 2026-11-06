# Handoff

- **Now:** Bayer challenge (D1). Facts in CHALLENGE / DATA_SOURCES (raw files
  outside Git). SCOPE follows Viet's Miro board, merged with KayTee's review
  (PR #7). No app code yet.
- **Decisions:** lifecycle is P0 with simulated clock and auto-archive on
  silence, logged and restorable, skipped for assets with dependencies or no
  owner (D9). Lineage drill-down with KayTee's limits (D6, D10). Stack:
  TypeScript, Next.js + Mastra + SQLite (D7). UI: Agentic | Dashboard tabs,
  Employee / Manager toggle; employee only browses (D8). P0 agents:
  Orchestrator, Discovery, Conflict detector; Builder and Lease steward in P1
  (D11). Approvals follow required approvers, not the role toggle (D10).
- **Next:** agree the draft contract (ARCHITECTURE) and lanes (PLAN: A =
  agentic + platform, B = client + demo), then T4 scaffold.
- **Open:** embeddings provider; team derivation from owners; IP / external AI
  processing terms; video limit; whether Bayer values the DSO framing.

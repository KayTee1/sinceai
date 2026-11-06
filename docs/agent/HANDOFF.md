# Handoff

- **Now:** Bayer challenge (D1). Facts in CHALLENGE / DATA_SOURCES (raw files
  outside Git). SCOPE follows Viet's Miro board, merged with KayTee's review
  (PR #7). T10 (branch `docs/T10-scope-contradictions`) resolves the
  scope/design contradictions as proposed D12. No app code yet.
- **Decisions:** lifecycle is P0 with auto-archive on silence, logged and
  restorable, skipped for assets with dependencies or no owner (D9). Lineage
  drill-down with KayTee's limits (D6, D10). Stack: TypeScript, Next.js +
  Mastra + SQLite (D7). UI: Agentic | Dashboard tabs, Employee / Manager
  toggle; employee only browses (D8). P0 agents: Orchestrator, Discovery,
  Conflict detector (D11). Proposed D12: clock runs 1 day = 1 s with a
  god-mode panel (pause / resume / fast-forward, no rewind); per-asset 90-day
  leases; renew keeps the tier; manager runs requests for a named requester and
  approves via an "acting as" picker.
- **Next:** Viet reviews D12 (it changes the contract); agree the contract
  (ARCHITECTURE) and lanes (PLAN), then T4 scaffold.
- **Open:** embeddings provider; team derivation from owners; IP / external AI
  processing terms; video limit; whether Bayer values the DSO framing.

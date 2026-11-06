# Handoff

- **Now:** Bayer challenge (D1). Facts in CHALLENGE / DATA_SOURCES (raw files
  outside Git). SCOPE follows Viet's Miro board plus KayTee's reviews. D12
  (clock, acting-as approvals) and D13 (lifecycle gaps) are merged (#10, #11).
  T12 (branch `docs/T12-review-gaps`) closes the gaps from Codex's MVP review
  as proposed D14. No app code yet.
- **Decisions:** lifecycle is P0 with logged, restorable auto-archive on
  silence (D9, D13). Lineage limits (D6, D10). Stack: TypeScript, Next.js +
  Mastra + SQLite (D7). UI tabs and roles (D8). P0 agents: Orchestrator,
  Discovery, Conflict detector (D11). Proposed D14: team-authored computable
  KPI mapping; requester confirms reuse candidates; teams = owner regions, any
  active Lead approves builds; region data steward reassigns owners (Global
  covers Asia Pacific); rejecting retire renews; restored Temporary gets a
  fresh 30-day TTL; golden path first (PLAN Build order); test set T13.
- **Next:** Viet reviews D12–D14 (they change the contract); agree the
  contract (ARCHITECTURE) and lanes (PLAN), then T4 scaffold and the golden
  path.
- **Open:** IP / external AI processing terms (ask Bayer Sat: we send pack
  data to Claude); video limit; whether Bayer values the DSO framing (term not
  yet defined in our docs); KPI column meanings to confirm at import (T4).

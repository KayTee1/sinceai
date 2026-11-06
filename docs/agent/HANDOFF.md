# Handoff

- **Now:** PR #12 (`feat/initial-ui-mastra`, T4 + T7) is the first app code.
  Next.js 16 app with Bayer-style shell: Agentic | Dashboard tabs, Employee /
  Manager toggle (Agentic locked for Employee, D8). Dashboard tab lists all 360
  assets (tier from endorsement, lease end = sim date + 90 days) with charts
  from `Product_Market_Monthly` and `Asset_Usage`. Agentic tab = chat with one
  Mastra agent (`orchestrator`, Claude Sonnet) using three read-only tools:
  business request lookup, asset keyword search, KPI definition / conflict
  check. Docs side: D12 (clock, acting-as approvals), D13 (lifecycle gaps) and
  proposed D14 (Codex MVP review gaps) are merged (#10, #11, #13).
- **Data:** `npm run db:import` reads `data/private/pack.xlsx` into
  `data/private/steward.db` (both ignored). Counts match DATA_SOURCES.
- **Decisions:** lifecycle is P0 with logged, restorable auto-archive on
  silence (D9, D13). Lineage limits (D6, D10). Stack: TypeScript, Next.js +
  Mastra + SQLite (D7). UI tabs and roles (D8). P0 agents: Orchestrator,
  Discovery, Conflict detector (D11). Proposed D14: team-authored computable
  KPI mapping; requester confirms reuse candidates; teams = owner regions, any
  active Lead approves builds; region data steward reassigns owners (Global
  covers Asia Pacific); rejecting retire renews; restored Temporary gets a
  fresh 30-day TTL; golden path first (PLAN Build order); test set T13.
- **Needs:** `ANTHROPIC_API_KEY` in `.env.local`; chat not yet run end to end
  against the model (tools verified directly against SQLite).
- **Next:** Viet reviews D12–D14 (they change the contract; the scaffold's
  lease end = sim date + 90 days and team derivation should be checked against
  them); agree the contract (ARCHITECTURE) and lanes (PLAN). Then lineage
  panel, usage logging on open, step-event stream + approval pause (T6),
  Pipeline view, golden path.
- **Open:** IP / external AI processing terms (ask Bayer Sat: catalog rows go
  to Anthropic via the agent); embeddings provider; video limit; whether Bayer
  values the DSO framing (term not yet defined in our docs); KPI column
  meanings to confirm at import (T4).

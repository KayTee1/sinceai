# Handoff

- **Now:** branch `feat/initial-ui-mastra` (T4 + T7, not committed yet). Next.js
  16 app with Bayer-style shell: Agentic | Dashboard tabs, Employee / Manager
  toggle (Agentic locked for Employee, D8). Dashboard tab lists all 360 assets
  (tier from endorsement, lease end = sim date + 90 days) with charts from
  `Product_Market_Monthly` and `Asset_Usage`. Agentic tab = chat with one Mastra
  agent (`orchestrator`, Claude Sonnet) using three read-only tools:
  business request lookup, asset keyword search, KPI definition / conflict check.
- **Data:** `npm run db:import` reads `data/private/pack.xlsx` into
  `data/private/steward.db` (both ignored). Counts match DATA_SOURCES.
- **Needs:** `ANTHROPIC_API_KEY` in `.env.local`; chat not yet run end to end
  against the model (tools verified directly against SQLite).
- **Next:** lineage panel, usage logging on open, step-event stream + approval
  pause (T6), Pipeline view.
- **Open:** external AI processing terms (catalog rows go to Anthropic via the
  agent); embeddings provider; team derivation; video limit.

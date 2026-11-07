# Handoff

- **T5 lifecycle (Viet / Claude, PR from `feat/T5-lifecycle`):**
  `src/services/lifecycle` runs D12–D14: clock (1 day = 1 s, pause / resume /
  advance / next event), seeded per-asset leases, lease review (renew or
  retire by usage), 14-day window, then escalation to the region's data
  steward (D16: silence never archives), owner / steward decisions (reject
  needs a reason), restore, Temporary 30-day TTL and promotion to
  Personal, append-only audit (DB triggers). Dashboard reads tier, lease and
  status from it. API routes per the contract; no UI controls yet (inbox,
  clock panel, timeline are next).
- **Now:** T14 merged (#14, squash `1162fcd`). T15 is draft PR #15
  (`feat/T15-kpi-computation`). Codex review fixes applied (F2 provenance,
  F4 handoff, month validation, F5 as proposed D15); awaiting Codex
  re-verification. Not approved.
  `src/services/semantic` computes KPI-001, KPI-004, KPI-042 and KPI-027
  from `Product_Market_Monthly` under the D14 mapping (`d14-mapping.ts`,
  provisional). Statuses: computed / unsupported / insufficient_data, with
  units, filters, the query and source rows. `analyzeRequest` adds
  `computability` (computable / incomplete / insufficient_data / unsupported,
  with per-market values, reasons, filters and the same provenance as
  `computeKpi`) and proposes a build only if every
  requested approved KPI computes for every requested market (probe: latest
  month, actual-like).
- **Data facts found in T15:** one row per product × market × month;
  `value_type` labels the row and alternates within a series, so only 211
  of 882 month-to-month pairs are actual-like in both months. Growth is often
  `insufficient_data`; that is intended (no mixing). 11 product–market series
  are all zeros (growth undefined). Where the forecast is non-zero (870
  rows), `forecast_variance_pct` equals (net − forecast) / forecast × 100 to
  1 decimal, which supports the D14 KPI-042 mapping; the 110 zero-forecast
  rows have a blank `forecast_variance_pct` (formula undefined).
- **Decisions:** as before (D6–D14; D12–D14 await Viet). T15 policies are
  proposed D15 (pending owner approval): actual-like default, no blending,
  coverage % not aggregated, latest-month probe, every-market build gate.
- **Needs:** `ANTHROPIC_API_KEY` in `.env.local`; local checks need
  `data/private/pack.xlsx` and `PACK_XLSX=data/private/pack.xlsx npm test`.
- **Next:** Codex re-verifies PR #15. Owner decides the F1 demo strategy
  (no real request reaches `build_proposal`; see REVIEW). Viet agrees
  D12–D15, the StewardAnalysis/KpiResult shapes and lanes. Then expose
  computation to the chat tools (Viet's Mastra files, coordinate), build step
  for a Temporary insight, lineage panel, step events + approval pause (T6).
- **Open:** meaning of `value_type` per row vs. per column (does a
  forecast-like row's `net_sales` hold a forecast?); remaining D14 KPIs
  (014, 016, 020, 006, 054) return unsupported with reasons; IP / external AI
  terms (catalog rows go to Anthropic via the agent); embeddings provider;
  video limit; DSO framing.

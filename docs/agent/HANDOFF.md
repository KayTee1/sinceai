# Handoff

- **Now:** T14 merged (#14, squash `1162fcd`, Codex approved F1–F3). T15 on
  `feat/T15-kpi-computation`, uncommitted, awaiting KayTee's review.
  `src/services/semantic` computes KPI-001, KPI-004, KPI-042 and KPI-027
  from `Product_Market_Monthly` under the D14 mapping (`d14-mapping.ts`,
  provisional). Statuses: computed / unsupported / insufficient_data, with
  units, filters, the query and source rows. `analyzeRequest` adds
  `computability` (computable / incomplete / insufficient_data / unsupported,
  with per-market values and reasons) and proposes a build only if every
  requested approved KPI computes for every requested market (probe: latest
  month, actual-like).
- **Data facts found in T15:** one row per product × market × month;
  `value_type` labels the row and alternates within a series, so only 211
  of 882 month-to-month pairs are actual-like in both months. Growth is often
  `insufficient_data`; that is intended (no mixing). 11 product–market series
  are all zeros (growth undefined). `forecast_variance_pct` equals
  (net − forecast) / forecast × 100 on every row, which supports the D14
  KPI-042 mapping.
- **Decisions:** as before (D6–D14; D12–D14 await Viet). T15 rules, ours,
  to confirm with Viet: default `value_type` actual-like; never blend value
  types or drop mismatched cells from an aggregate; coverage % not
  aggregated (no weights in the pack); a KPI that is not computable in every
  requested market blocks a build.
- **Needs:** `ANTHROPIC_API_KEY` in `.env.local`; local checks need
  `data/private/pack.xlsx` and `PACK_XLSX=data/private/pack.xlsx npm test`.
- **Next:** KayTee reviews T15, then PR and independent review. Viet agrees
  D12–D14, the StewardAnalysis/KpiResult shapes and lanes. Then expose
  computation to the chat tools (Viet's Mastra files, coordinate), build step
  for a Temporary insight, lineage panel, step events + approval pause (T6).
- **Open:** meaning of `value_type` per row vs. per column (does a
  forecast-like row's `net_sales` hold a forecast?); remaining D14 KPIs
  (014, 016, 020, 006, 054) return unsupported with reasons; IP / external AI
  terms (catalog rows go to Anthropic via the agent); embeddings provider;
  video limit; DSO framing.

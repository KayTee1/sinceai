# Handoff

- **D22 my team's dashboards (`feat/my-team-dashboards`):** employee picks or
  inherits a team (domain + region from the viewing-as person) and sees the
  real catalog dashboards for it; each opens as a wallboard built from its
  KPI domain and scope (`wallboard.tsx`, `my-dashboards.tsx`). Views land on
  real assets and feed D21. DSH-* boards removed (D20 superseded).
- **D21 auto-renew (`feat/auto-renew-used`):** at lease end, used assets
  (any app view in 90 days, or pack telemetry >= 10 users/month) with an
  active owner renew automatically; unused ones get a retire proposal;
  used but ownerless go straight to the steward. Policy `lifecycle-v4`.
- **D19 + D20 (`feat/T18-data-separation`, PR #23):** Employees see only
  team dashboards (Commercial, Market Access, Supply Chain, Launch wallboards
  on the business facts + built insights). Managers: Team dashboards (with
  views / viewers / last 30 days per board) | Analytics catalog
  (metadata-only asset pages) | Estate overview. Team boards are lifecycle
  assets (`origin = 'team'`, `DSH-*`), seeded insert-or-ignore. Loader in
  `src/lib/catalog.ts` keeps `estate` and `business` apart.
- **T17 build step (Viet / Claude, merged #21):**
  `src/services/build` turns an analysis that recommends a build into a
  `build_temporary` proposal (Leads in the requester's region, never the
  requester); approval computes each KPI per market with `computeKpiByMarket`
  (unchanged), stores values + provenance in `insights`, registers Temporary.
  Dashboard lists built insights first; clicking a value shows formula,
  filters, query and source rows. `POST /api/builds` is the entry point for
  the T16 agent tool. Demo trigger: TEAM-REQ-01 (D18, below).
- **F1 resolved (D18, `feat/F1-team-demo-request`):** demo build trigger is
  TEAM-REQ-01 (team-authored, labelled), "Net sales and forecast variance for
  Xarelto in North America". Reaches build_proposal on the real pack (local
  test). Loader falls back to `team-requests.ts`; Business_Requests untouched.
- **Local DB needs a rebuild:** databases imported before #14 lack
  `_source_row`; run `rm data/private/steward.db && npm run db:import`.
- **Usage + counts (Viet / Claude, `feat/T7-usage-counts`):** Employee
  "viewing as" picker (D13); opening a dashboard logs an app open for that
  person (manager browsing is not logged). Manager before/after panel on the
  Dashboard tab: seeded state at reset vs now, plus applied changes from the
  audit log. KPI conflicts detected vs resolved are not in the panel yet.
- **D17 (same branch):** a Temporary insight opened by 3+ people in the
  owner's region gets a promote-to-Team proposal for the region's Leads (not
  the owner); expiry is held while it waits. Inbox shows promote cards.
- **T5 lifecycle (Viet / Claude, PR from `feat/T5-lifecycle`):**
  `src/services/lifecycle` runs D12–D14: clock (1 day = 1 s, pause / resume /
  advance / next event), seeded per-asset leases, lease review (renew or
  retire by usage), 14-day window, then escalation to the region's data
  steward (D16: silence never archives), owner / steward decisions (reject
  needs a reason), restore, Temporary 30-day TTL and promotion to
  Personal, append-only audit (DB triggers). Dashboard reads tier, lease and
  status from it. API routes per the contract.
- **T8 lifecycle UI (`feat/T8-lifecycle-ui`, stacked on #17):** Manager clock
  bar (run / pause, +1 / +30 / +90 days, next event, counts, reset demo),
  approval inbox beside the chat (acting-as picker, evidence, reject needs a
  reason), per-asset timeline with Restore on the Dashboard tab.
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

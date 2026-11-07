# Handoff

- **Now:** T14 (#14) and T15 (#15) merged; Viet's DB-path fix (#16) merged.
  T16 on `feat/T16-mastra-steward-integration`: Mastra tool adapters over the
  deterministic services, `src/mastra/tools/steward-tools.ts`
  (`createStewardTools(getDb)` → `analyze-request`, `compute-kpi`,
  `check-kpi-definitions`). They return service results unchanged and re-throw
  service errors. Model and chat UI both get compact views
  (`steward-views.ts`) without row provenance. **Not wired into the
  orchestrator yet:** the tool map and prompt change is a proposal for Viet,
  `docs/agent/T16-orchestrator-proposal.md`.
- **Measured (pack):** REQ-0001 Nubeqa / Global: full analysis 55 KB, view
  12.3 KB, model-visible follow-up replay 12.7 KB. Mastra also keeps the model
  output in `providerOptions.mastra.modelOutput`, so the browser message is
  ~25 KB; whether that copy reaches the provider is unverified (no live run).
- **Tests:** `tests/steward-tools.test.ts` (adapters vs. services on fixtures,
  views, errors, mock-model stream via `handleChatStream`, follow-up replay);
  `tests/helpers/mock-agent.ts` (scripted `MockLanguageModelV3`, no key).
  Local workbook checks: `PACK_XLSX=data/private/pack.xlsx npm test`.
- **Data facts (T15):** one row per product × market × month; `value_type`
  labels each row and alternates, so growth is often `insufficient_data`.
  `forecast_variance_pct` matches (net − forecast) / forecast × 100 on the 870
  non-zero-forecast rows; the 110 zero-forecast rows have a blank value.
- **Decisions:** D6–D15; D12–D15 await Viet. T16 adds no decision; the view
  shapes and tool contracts are provisional until Viet agrees.
- **Needs:** `ANTHROPIC_API_KEY` in `.env.local` for any live chat run (none
  done for T16).
- **Next:** Viet reviews the orchestrator proposal and view contract; then
  UI step labels/summaries and an analysis card (Viet); evidence endpoint if
  the UI needs provenance (sketched in ARCHITECTURE, "Steward tools").
  Dashboard KPI tiles still blend value types and average percentages
  (`asset-detail.tsx`, Viet's), see the integration audit.
- **Open:** F1 (no real request reaches a build proposal; owner decision);
  one agent vs. three (D11/R17); free-text requests have no governed entry
  point; IP / external AI terms (more catalog data reaches Anthropic once
  wired); clock start and per-asset leases vs. the contract.

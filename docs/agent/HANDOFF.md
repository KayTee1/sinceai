# Handoff

- **Now:** T16B is on `feat/T16B-live-orchestrator`, **stacked on PR #18**
  (T16A, still open, head `6f8015e`). Local only: not pushed, no PR, waiting
  for Codex's independent review. It does not include master's `1f4621a`
  (D21 auto-renew, #24). The live orchestrator now uses the deterministic
  services: `analyzeRequest`, `computeKpi`, `checkKpiDefinitions`,
  `proposeBuild` (new, `src/mastra/tools/build-tools.ts`) and `searchAssets`.
  `get-business-request` and `find-kpi-definitions` left the tool map.
  Prompt and tools are in `src/mastra/agents/orchestrator-config.ts`, so
  `tests/orchestrator.test.ts` runs the production prompt and tools on a
  mock model and a disposable DB. TEAM-REQ-01 flows from chat to an open
  `build_temporary` proposal in the approval inbox, but only when the latest
  user message asks to submit one (deterministic `SUBMIT_INTENT` check).
  There is no requester input; the D12 mapping picks the requester. There is
  no approve tool. Chat UI: step labels and summaries; a stored proposal
  calls the new `refresh()` in the lifecycle context so the inbox updates.
  Viet's files touched: `orchestrator.ts`, `chat-view.tsx`,
  `lifecycle-context.tsx` (`refresh` added to the context). He needs to
  review these.
- **Not verified:** a live run with the Anthropic model (no paid calls).
  Whether Sonnet calls the tools in order, and whether it asks before
  submitting, is untested. The UI was not exercised in a browser.
- **T16A (PR #18):** Mastra tool adapters over the
  deterministic services, `src/mastra/tools/steward-tools.ts`
  (`createStewardTools(getDb)` → `analyze-request`, `compute-kpi`,
  `check-kpi-definitions`). They return service results unchanged and re-throw
  service errors. Model and chat UI both get compact views
  (`steward-views.ts`) without structured provenance (diagnostic reasons may
  still name a workbook row).
- **D19 + D20 (`feat/T18-data-separation`, merged #23):** Employees see only
  team dashboards (Commercial, Market Access, Supply Chain, Launch wallboards
  on the business facts + built insights). Managers: Team dashboards (with
  views / viewers / last 30 days per board) | Analytics catalog
  (metadata-only asset pages) | Estate overview. Team boards are lifecycle
  assets (`origin = 'team'`, `DSH-*`), seeded insert-or-ignore. Loader in
  `src/lib/catalog.ts` keeps `estate` and `business` apart.
- **T17 build step (Viet / Claude, merged #21):**
  `src/services/build` turns an analysis that recommends a build into a
  `build_temporary` proposal (Leads in the requester's region, never the
  requester). Approval computes each KPI per market with `computeKpiByMarket`
  (unchanged), stores values + provenance in `insights` and registers a
  Temporary asset. The Dashboard lists built insights first; clicking a value
  shows formula, filters, query and source rows. `POST /api/builds` stays the
  HTTP entry point; T16B's `proposeBuild` tool calls the same service.
- **F1 resolved (D18, merged #22):** the demo build trigger is TEAM-REQ-01
  (team-authored, labelled), "Net sales and forecast variance for Xarelto in
  North America". It reaches build_proposal on the real pack (local test).
  The loader falls back to `team-requests.ts`, and Business_Requests is
  untouched. `requestSource` names the sheet `Team_Requests (team-authored)`.
- **T5 lifecycle (Viet / Claude, merged #17):** `src/services/lifecycle` runs
  D12–D14. It has a clock (1 day = 1 s, pause / resume / advance / next
  event), seeded per-asset leases, lease review (renew or retire by usage), a
  14-day window, then escalation to the region's data steward (D16: silence
  never archives). It also handles owner / steward decisions (reject needs a
  reason), restore, the Temporary 30-day TTL, promotion to Personal and an
  append-only audit (DB triggers). The Dashboard reads tier, lease and
  status from it.
- **T8 lifecycle UI (merged #19):** Manager clock bar, approval inbox beside
  the chat (acting-as picker, evidence, reject needs a reason), per-asset
  timeline with Restore on the Dashboard tab.
- **Usage + counts (merged #20):** Employee "viewing as" picker (D13).
  Opening a dashboard logs an app open for that person. The Manager
  before/after panel is on the Dashboard tab. D17: a Temporary insight
  opened by 3+ people in the owner's region gets a promote-to-Team proposal
  for the region's Leads, and expiry is held while it waits.
- **Integration issues after merging master into T16:**
  1. Discovery ignores lifecycle state. `discoverCandidates`
     (`src/services/steward/discovery.ts`) reads only the imported
     `Analytics_Assets`. An asset archived in `asset_state` can still be
     recommended for reuse, and app-built Temporary insights are never
     found. Both sides are now on master, so this is live. It needs a
     contract decision with Viet: exclude `archived`, include app-built
     assets, and use app tier instead of `endorsement`; in discovery or via a
     lifecycle query. Add regression tests. The D20 team boards (`DSH-*`,
     `origin = 'team'`) are also only in `asset_state`, so discovery does not
     see them either.
  2. Build-service provenance (T17 owner, not T16):
     `src/services/build/build.ts:149` hardcodes
     `{ sheet: "Business_Requests" }`, so a TEAM-REQ-01 build proposal cites
     the Bayer sheet instead of `Team_Requests (team-authored)`. Live since
     T16B: a chat-submitted TEAM-REQ-01 proposal stores that wrong source in
     its evidence and `build_proposed` audit row. The chat view labels the
     request correctly and lists the defect in `knownIssues`; the inbox
     labels `TEAM-` IDs by prefix. Not patched in T16B.
  3. Fixed (T16A, `597b79b`): the `analyze-request` view now keeps
     `request.sourceSheet` and `request.teamAuthored` (no row), so
     TEAM-REQ-01 stays labelled team-authored in model and UI output.
- **Measured (pack):** for REQ-0001 Nubeqa / Global, the full analysis is
  55 KB, the view 12.3 KB and the model-visible follow-up replay 12.7 KB.
  Mastra also keeps the model output in `providerOptions.mastra.modelOutput`,
  so the browser message is ~25 KB. Whether that copy reaches the provider is
  unverified (no live run).
- **Tests:** `tests/orchestrator.test.ts` (T16B), `tests/steward-tools.test.ts`, `tests/build.test.ts`,
  `tests/lifecycle.test.ts`, `tests/team-requests.test.ts`. Local workbook
  checks: `PACK_XLSX=data/private/pack.xlsx npm test`.
- **Local DB needs a rebuild:** databases imported before #14 lack
  `_source_row`; run `rm data/private/steward.db && npm run db:import`.
- **Data facts (T15):** there is one row per product × market × month.
  `value_type` labels each row and alternates, so growth is often
  `insufficient_data`. `forecast_variance_pct` matches
  (net − forecast) / forecast × 100 on the 870 non-zero-forecast rows; the
  110 zero-forecast rows have a blank value.
- **Decisions:** D12–D15 are proposed and await agreement. D16–D18 are
  accepted. T16 adds no decision; the view shapes and tool contracts are
  provisional until Viet agrees.
- **Needs:** `ANTHROPIC_API_KEY` in `.env.local` for any live chat run (none
  done for T16 or T16B).
- **Next:** Codex reviews T16B; then push and open a PR stacked on #18 (or
  retarget to master once #18 merges, then merge master for #24). Viet
  agrees the tool map, prompt and `build-proposal/v1` view. Fix the
  discovery issue above with Viet. One live chat smoke run of TEAM-REQ-01.
- **Open:** one agent vs. three (D11/R17); free-text requests have no
  governed entry point; IP / external AI terms (more catalog data reaches
  Anthropic once wired); meaning of `value_type` per row vs. per column;
  remaining D14 KPIs (014, 016, 020, 006, 054) return unsupported.

# Handoff

- **D23 (`fix/telemetry-window`):** pack telemetry counts only for months in
  the 90 days before a review; after ~Jan 2027 only app views keep a dashboard
  alive. Usage chart shows years and a stale-snapshot note. `lifecycle-v5`.
- **D22 my team's dashboards (`feat/my-team-dashboards`):** employee picks or
  inherits a team (domain + region from the viewing-as person) and sees the
  real catalog dashboards for it; each opens as a wallboard built from its
  KPI domain and scope (`wallboard.tsx`, `my-dashboards.tsx`). Views land on
  real assets and feed D21. DSH-* boards removed (D20 superseded).
- **Now:** master has T14 (#14), T15 (#15), DB-path fix (#16), T5 lifecycle
  (#17), T8 lifecycle UI (#19), usage counts / D17 (#20), T17 build step
  (#21), the F1 demo request / D18 (#22), T18 data separation / D19 + D20
  (#23) and D21 auto-renew (#24). T16 is PR #18
  (`feat/T16-mastra-steward-integration`), approved by Viet. It is synced
  with master at `1f4621a` (D21 / `lifecycle-v4`) and includes the T16A
  request source label. Codex review fixes are applied: the
  compact view keeps the complete reuse match, and the provenance note is
  honest. Mastra tool adapters over the
  deterministic services, `src/mastra/tools/steward-tools.ts`
  (`createStewardTools(getDb)` → `analyze-request`, `compute-kpi`,
  `check-kpi-definitions`). They return service results unchanged and re-throw
  service errors. Model and chat UI both get compact views
  (`steward-views.ts`) without structured provenance (diagnostic reasons may
  still name a workbook row). **Not wired into the
  orchestrator yet:** the tool map and prompt change is a proposal for Viet,
  `docs/agent/T16-orchestrator-proposal.md`. The orchestrator on master has
  only `get-business-request`, `search-assets` and `find-kpi-definitions`.
  The live wiring is T16B (`feat/T16B-live-orchestrator`, stacked on #18).
- **D21 auto-renew (`feat/auto-renew-used`, merged #24):** at lease end, used
  assets (any app view in 90 days, or pack telemetry >= 10 users/month) with
  an active owner renew automatically; unused ones get a retire proposal;
  used but ownerless go straight to the steward. Policy `lifecycle-v4`.
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
  shows formula, filters, query and source rows. `POST /api/builds` is the
  entry point for the T16 agent tool (not yet exposed as a tool).
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
  2. Fixed on `fix/T17-build-provenance` (F5, local, awaits Codex review
     and Viet, who owns `build.ts`): `proposeBuild` cites
     `analysis.request.source.sheet` in the proposal evidence and its
     `build_proposed` audit row, and `loadRequest` records the sheet it read
     the row from (`_source_sheet`) instead of `requestSource` guessing it
     from the ID. Schemas unchanged. Proposals stored before the fix keep
     `Business_Requests` (audit log is append-only; no migration); a demo
     reset drops them. After merge, T16B (#28) must drop `BUILD_SOURCE_DEFECT`
     and flip its `orchestrator.test.ts` assertion. The inbox still labels
     `TEAM-` IDs by prefix (`inbox.tsx`, display only).
  3. Fixed (T16A, `597b79b`): the `analyze-request` view now keeps
     `request.sourceSheet` and `request.teamAuthored` (no row), so
     TEAM-REQ-01 stays labelled team-authored in model and UI output.
- **Measured (pack):** for REQ-0001 Nubeqa / Global, the full analysis is
  55 KB, the view 12.3 KB and the model-visible follow-up replay 12.7 KB.
  Mastra also keeps the model output in `providerOptions.mastra.modelOutput`,
  so the browser message is ~25 KB. Whether that copy reaches the provider is
  unverified (no live run).
- **Tests:** `tests/steward-tools.test.ts`, `tests/build.test.ts`,
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
  done for T16).
- **Next:** Viet reviews PR #18. Then fix the discovery issue above with
  Viet, and wire the steward tools plus a build-proposal tool
  (`proposeBuild`) into the orchestrator.
- **Open:** one agent vs. three (D11/R17); free-text requests have no
  governed entry point; IP / external AI terms (more catalog data reaches
  Anthropic once wired); meaning of `value_type` per row vs. per column;
  remaining D14 KPIs (014, 016, 020, 006, 054) return unsupported.

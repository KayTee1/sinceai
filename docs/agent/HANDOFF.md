# Handoff

- **New direction (D24, both developers; not implemented):** after T16B and
  the current golden path, plan T19's additional team-authored, LLM-generated
  synthetic estate scenarios (KPI forks, duplicate/overlapping assets, stale
  products, governance inconsistencies). Preserve the original Bayer workbook
  and imported records; carry distinct origins through analysis, recommendations,
  audit and UI. Prefer reviewed, deterministic fixtures with known outcomes;
  real validation/governance evaluates them, never hardcoded success. Forks may
  be legitimate; an LLM cannot authorize retirement or delete source/audit data.
  Target an evidence-backed, human-governed before/after demo. Schema, seeding,
  detection, UI, owner, schedule and size are undecided. Separate from D18's
  TEAM-REQ-01 and current tool/build contracts. Integration context checked
  2026-11-07: T16 (#18) is merged; T16B is open as PR #28 and the F5 build
  provenance fix as PR #29. Finish that work first; this documentation does
  not change existing task/PR statuses.
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
  (#23), D21 auto-renew (#24), T16 / T16A steward tool adapters (#18),
  D22 team catalog dashboards (#25) and D23 telemetry window (#27). Open:
  T16B live orchestrator (PR #28) and the F5 build provenance fix (PR #29).
  T16 (#18) includes the T16A request source label; the compact view keeps
  the complete reuse match. Mastra tool adapters over the
  deterministic services, `src/mastra/tools/steward-tools.ts`
  (`createStewardTools(getDb)` → `analyze-request`, `compute-kpi`,
  `check-kpi-definitions`). They return service results unchanged and re-throw
  service errors. Model and chat UI both get compact views
  (`steward-views.ts`) without structured provenance (diagnostic reasons may
  still name a workbook row). **Not wired into the
  orchestrator yet:** the tool map and prompt change is a proposal for Viet,
  `docs/agent/T16-orchestrator-proposal.md`. The orchestrator on master has
  only `get-business-request`, `search-assets` and `find-kpi-definitions`.
  The live wiring is T16B (`feat/T16B-live-orchestrator`, PR #28, open).
- **D21 auto-renew (`feat/auto-renew-used`, merged #24):** at lease end, used
  assets (any app view in 90 days, or pack telemetry >= 10 users/month) with
  an active owner renew automatically; unused ones get a retire proposal;
  used but ownerless go straight to the steward. Policy `lifecycle-v4`.
- **D19 + D20 (`feat/T18-data-separation`, merged #23; D20 boards superseded
  by D22):** Managers: Team dashboards | Analytics catalog (metadata-only
  asset pages) | Estate overview. Loader in `src/lib/catalog.ts` keeps
  `estate` and `business` apart (D19, still current). Historical: #23 seeded
  four invented team boards as lifecycle assets (`origin = 'team'`,
  `DSH-*`). Since D22 (#25) they are no longer seeded, and `ensureLifecycle`
  removes them from older databases (app rows only; audit log untouched).
  Employees and the manager Team dashboards section now show real catalog
  dashboards (D22 bullet above).
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
     lifecycle query. Add regression tests.
  2. Build-service provenance (T17 owner, not T16):
     `src/services/build/build.ts:149` hardcodes
     `{ sheet: "Business_Requests" }`, so a TEAM-REQ-01 build proposal cites
     the Bayer sheet instead of `Team_Requests (team-authored)`. Fix is
     F5, open as PR #29 (Viet to review); not on master yet.
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
- **Decisions:** D12–D15 are proposed and await agreement. D16–D23 are
  accepted (D22 supersedes D20's team boards). D24 is accepted as direction
  only. T16 adds no decision; the view shapes and tool contracts are
  provisional until Viet agrees.
- **Needs:** `ANTHROPIC_API_KEY` in `.env.local` for any live chat run (none
  done for T16).
- **Next:** Viet reviews T16B (PR #28: steward tools plus a build-proposal
  tool wired into the orchestrator) and F5 (PR #29); both are open. Codex's
  independent review of T16B and its verification of the P1 authorization
  fix are done. Live Sonnet / browser verification of T16B is still
  outstanding. Once F5 merges, PR #28 needs the follow-up listed in PR #29
  (provenance assertion, `BUILD_SOURCE_DEFECT` warning, stored provenance in
  the build-proposal view). Then fix the discovery issue above with Viet.
  T19 (D24) planning comes after T16B and the golden path.
- **Open:** one agent vs. three (D11/R17); free-text requests have no
  governed entry point; IP / external AI terms (more catalog data reaches
  Anthropic once wired); meaning of `value_type` per row vs. per column;
  remaining D14 KPIs (014, 016, 020, 006, 054) return unsupported.

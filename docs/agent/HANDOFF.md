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
  D22 team catalog dashboards (#25), D23 telemetry window (#27), T19 docs
  (#26) and T16B live orchestrator (#28). Open: F5 build provenance (PR #29)
  and T21 (`feat/T21-chat-assistant`, Viet / Claude, not pushed).
- **T21 chat assistant (`feat/T21-chat-assistant`):** colleague tone in the
  prompt (verdict first, no process narration, cards carry the detail).
  Chat collapses tool steps into one line and renders cards
  (`src/components/agentic/chat-cards.tsx`): reuse (Use this / Not right),
  KPI conflicts, build (Submit build proposal sends the exact T16B command),
  and inbox proposals, which reuse the side inbox's `ProposalCard`
  (Approve / Reject = human click on the decision API). New read-only tool
  `listPendingProposals` (`src/mastra/tools/inbox-tools.ts`); the model has
  no decide tool. "Use this" calls `POST /api/reuse` → `confirmReuse`
  (`src/services/build/reuse.ts`): re-runs the analysis, requires
  reuse_candidates and a listed asset, logs an app use for the D12 mapped
  requester and a `reuse_confirmed` audit row. Verified on the pack:
  REQ-0026 → AST-0335 logged; wrong asset / build request refused.
  The inbox card shows only the rationale for an unknown proposal type
  (e.g. a T20 `merge` left in a local DB) instead of crashing.
- **T16B (merged #28):** Codex reviewed `be5e560` (CHANGES
  REQUIRED; report in `docs/agent/REVIEW.md`). P1 F2/F3 are fixed in
  `4e10510` and **verified fixed by Codex**:
  `proposeBuild` now stores a proposal only if the latest user message (from
  the agent execution context) is exactly `Submit a build proposal for <ID>`
  or `... for <ID> with product <P> and market <M>`, the ID equals the call's
  `requestId`, and the call's `answer` equals the confirmed scope (both ways),
  which must also be the analysis's resolved scope. Everything else returns
  `intent_required` with a `reason` and stores nothing. Contract in
  `docs/ARCHITECTURE.md`; tests in `tests/orchestrator.test.ts`
  ("submission authorization"). Open: F4 (P2, inbox refresh recovery,
  Viet's files) and F5 (P2, T17 `build.ts:149` provenance, with Viet).
  The live orchestrator uses the deterministic
  services: `analyzeRequest`, `computeKpi`, `checkKpiDefinitions`,
  `proposeBuild` (`src/mastra/tools/build-tools.ts`) and `searchAssets`.
  Prompt and tools are in `src/mastra/agents/orchestrator-config.ts`, so
  `tests/orchestrator.test.ts` runs the production prompt and tools on a
  mock model and a disposable DB. There is no requester input (D12 mapping)
  and no approve tool. Chat UI: step labels and summaries; a stored proposal
  calls `refresh()` in the lifecycle context. Viet's files touched:
  `orchestrator.ts`, `chat-view.tsx`, `lifecycle-context.tsx`. He needs to
  review these.
- **Not verified:** a live run with the Anthropic model (no paid calls).
  Whether Sonnet calls the tools in order, and whether it asks before
  submitting, is untested. The UI was not exercised in a browser.
- **T16A (merged #18):** Mastra tool adapters over the
  deterministic services, `src/mastra/tools/steward-tools.ts`
  (`createStewardTools(getDb)` → `analyze-request`, `compute-kpi`,
  `check-kpi-definitions`). They return service results unchanged and re-throw
  service errors. Model and chat UI both get compact views
  (`steward-views.ts`) without structured provenance (diagnostic reasons may
  still name a workbook row).
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
     lifecycle query. Add regression tests.
  2. Build-service provenance (T17 owner, not T16):
     `src/services/build/build.ts:149` hardcodes
     `{ sheet: "Business_Requests" }`, so a TEAM-REQ-01 build proposal cites
     the Bayer sheet instead of `Team_Requests (team-authored)`. Live since
     T16B: a chat-submitted TEAM-REQ-01 proposal stores that wrong source in
     its evidence and `build_proposed` audit row. The chat view labels the
     request correctly and lists the defect in `knownIssues`; the inbox
     labels `TEAM-` IDs by prefix. Fix is F5, open as
     PR #29 (Viet to review); not on master yet.
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
- **Decisions:** D12–D15 are proposed and await agreement. D16–D23 are
  accepted (D22 supersedes D20's team boards). D24 is accepted as direction
  only. T16 adds no decision; the view shapes and tool contracts are
  provisional until Viet agrees.
- **Needs:** `ANTHROPIC_API_KEY` in `.env.local` for any live chat run (none
  done for T16 or T16B).
- **Next:** live Sonnet + browser check of T21 (REQ-0026 for reuse,
  TEAM-REQ-01 for build, "What's waiting for approval?"), then PR. F5
  (PR #29) still open; once merged, add its follow-up (provenance assertion,
  `BUILD_SOURCE_DEFECT` warning, stored provenance in the build-proposal
  view). Then fix the discovery issue above with Viet. T19 (D24) after the
  golden path.
- **MVP limit:** chat history is client-supplied, not authenticated server
  state; the latest user message is trusted as typed by the person at the
  keyboard. The command syntax is English-only and strict by design.
- **Open:** one agent vs. three (D11/R17); free-text requests have no
  governed entry point; IP / external AI terms (more catalog data reaches
  Anthropic once wired); meaning of `value_type` per row vs. per column;
  remaining D14 KPIs (014, 016, 020, 006, 054) return unsupported.

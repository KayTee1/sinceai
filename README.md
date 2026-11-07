# Analytics Steward — SinceAI

A Bayer Pharmaceuticals analytics governance demo: find reusable dashboards,
explain conflicting KPI definitions, and request a computed Temporary insight
only when the deterministic services support it. Humans approve changes.
All business values are synthetic challenge data.

Implementation snapshot: `1beff2ebd1e4df5393bc6b065795ca1ddb845edc` (`origin/master`, T26 merged in #38),
verified 2026-11-08. Original refresh baseline: `43a1157`; reconciled against the
committed final master revision. Local `master` is stale and was not moved.

## Run locally

Use Node.js 22 and npm. Obtain the approved workbook separately; it is not
included in Git. Run from the repository root, in your own worktree.

```sh
npm ci
mkdir -p data/private
cp /path/to/approved-pack.xlsx data/private/pack.xlsx
cp .env.example .env.local
npm run db:import
npm run dev
```

Open http://localhost:3000. Put `ANTHROPIC_API_KEY` in `.env.local` and restart
for live chat. The source configures `anthropic/claude-sonnet-5-5` and
`anthropic/claude-haiku-5-5`; availability and live model behavior were not
verified during this documentation refresh. Dashboard and direct service/API
flows do not require a model call.

`DATABASE_FILE` selects the SQLite file (default `data/private/steward.db`),
resolved relative to the process working directory. Next.js loads `.env.local`;
the standalone import and CLI scripts read exported environment variables.
Export `DATABASE_FILE` when using a custom file with those scripts too.
`npm run db:import -- /path/to/pack.xlsx` accepts a workbook path. Import
validates sheets, headers and counts, preserves `_source_row`, and refuses to
overwrite an existing database. Use a fresh disposable database for demos;
do not delete another developer's file.

Optional `SCHEDULER_DEMO_ACTIONS=1` enables the demo manager's monitoring writes
over HTTP (including Check due jobs). Also set `SCHEDULER_SIM_TRIGGER=1` to run
due governance jobs after explicit clock actions. Both flags default off.
`SCHEDULER_SIM_REASSESS_DAYS` optionally spaces simulated periodic reassessments
by 1–365 simulated days; unset/invalid means no cadence. These two T26 variables
are read in source but are not listed in `.env.example`; add them to `.env.local`
for the server, or export them for CLI use. These flags and the role/identity
pickers are not authentication.
The app is a local prototype, without production SSO/RBAC.

## What works

- Employee team dashboards and built insights; manager catalog and estate views.
- Chat cards, request drafting, clarification, KPI conflicts, reuse confirmation,
  build proposals, approval inbox, and persisted Pipeline storyboard/diagram.
- Deterministic computation of four mapped KPIs with query and row provenance.
- Temporary TTL, usage-based promotion, lease reviews, escalation, archive,
  restore, and governed two-sided merge proposals.
- Scheduler tab for manual incremental overlap checks and reassessment of known
  findings, plus opt-in checks after clock actions and manual Check due jobs at
  the stored simulated date. Findings do not authorize changes.

## Check and demonstrate

```sh
npm test
npm run lint
npx tsc --noEmit
npm run build
# Optional local workbook tests:
PACK_XLSX=data/private/pack.xlsx npm test
```

These are project check commands, not results claimed by this refresh.
See [demo scenarios](docs/DEMO.md) for build, reuse, clock and monitoring flows.
No paid model call, workbook import or application test was run for this docs-only
change; source and documentation validation are recorded in the handoff.

## Parallel development

Use one branch/worktree per task from a committed baseline; check existing
paths and branches before creation. For example, after selecting the base:

```sh
git worktree list
git worktree add -b feat/T-ID-description ../sinceai-T-ID <verified-base-sha>
```

Keep private workbook/database copies separate per worktree. Follow
[AGENTS.md](AGENTS.md), coordinate task ownership in [PLAN](docs/PLAN.md), and
commit/push only with owner authorization. Do not alter an active checkout.

## Read more

- [Architecture](docs/ARCHITECTURE.md), [Mastra agents and tools](docs/MASTRA.md)
- [HTTP API](docs/API.md), [KPI and lifecycle governance](docs/GOVERNANCE.md)
- [Scope and implementation status](docs/SCOPE.md), [requirements](docs/REQUIREMENTS.md)
- [Decisions](docs/DECISIONS.md), [plan](docs/PLAN.md), [handoff](docs/agent/HANDOFF.md)
- [Challenge](docs/CHALLENGE.md), [data assumptions](docs/DATA_SOURCES.md)

## Limits and production path

There is no live Power BI, Fabric, Tableau or SSO integration. Catalog lineage
is metadata, not executable proof of a dashboard's numbers. Generated wallboards
are demo views over business facts; imported dashboard SQL is not executed.
Source KPI formulas are not supplied as executable definitions: our mapping
remains team-authored and provisional. Unsupported metrics and missing data
produce explicit statuses, not invented values.

Monitoring supports manual runs and T26 simulated-date checks at explicit clock
control actions or Check due jobs. A freely running clock/polling alone starts
no governance job; there is no cron, background worker or real automatic schedule.
Finding-to-merge POST is disabled pending independent reviews.
Full-estate monitoring, synthetic sprawl generation, proposal editing,
owner-reassignment workflow and complete certification promotion are unfinished.
Chat history and acting identities are supplied by the client.

A production path would replace workbook adapters with approved Power BI/Fabric
catalog, lineage and usage APIs, add authenticated authorization, durable job
operations, and reviewed semantic definitions. None is implemented here.
External AI processing and source redistribution terms remain owner/organizer
questions. Main development tools include Claude Code and Codex; live demo
agents use Anthropic through Mastra. Keep pre-event work distinct in submission.

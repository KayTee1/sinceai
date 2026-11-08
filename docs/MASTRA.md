# Mastra agents and execution

Implementation snapshot: `1beff2ebd1e4df5393bc6b065795ca1ddb845edc` (`origin/master`, T26 merged in #38),
verified 2026-11-08. Original refresh baseline: `43a1157`; reconciled against the
committed final master revision. Local `master` is stale and was not moved.

## Actual registrations

| Agent | Source | Model | Role |
| --- | --- | --- | --- |
| `orchestrator` / Bonsai | `src/mastra/agents/orchestrator.ts` | `anthropic/claude-sonnet-5-5` | Sole agent registered in `src/mastra/index.ts`; chat and governed tools |
| `discovery-agent` / Discovery agent | `src/mastra/agents/pipeline-agents.ts` | `anthropic/claude-haiku-5-5` | Local helper, summary wording only |
| `conflict-detector` / Conflict detector | same file | `anthropic/claude-haiku-5-5` | Local helper, summary wording only |

Builder and Lease steward agents are planned, not registered. Model identifiers
are literal source configuration; live availability and prompt adherence are
unverified by this refresh. No external Mastra API assumptions are needed to
understand the repository behavior below.

## Orchestrator tool map

`createOrchestratorTools` in `orchestrator-config.ts` combines these factories.
Keys below are the model-facing names; IDs are the `createTool` registrations.

| Factory | Keys (IDs) | Behavior |
| --- | --- | --- |
| `pipeline-tools.ts` | `runRequestPipeline` (`run-request-pipeline`) | Execute request analysis workflow and persist run/events |
| `steward-tools.ts` | `analyzeRequest` (`analyze-request`), `computeKpi` (`compute-kpi`), `checkKpiDefinitions` (`check-kpi-definitions`) | Deterministic service adapters |
| `build-tools.ts` | `proposeBuild` (`propose-build`) | Command-gated proposal, never approval |
| `build-tools.ts` | `getBuildStatus` (`get-build-status`) | Read-only proposal, decision, insight and lifecycle status (T21) |
| `inbox-tools.ts` | `listPendingProposals` (`list-pending-proposals`) | Read open/escalated proposals |
| `estate-tools.ts` | `searchEstate` (`search-estate`), `checkDuplicate` (`check-duplicate`), `listArchived` (`list-archived`), `getAsset` (`get-asset`) | Explore catalog plus app state |
| same | `whoSignsOff` (`who-signs-off`), `portfolioSummary` (`portfolio-summary`), `prepareRestore` (`prepare-restore`) | Authority, counts, human restore offer |
| same | `draftRequest` (`draft-request`), `proposeRetire` (`propose-retire`), `suggestMerge` (`suggest-merge`), `proposeMerge` (`propose-merge`) | Persist chat draft; governed retire/merge proposals; read-only merge comparison |

Older catalog tool exports in `catalog-tools.ts` are not the current
orchestrator map. In particular `searchAssets` was replaced by `searchEstate`.

## Flow and human boundaries

`POST /api/chat` requires an Anthropic key (503 without one), calls
`handleChatStream` for `orchestrator`, UI message version v7, maximum eight
steps. The prompt directs stored requests through `runRequestPipeline`.
Free text can become `DRAFT-nnn` in `chat_requests`, explicitly labelled as
chat-authored; `TEAM-REQ-01` is the separate team-authored demo fixture.

`createRequestPipeline` constructs workflow `request-pipeline`: intent →
discovery → conflict → duplicate → recommend. Facts come from deterministic
services; two helper agents may word short findings. Missing key, error,
six-second timeout, overlong output or unexpected numeric/ID tokens falls back
to a template. This guard does not prove all natural-language claims correct.

Human waits and continuation are in `runs`/`run_events`. `onBuildProposed`,
`onBuildDecided` and `onReuseConfirmed` update the application run after the
analysis workflow completes. There is no Mastra durable snapshot approval pause.

Build submission requires the latest user message to be exactly:

```text
Submit a build proposal for <REQUEST-ID>
Submit a build proposal for <REQUEST-ID> with product <PRODUCT> and market <MARKET>
```

The parser checks request/scope against tool arguments and resolved analysis.
Use the scope form only with an offered clarification. Retire and merge use:

```text
Propose retiring <ASSET-ID> because <reason>
Propose merging <SOURCE-ID> into <TARGET-ID>
```

These command gates read client-supplied conversation context and constrain
model-triggered tools; they do not secure direct HTTP access. Revalidation and
required-approver checks live in services. No agent decision tool exists.
Restore is offered as a card and performed by a human on the restore route.

## T26 monitoring boundary

T26 changes no Mastra registrations, models, tool map or request workflow.
`src/services/scheduler/simulated.ts` invokes deterministic B1/B2 runners via
clock actions, HTTP Check due jobs or operator CLI. It does not invoke an agent,
create a build/merge proposal, approve or archive. `simulated_clock` is a scheduler
trigger label, separate from request Pipeline events and Mastra tool execution.
Human approval gates, including disabled finding-to-proposal submission, remain.

## Evidence and verification limits

Full steward adapter results retain provenance; `toModelOutput` and display
projections produce compact views with IDs, values, formulas, reasons and row
counts, omitting structured SQL/args and source-row lists. Do not claim the
model inspected full query evidence. Built values retain stored evidence for
human drill-down. No model may invent KPI values or authorize a change.

Repository tests cover tool behavior and mock model orchestration. This refresh
inspected registrations and execution code; it did not run a paid model test.
The independent-review requirements and open gaps remain in [HANDOFF](agent/HANDOFF.md).

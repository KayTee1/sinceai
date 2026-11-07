# Reviews

Open findings only. Independent T16B review, 2026-11-07. References below
are to `be5e560`. Previous T15 F1 is resolved by merged #22 / D18.

## Status after the implementer's fix (not re-reviewed yet)

| ID | Severity | State |
| --- | --- | --- |
| F2 | P1 | Fixed locally on `feat/T16B-live-orchestrator`: whole-message submit command only. **Awaits Codex re-verification.** |
| F3 | P1 | Fixed locally on the same commit: command bound to `requestId` and scope; confirmed scope checked against the resolved analysis. **Awaits Codex re-verification.** |
| F4 | P2 | Open. Small, independent follow-up (chat-view + lifecycle refresh); not in this fix. |
| F5 | P2 | Open. Pre-existing T17 `build.ts:149`; separate change with Viet. |

Contract and tests: `docs/ARCHITECTURE.md` ("Governance of propose-build"),
`tests/orchestrator.test.ts` ("submission authorization"). The Codex report
below is unchanged.

## Git context

Workspace initially clean: `feat/T19-synthetic-sprawl-docs`, HEAD `759ad7c`.
Reviewed an isolated `/tmp/sinceai-t16b-review` archive of local
`feat/T16B-live-orchestrator` at `be5e560bed8c615009bdae52b85b9d20452a5aef`.
`git log 6f8015e..be5e560` contains exactly `ea14b68`, `507dd8b`, `be5e560`;
all 11 changed files reviewed, with T14/T15/T17 services and chat handler.

Live `git ls-remote origin refs/heads/master` returned
`1f4621a052b54f15f46dc1a399c6101d06db789c`.
`gh pr view 18 --json state,baseRefName,headRefName,headRefOid,mergeable,url`
returned OPEN, master, feat/T16-mastra-steward-integration, `6f8015e`,
CONFLICTING: https://github.com/KayTee1/sinceai/pull/18.
Common ancestor with origin/master: `fb0f298` (#23). T16B lacks #24 / D21
lifecycle-v4. Resolve dependency conflicts and verify the combined result.
No checkout, history changes, commits or pushes performed.

## Actionable findings

### F2 — P1: intent guard accepts questions, quotations and explicit refusal

**Introduced by T16B. Where:** `src/mastra/tools/build-tools.ts:37–43`,
execution at `:175–185`.

`hasSubmitIntent` incorrectly accepts each of:

- `Should we submit a build proposal for TEAM-REQ-01?`
- `If we submit a build proposal, who approves it?`
- `Do not under any circumstances submit a build proposal for TEAM-REQ-01.`
- `Explain this quoted instruction: "Submit a build proposal for TEAM-REQ-01"`

The unanchored pattern accepts discussion/quoted data; NEGATED's 20-character
window misses the explicit refusal. A mistaken or injected model call therefore
passes the supposedly deterministic authorization boundary.

**Evidence:** stdin probes using existing `runChat` / `handleChatStream` and
scripted `proposeBuild` calls reached the DB provider for all four messages.
Repeated the question and explicit refusal against fresh disposable workbook
DB state: each returned `proposed` and persisted `PRP-INS-TEAM-REQ-01-1`.

**Correction:** use constrained explicit confirmation bound to a displayed
proposal, preferably a UI action and server-held confirmation. A textual MVP
command should accept only a strict whole-message command, refusing other
phrasing. Add negative stream tests for these cases. This permits unwanted
proposals, not automatic builds: Lead approval remains enforced.

### F3 — P1: authorization is not bound to request or clarified scope

**Introduced by T16B. Where:** `src/mastra/tools/build-tools.ts:167–185`.

The tool checks only a boolean over user text; requestId and answer remain
independent model inputs. User says `Submit a build proposal for REQ-0001
only.`; model calls `proposeBuild({requestId:"TEAM-REQ-01"})`; the tool stores
TEAM-REQ-01. Likewise, a model can supply any offered clarification option
without proof the user selected it. T14 checks membership, not human selection
(`src/services/steward/requests.ts:111–123`).

**Evidence:** reproduced the mismatched-ID scenario through the real Mastra
stream with production instructions/tools and disposable workbook DB:
`proposed`, with `PRP-INS-TEAM-REQ-01-1` in the inbox. Existing offered-option
tests establish membership only, not user selection.

**Correction:** bind trusted submission confirmation to the exact request ID
and resolved scope; reject mismatches and require human scope selection.
Generic confirmations need trusted pending state. Add mismatched/stale request
and unselected-but-valid scope tests. The model can indirectly steer the
requester's region by selecting a different target, despite having no direct
requesterId input.

### F4 — P2: failed inbox refresh cannot recover from chat

**Introduced by T16B. Where:** `src/components/agentic/chat-view.tsx:45,64–68`;
`src/components/lifecycle/lifecycle-context.tsx` refresh and polling effects.

The call is marked seen before refresh succeeds. If that fetch fails with the
clock paused, subsequent message updates skip it. Resubmission returns
`already_proposed`, which the scanner also ignores. The stored proposal stays
absent from the loaded inbox until another lifecycle action or reload.

**Evidence:** direct control-flow inspection: seen set precedes the fire-and-
forget refresh; polling occurs only while running. No browser fault-injection
run performed.

**Correction:** expose refresh success, retry failures, mark seen on success,
and refresh for already_proposed too. Preserve deduplication to avoid loops.

### F5 — P2: team request stored as Bayer workbook provenance

**Pre-existing T17, not introduced by T16B. Where:**
`src/services/build/build.ts:149` (also present before `6f8015e`).

TEAM-REQ-01 proposal evidence and build_proposed audit row cite
Business_Requests. The existing orchestrator test explicitly asserts this
incorrect source. T16B labels its projected request correctly and discloses
BUILD_SOURCE_DEFECT; that does not repair persistent provenance.

**Correction:** T17 should use authoritative request-source metadata in
proposal evidence/audit and assert Team_Requests in its regression test.

## Verified boundaries and MVP limitations

- Production orchestrator wires authoritative T14/T15 tools and T17 service.
  No approval/reject/register tool exists. No requesterId input; service mapping
  chooses requester/approvers and excludes requester. Tests reject requester
  approval and create an insight only after a Lead decision.
- T17 re-runs analysis, retaining clarification-option membership, scope
  resolution, computability and sequential pending-duplicate gates. These do
  not establish human intent or selection (F2/F3). Concurrent duplicate calls
  were not verified.
- Installed Mastra `tool-CT0-cyFQ.js:851` places execution messages in
  context.agent.messages. Existing real-stream tests confirm the path works.
  Latest-user lookup excludes tool/assistant roles and earlier turns; absent
  context refuses safely. Quoted data in the latest user message defeats F2.
  Client-supplied history is not authenticated server conversation state;
  identity simulation remains a documented MVP limit.
- build-proposal/v1 explicitly selects fields, omitting stored evidence source
  arrays, request text, SQL and raw source rows. Model/UI team labels are
  correct; F5 concerns storage. T16A diagnostic prose may contain row locators,
  as documented, without raw row contents.
- searchAssets remains keyword exploration, distinguished by instructions;
  its description still says use before proposing. It cannot bypass T17's
  analysis gate, but wording/recommendations remain model-dependent. Existing
  T14 discovery reads imported Analytics_Assets rather than lifecycle/insights;
  stale recommendations are a pre-existing limitation, not a T16B regression.
- Actual stream camelCase tool names match UI keys; hyphenated IDs also work.
  Stable refresh callback and seen set avoid routine loops. Error/compact
  output handling works through stream tests. F4 limits refresh reliability.

## Verification

In the isolated archive with installed workspace node_modules linked:

- `PACK_XLSX=/Users/kaytee1/mystuff/github_personal/sinceai/data/private/pack.xlsx npm test`
  — 132 passed, 0 failed, 0 skipped. Initial sandbox invocation failed on tsx
  IPC permissions; approved rerun passed.
- `npx tsc --noEmit` — exit 0.
- `npm run lint` — exit 0.
- Additional `node --import tsx --input-type=module` stdin probes used existing
  mock-agent helpers and production tools to reproduce F2/F3. No source/test
  files added or edited. All probe databases were disposable and removed.

Tests validate real Mastra/AI SDK plumbing, projections, persistence and service
approval rules with scripted mock-model calls. They do not prove Sonnet tool
selection, instruction compliance or injection resistance. Tests omit the
production searchAssets tool, override the lifecycle-date provider and test
approval services rather than the HTTP approval route/browser. Workbook was
read only; normal persistent DB never opened. No Next build executed.

## Verdict: CHANGES REQUIRED

- **Blocking issues:** F2/F3 break deterministic, request-specific submission
  authorization. Human approval still protects actual builds; unwanted
  proposals remain a serious governance defect for this MVP.
- **Non-blocking improvements:** F4 refresh recovery; separate T17 F5 provenance
  fix; clarify keyword-search description and catalog lifecycle limitations.
- **Missing verification:** live Sonnet, browser/inbox network recovery, HTTP
  approval end-to-end, production lifecycle-date path, concurrent submissions,
  and integrated result after dependency resolution.
- **Git/integration concerns:** #18 is OPEN/CONFLICTING; T16B is stacked locally
  and lacks master's D21. Workspace remains on T19, not reviewed T16B.
- **Recommended next action:** implementer addresses F2/F3 using constrained
  request/scope-bound confirmation and regression coverage, reconciles #18
  with master, then requests independent re-review. No fixes implemented,
  commits created or changes pushed by this reviewer.

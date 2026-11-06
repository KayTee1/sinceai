# Decisions

Only consequential choices (challenge, approach, stack, contract, cuts).

```text
D<n>: Title (YYYY-MM-DD)
Status: proposed / accepted / replaced by D<n>
Choice and why:
Alternatives considered:
Agreed by:
```

D1: Challenge: Bayer BI lifecycle (2026-11-06)
Status: accepted
Choice and why: Bayer's challenge on analytics sprawl and the BI lifecycle.
Alternatives considered: other company challenges.
Agreed by: Viet, KayTee

D2: Approach: Analytics Steward (2026-11-06)
Status: proposed (revised after final-source intake; see D5)
Choice and why: an agent that proposes reuse before build, explains metric
conflicts with SQL-computed numbers, runs 90-day ownership leases, and logs
every proposal and decision. Full scope in docs/SCOPE.md.
Alternatives considered: none recorded.
Agreed by: pending

D3: Stack (2026-11-06)
Status: replaced by D7
Choice and why: Python + FastAPI, SQLite or DuckDB, Claude API with tool use,
in-memory embeddings, Next.js or Streamlit, Recharts or Plotly. Simple, one
file of data, real SQL for the conflict explainer.
Alternatives considered: Streamlit-only for speed.
Agreed by: pending

D4: Narrow first demo and clarify governance (2026-11-06)
Status: replaced by proposed D5; SQL fixture assumption unsupported by final pack
Choice and why: P0 is intake, reuse, SQL metric comparison, versioned human
approval, applied reconciliation and audit. Lifecycle and simulated time move to
P1. Expiry flags review; archive requires approval. Scores are explained ranking
heuristics; conflict counts use explicit metric pairs. Approval requirements are
snapshotted per version; edits require fresh approvals.
Alternatives considered: full lifecycle in P0; automatic archiving on expiry.
Agreed by: pending. KayTee requested documentation fixes; final scope, stack and
interface still need team agreement after the briefing.

D5: Rebase draft scope on final brief and Pharmaceuticals pack (2026-11-06)
Status: proposed
Choice and why: KayTee requested source intake. CHALLENGE/DATA_SOURCES record
confirmed facts. Revised SCOPE uses supplied BI estate and source-cited evidence;
Pharmaceuticals replaces Crop Science, and KPI ambiguity replaces unsupported
four-variant SQL attribution. Migration and lineage become explicit context.
Synthetic data is confirmed acceptable; evaluation weights and deliverables
are known. No official ground truth, KPI formulas or 90-day requirement exists.
Alternatives considered: retain custom generator; add a separately labelled SQL
fixture later. Existing stack choices remain pending.
Agreed by: pending for design/contract. Source facts are evidence, not a team vote.

D6: Lineage drill-down in P0 (2026-11-06)
Status: accepted
Choice and why: Bayer rule 4 asks for upstream/downstream lineage. Users can
click any chart, number or candidate asset to see its lineage graph and how it
was traced (edge rows, stored query, source rows). Builds trust and shows
governance in the demo.
Alternatives considered: lineage only as text inside proposals.
Agreed by: Viet. Refined by KayTee's lineage limits (see D10): imported
assets show catalog edges only; app-computed values show their actual query;
no distinct-audience claims across assets or months.

D7: Stack: TypeScript, Next.js + Mastra + SQLite (2026-11-06)
Status: accepted
Choice and why: whole project mainly TypeScript. Next.js serves both tabs and
the API routes; Mastra builds the agent layer (agents, tools, workflow with a
human-approval pause); SQLite via libSQL, which Mastra supports. Claude via
Mastra model routing. One repo, one language, quick to change.
Alternatives considered: Python + FastAPI (D3); Vite React + separate Mastra
server.
Agreed by: Viet

D8: UI layout and roles (2026-11-06)
Status: accepted
Choice and why: one full-screen app. Top middle: Agentic | Dashboard tabs. Top
right: Employee / Manager toggle (simulated RBAC). Employee sees only the
Dashboard and only browses (no questions to agents). Manager sees everything:
Agentic tab with a switch between a responsive Chat view (streamed step states)
and a visual Pipeline view of the Miro agent layer + platform services, plus the
approval inbox and clock. Keeps the employee experience as simple as possible.
Alternatives considered: employee ask bar; chat-only Agentic tab.
Agreed by: Viet

D9: Miro lifecycle is P0, with a simulated clock (2026-11-06)
Status: accepted. Supersedes the P2 placement in D5.
Choice and why: the Miro lifecycle (Temporary TTL 30d → Personal → Team →
Certified, 90-day lease, owner review renew/merge/retire, default archive,
restore) is the core of the pitch. Bayer's pack has only monthly usage totals,
so promotion uses seeded, labelled team-synthetic per-user usage events; pack
data stays read-only next to app-owned tiers. Fast-forward shows 90 days in
seconds.
Alternatives considered: simplified states without a clock; keep at P1/P2.
Agreed by: Viet

D10: Shared workspaces and Miro diagram review (2026-11-06)
Status: accepted with two exceptions (see D9, D11). Proposed by KayTee as D7
in PR #7; renumbered because D7–D9 were already taken.
Choice and why: one application; dashboard and agentic workspaces share one
catalog, evidence service, proposal store and audit trail. Accepted: approval
authority follows the proposal's required approvers (owner / team lead /
steward), not workspace access; source audience, endorsement and lifecycle
fields stay separate from app tiers; app open events stay separate from
imported usage; lineage limits in SCOPE; store evidence and concise rationale,
not private reasoning; no claim of warehouse, live telemetry or query costs.
Not accepted: "expiry/silence never auto-archives" (Viet keeps D9, with
mitigations in SCOPE) and "one orchestrator only in P0" (see D11).
Alternatives considered: independent systems; automatic archive; full agent set.
Agreed by: Viet (exceptions decided 2026-11-06); KayTee proposed

D11: P0 agent set (2026-11-06)
Status: accepted
Choice and why: middle ground between six agents (our scope) and one
orchestrator (KayTee). P0 Mastra agents: Orchestrator (with intent parsing),
Discovery, Conflict detector, so the Pipeline view shows a real multi-agent
run. Builder and Lease steward agents move to P1; in P0 a deterministic build
tool renders the Temporary insight and the lifecycle engine runs lease reviews.
Alternatives considered: all six agents in P0; one orchestrator only.
Agreed by: Viet

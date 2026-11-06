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
Status: proposed
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
Status: proposed refinement; Viet accepted the original, both developers to review these limits
Choice and why: Bayer rule 4 asks for upstream/downstream lineage. Users can
open evidence/lineage for app-rendered charts, values and candidate assets.
Imported assets expose catalog edges; app-computed values expose their actual
query/source rows. No internal BI visual queries or cross-asset distinct audience
can be inferred from this pack. Builds trust and shows
governance in the demo.
Alternatives considered: lineage only as text inside proposals.
Agreed by: Viet (original); refined semantics pending team review.

D7: Shared dashboard and prompting workspaces; correct diagram semantics (2026-11-06)
Status: accepted by KayTee; Viet to confirm
Choice and why: one application with a normal-user discovery dashboard and a
manager/analyst prompting workspace, sharing evidence, proposals and audit.
Role-based owners/stewards approve versioned proposals. Expiry/silence triggers
review, not archive. P0 uses one orchestrator and deterministic tools, proposes
reuse/extension before new work, and records a local build request rather than
generating BI dashboards. Separate audience, endorsement and lifecycle fields;
keep local open events separate from imported usage. See SCOPE for PDF corrections.
Alternatives considered: independent systems, automatic archive, full builder
and lease agents in the first slice.
Agreed by: KayTee requested the two modes and documentation fixes; Viet pending.
Stack and exact shared contract remain unapproved.

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
Status: proposed (re-check after the Bayer briefing)
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

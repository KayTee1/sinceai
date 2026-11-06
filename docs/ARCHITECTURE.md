# Architecture

Status: **proposed** (D3), from [SCOPE](SCOPE.md#architecture-and-agent-tools).
Not agreed yet. Keep it as simple as the demo allows.

## Overview

- Stack: Python + FastAPI backend; Next.js (or Streamlit if short on time)
  frontend; Recharts or Plotly for charts.
- Components:
  - Frontend: intake chat, proposals queue, cycle review, audit timeline, portfolio view.
  - Backend API: one endpoint per screen action.
  - Agent (Claude + tools): clarifies, calls tools, explains, writes proposals only.
  - Deterministic services: Matcher, Conflict engine, Lifecycle engine (tiers,
    leases, sim clock), Audit writer (called by the backend, not the agent).
  - Storage: metadata store + `sales_orders` warehouse.
- AI model/provider and why: Claude API with tool use; tool calls map to the
  services. The LLM never produces numbers.
- Data storage: one SQLite or DuckDB file; embeddings in memory.
- Deployment: unknown (localhost for the video, or a public URL?).

Agent tools, data model and exact enums: see [SCOPE](SCOPE.md#data-model).
Keep table names and enums exactly as written there.

## Interface contract

Agree on this before both developers start, so the lanes can work in parallel
(e.g. the UI uses mock responses until the backend is ready). Changing it
needs both developers to agree.

```text
TBD after the briefing: endpoints with example input/output JSON.
Starting point: the agent tools in SCOPE (search_assets, get_asset, get_metric,
compare_metrics, run_metric, attribute_gap, get_usage, list_lease_due,
create_proposal) and the enums in SCOPE's data model.
```

Mock/fixture data lives in: TBD

## Configuration

Environment variable names only (values go in `.env`, never in Git):

- TBD

## Run commands

Exact, tested commands only.

```sh
# install:
# run:
# test:
```

## Demo setup

How to reset and run the demo, plus a fallback if an external service fails.

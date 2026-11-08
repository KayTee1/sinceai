# Live product demo runbook (after the 55 s film)

Target: about 3 min 40 s. Scenario: TEAM-REQ-01 (team-authored demo request, D18).
Rehearsed in a browser on branch `fix/demo-readiness` (base `origin/master` 3cdfb60),
production build, fresh database. All numbers below come from that rehearsal.

Decide the path **before** the show with the preflight check (step 4 of the checklist):

- **GO** (models answer 200): path L. The chat drives the pipeline live.
- **NO-GO** (any other result): path D. Do not click the Agentic starter on stage: it
  fails, and the chat then shows "The AI assistant is unavailable: …". Say up front
  that the AI wording is offline and that you are running the same governed
  workflow directly.

Never describe path D as a live AI interaction.

## Pre-show checklist (T-30 min)

1. Use an isolated worktree with its own database. Never use a shared `steward.db`.

   ```sh
   git fetch origin
   git worktree add ../sinceai-showtime fix/demo-readiness   # or master once merged
   cd ../sinceai-showtime
   npm ci
   mkdir -p data/private && cp /path/to/approved-pack.xlsx data/private/pack.xlsx
   npm run db:import          # creates data/private/steward.db in this worktree only
   ```

2. Create `.env.local` (Git ignores it, never commit it):

   ```dotenv
   ANTHROPIC_API_KEY=...
   SCHEDULER_DEMO_ACTIONS=1
   SCHEDULER_SIM_TRIGGER=1
   ```

3. Start in production mode (no Next.js dev badge): `npm run build && npm start`
   → http://localhost:3000.

4. Preflight the models: one 1-token call per model, which costs almost nothing. It prints only the status:

   ```sh
   set -a; . ./.env.local; set +a
   for m in claude-sonnet-5-5 claude-haiku-5-5; do
     curl -sS -o /dev/null -w "$m HTTP %{http_code}\n" https://api.anthropic.com/v1/messages \
       -H "x-api-key: $ANTHROPIC_API_KEY" -H 'anthropic-version: 2023-06-01' \
       -H 'content-type: application/json' \
       -d "{\"model\":\"$m\",\"max_tokens\":1,\"messages\":[{\"role\":\"user\",\"content\":\"ok\"}]}"
   done
   ```

   200 for both means GO. 400 usually means no credit, 401 a bad key, 404 a model that isn't
   available, and 429/529 a rate limit or overload. Last checked 2026-11-08: **400, no credit (NO-GO)**.

5. If GO: in the browser go to Manager → Agentic, click **Run team demo request TEAM-REQ-01**
   once, note how long it takes, then click **Submit build proposal**. This is the rehearsal.

6. Click **Reset demo** (top right, Manager). The clock pauses on 1 Nov 2026 with 0 under review.
   Reset clears app state, runs and audit; it does not reimport the workbook.

7. Without reloading the page, go to Manager → Dashboard → **Estate overview**. A reload switches the
   role back to Employee, and every Employee page load logs a dashboard view.

8. Path D only: open a terminal in the worktree with these commands typed in but not run:

   ```sh
   npx tsx src/mastra/workflows/request-pipeline-cli.ts TEAM-REQ-01
   curl -sS -X POST http://localhost:3000/api/builds -H 'Content-Type: application/json' -d '{"requestId":"TEAM-REQ-01"}'
   ```

9. Use a browser window at least 1600 px wide, with the film's last frame ready to cut to it.

## Run of show

Starting screen: **Manager → Dashboard → Estate overview**, clock paused on 1 Nov 2026.

| Time | Click | Say |
|---|---|---|
| 0:00–0:25 | (already open) | "This is Bayer's synthetic analytics estate, imported read-only: 360 assets, 100 product-market scopes with two or more dashboards, 18 metrics with unapproved variant definitions, 136 assets with fewer than 10 users a month. Our rule: ask before you build." |
| 0:25–1:15 | **Agentic** tab. Path L: starter **Run team demo request TEAM-REQ-01**. Path D: see below. Side panel **Pipeline › Steps**, then **Diagram** for 3 s, then back to **Steps**. | "TEAM-REQ-01 is a request our team wrote, and the app labels it that way: net sales and forecast variance for Xarelto in North America. Discovery finds 4 related dashboards. The conflict detector flags Net Sales KPI-001 against 2 variants and Forecast Variance KPI-042 against 3. No existing dashboard maps the approved Forecast Variance KPI, so reuse fails for a reason we can show. It proposes a small Temporary build on approved KPIs only." |
| 1:15–1:40 | Path L: **Submit build proposal** on the chat card. The Pipeline shows *Waiting for approval*. Then **Inbox (1)** → **Approve** (Daniel Schmidt is pre-selected). | "Nothing is built yet. The agent can only propose. A Lead in North America decides, and the requester can't approve their own build. The card shows the gap, the certified KPIs and the requester." |
| 1:40–2:20 | **Dashboard** → Team dashboards → scroll the left list to **Built insights** → *Xarelto · North America: Net Sales, Forecast Variance* → click **−€2.87m** (CA). | "It's registered as Temporary and expires on 1 Dec unless someone uses it. Every value shows its definition, formula, filters, source row and the exact SQL. Code computes the numbers, not the AI. The KPI mapping is ours, and it's labelled as proposed." |
| 2:20–2:45 | Clock bar **Next event · 2 Nov** → **Agentic › Inbox**. | "Now time moves. AST-0201's lease ended and nobody uses it, so it gets a retire review. Its owner is inactive, so nobody can approve it, and it waits for the data steward. Silence never deletes anything." |
| 2:45–3:20 | **+30d**. The header shows **56 Under review · 43 Escalated**. On the first card with an enabled **Reject** (*Eylea Inventory Monthly*, Julia Brown) → **Reject** → type "Finance close uses it in December; keep it." → **Reject with reason**. | "A month later, 52 used dashboards renewed themselves automatically. Unused ones went to their owners, and silent owners were escalated to stewards. A human said no, with a reason, so the dashboard is renewed for 90 days. Our Temporary insight wasn't opened again, so it expired. It's archived and can be restored." |
| 3:20–3:40 | **Dashboard › Estate overview**. | Read the strip: "53 renewed · 43 escalated · 1 expired · 1 built · 1 rejected. Every change has a named person or policy in the audit log." Then close. |

**Close:** "Analytics Steward doesn't add another dashboard. It makes every new one prove nobody has built it already, and every old one earn its next 90 days. Agents find the evidence, humans decide, and everything is auditable."

### Path D: the 0:25–1:40 segment without the model (about 20 s longer)

1. Say: "The AI wording is offline today. The chat only puts the result into words, so I'll run
   the same governed workflow directly."
2. Agentic tab, side panel **Pipeline**. Run the first terminal command. It prints
   `Deterministic fallback (no model): RUN-001 · TEAM-REQ-01 · path build · waiting_input`,
   and the Pipeline fills in within about 6 s, stopping at *Submit build proposal?*
3. Run the `curl`. The Pipeline switches to *Waiting for approval*.
4. Click back into the browser (focusing the window re-reads the inbox) → **Inbox (1)** → **Approve**.
   No page reload is needed. Continue at 1:40.

### If the model fails mid-show on path L

The chat shows "The AI assistant is unavailable: …" or "… can't reach the model …".
Don't retry on stage. Say so, then follow path D from step 2. If the chat already stored the
proposal, step 3 returns `already_proposed`; just go to the Inbox.

## Recovery

- **Wrong click or state:** **Reset demo**, then reopen the starting screen (the clock can't move backwards).
- **Second proposal refused as a duplicate:** a TEAM-REQ-01 proposal or build already exists. Reset.
- **Inbox looks stale:** click another side tab and then **Inbox** (opening it re-reads).
- **Scheduler error/deferred notice on the clock bar:** the clock change still stands. Carry on.
- **Server down:** `npm start` again in the worktree. State is in the SQLite file.

## What is live vs deterministic

- **Live model (path L only):** the chat wording and the Pipeline step summaries.
- **Deterministic code (both paths):** analysis, KPI conflicts, recommendation, proposal,
  approver rules, KPI values and provenance, lifecycle, escalation and scheduler checks.
- **Labelled as ours:** TEAM-REQ-01, the requester mapping and the D14 KPI mapping.
  All values are synthetic challenge data.

// T23: the request pipeline. The Mastra workflow runs the analysis leg and
// records step events; the requester's submit or "Use this" and the Lead's
// decision continue the same run through the existing services.
// Fixture: the T15 facts with a Lead (OWN-1) and a requester (OWN-R) in EMEA.
// REQ-S01 (Alphazol / EMEA, KPI-004 + KPI-042) recommends a build; mapping
// KPI-042 on AST-1 turns it into a reuse.
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook, type ParsedSheet } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { ORCHESTRATOR_INSTRUCTIONS, createOrchestratorTools } from "../src/mastra/agents/orchestrator-config";
import type { PipelineRunView } from "../src/mastra/tools/pipeline-tools";
import { createRequestPipeline, type Summarize } from "../src/mastra/workflows/request-pipeline";
import { confirmReuse, decideBuild, proposeBuild } from "../src/services/build";
import { resetLifecycle } from "../src/services/lifecycle";
import { getRun, latestRun, type RunWithEvents } from "../src/services/pipeline";
import { FACT_SHEETS } from "./fixtures/facts";
import { runChat, userMessage } from "./helpers/mock-agent";

const OWNERS: ParsedSheet = {
  sheet: "Owners",
  data: [
    ["owner_id", "owner_name", "role", "scope", "status"],
    ["OWN-1", "Fixture Lead", "Commercial Lead", "EMEA", "active"],
    ["OWN-R", "Fixture Requester", "Analyst", "EMEA", "active"],
  ],
};
const SHEETS = FACT_SHEETS.map((s) => (s.sheet === "Owners" ? OWNERS : s));
const EXPECTED = Object.fromEntries(SHEETS.filter((s) => s.sheet !== "START_HERE").map((s) => [s.sheet, s.data.length - 1]));
const DAY = "2026-11-03";

const dir = mkdtempSync(join(tmpdir(), "pipeline-test-"));
let db: Client;
let imported = false;

beforeEach(async () => {
  if (!imported) {
    const dest = join(dir, "pipeline.db");
    await importWorkbook({ sheets: SHEETS, dest, expected: EXPECTED });
    db = openDb(dest);
    imported = true;
  }
  await db.execute(`DELETE FROM Asset_KPI_Map WHERE asset_id = 'AST-1' AND kpi_id = 'KPI-042'`);
  await resetLifecycle(db, 0);
});

after(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

const pipeline = (summarize?: Summarize) => createRequestPipeline({ getDb: () => db, today: async () => DAY, summarize });

/** Latest event per (step, agent), as the Pipeline view reads it. */
function latest(run: RunWithEvents | null) {
  const m = new Map<string, { status: string; summary: string }>();
  for (const e of run?.events ?? []) m.set(`${e.step}/${e.agent}`, { status: e.status, summary: e.summary });
  return m;
}

describe("build path", () => {
  it("runs the sequence, waits for the submit, then the Lead, then registers the insight", async () => {
    const r = await pipeline().run({ requestId: "REQ-S01" });
    assert.deepEqual([r.path, r.status], ["build", "waiting_input"]);
    let ev = latest(await getRun(db, r.runId));
    for (const key of [
      "intent/Analyst",
      "intent/Orchestrator",
      "discovery/Orchestrator",
      "discovery/Discovery agent",
      "discovery/Metadata catalog",
      "conflict/Discovery agent",
      "conflict/Semantic layer",
      "duplicate/Discovery agent",
      "recommend/Orchestrator",
    ]) {
      assert.equal(ev.get(key)?.status, "done", key);
    }
    assert.match(ev.get("conflict/Semantic layer")!.summary, /Conflict: Net Sales Growth KPI-004 vs KPI-005/);
    assert.equal(ev.get("propose/Orchestrator")?.status, "waiting_input");

    const proposed = await proposeBuild(db, { requestId: "REQ-S01", requesterId: "OWN-R" }, DAY);
    assert.equal(proposed.status, "proposed");
    const waiting = await getRun(db, r.runId);
    assert.equal(waiting?.status, "waiting_approval");
    ev = latest(waiting);
    assert.equal(ev.get("propose/Orchestrator")?.status, "done");
    assert.equal(ev.get("approve/Approver")?.status, "waiting_approval");

    const proposalId = (proposed as { proposal: { id: string } }).proposal.id;
    const { insight } = await decideBuild(db, { proposalId, actor: "OWN-1", action: "approve" }, DAY);
    const done = await getRun(db, r.runId);
    assert.deepEqual([done?.status, done?.assetId], ["done", insight!.id]);
    ev = latest(done);
    for (const key of ["approve/Approver", "build/Semantic layer", "register/Lifecycle engine", "done/Lifecycle engine"]) {
      assert.equal(ev.get(key)?.status, "done", key);
    }
    assert.match(ev.get("done/Lifecycle engine")!.summary, /expires 2026-12-03/);
  });

  it("a rejected build ends the run as failed", async () => {
    const r = await pipeline().run({ requestId: "REQ-S01" });
    const proposed = await proposeBuild(db, { requestId: "REQ-S01", requesterId: "OWN-R" }, DAY);
    const proposalId = (proposed as { proposal: { id: string } }).proposal.id;
    await decideBuild(db, { proposalId, actor: "OWN-1", action: "reject", reason: "Not this quarter." }, DAY);
    const run = await getRun(db, r.runId);
    assert.equal(run?.status, "failed");
    assert.match(latest(run).get("approve/Approver")!.summary, /Not this quarter/);
  });

  it("stops without a build when the estate already covers it", async () => {
    await pipeline().run({ requestId: "REQ-S01" });
    const proposed = await proposeBuild(db, { requestId: "REQ-S01", requesterId: "OWN-R" }, DAY);
    await decideBuild(db, { proposalId: (proposed as { proposal: { id: string } }).proposal.id, actor: "OWN-1", action: "approve" }, DAY);
    const again = await pipeline().run({ requestId: "REQ-S01" });
    assert.deepEqual([again.path, again.status], ["reuse", "done"]);
    assert.equal(again.duplicate?.verdict, "reuse");
  });
});

describe("reuse path", () => {
  it("waits for 'Use this', then logs the reuse and finishes", async () => {
    await db.execute(`INSERT INTO Asset_KPI_Map (asset_id, kpi_id, usage_role, _source_row) VALUES ('AST-1', 'KPI-042', 'secondary', 999)`);
    const r = await pipeline().run({ requestId: "REQ-S01" });
    assert.deepEqual([r.path, r.status], ["reuse", "waiting_input"]);
    assert.equal(latest(await getRun(db, r.runId)).get("confirm_reuse/Analyst")?.status, "waiting_input");

    await confirmReuse(db, { requestId: "REQ-S01", assetId: "AST-1" }, DAY);
    const run = await getRun(db, r.runId);
    assert.deepEqual([run?.status, run?.assetId], ["done", "AST-1"]);
    const ev = latest(run);
    assert.equal(ev.get("confirm_reuse/Analyst")?.status, "done");
    assert.match(ev.get("log_reuse/Lifecycle engine")!.summary, /usage \+1 for OWN-R/);
  });
});

describe("agents and the orchestrator tool", () => {
  it("the Discovery agent and Conflict detector word their findings; the rest stays deterministic", async () => {
    const calls: string[] = [];
    const summarize: Summarize = async (agent, _facts, fallback) => {
      calls.push(agent);
      return `${agent}: ${fallback}`;
    };
    const r = await pipeline(summarize).run({ requestId: "REQ-S01" });
    assert.deepEqual(calls, ["Discovery agent", "Conflict detector"]);
    const ev = latest(await getRun(db, r.runId));
    assert.match(ev.get("discovery/Metadata catalog")!.summary, /^Discovery agent: \d+ dashboards/);
    assert.match(ev.get("conflict/Semantic layer")!.summary, /^Conflict detector: Conflict/);
  });

  it("runRequestPipeline starts a run and returns the analysis view with the run ID", async () => {
    const tools = createOrchestratorTools(() => db, { today: async () => DAY, sync: async () => {} });
    const r = await runChat({
      tools,
      script: [{ toolCalls: [{ id: "c1", name: "runRequestPipeline", input: { requestId: "REQ-S01" } }] }, { text: "ok" }],
      messages: [userMessage("u1", "Handle REQ-S01.")],
      instructions: ORCHESTRATOR_INSTRUCTIONS,
    });
    const out = r.chunks.find((c) => c.type === "tool-output-available") as { output: PipelineRunView };
    assert.equal(out.output.view, "pipeline-run/v1");
    assert.equal(out.output.analysis.recommendation.kind, "build_proposal");
    assert.equal(out.output.path, "build");
    assert.equal((await latestRun(db))?.runId, out.output.runId);
  });
});

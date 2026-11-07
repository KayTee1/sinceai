// B5 (T26): simulated-time triggering of the governance jobs. Same
// team-authored fixture as tests/scheduler-integration.test.ts, in its own
// disposable database. No LLM, no network, no Bayer data.
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook, type ParsedSheet } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { controlClock, decide, proposeRetire, readClock, resetLifecycle, restore } from "../src/services/lifecycle";
import {
  SIM_ACTOR,
  getCheckpoint,
  listFindings,
  listRuns,
  runIncremental,
  runSimulatedTriggers,
  simSettings,
  simulatedStatus,
  type Comparator,
  type SimTriggerResult,
} from "../src/services/scheduler";
import { runTriggerText, simResultLines } from "../src/lib/scheduler-client";
import { FACT_SHEETS } from "./fixtures/facts";

const OWNERS: ParsedSheet = {
  sheet: "Owners",
  data: [
    ["owner_id", "owner_name", "role", "scope", "status"],
    ["OWN-1", "Fixture Lead", "Commercial Lead", "EMEA", "active"],
    ["OWN-R", "Fixture Requester", "Analyst", "EMEA", "active"],
    ["OWN-S", "Fixture Steward", "Data Steward", "EMEA", "active"],
    ["OWN-T", "Fixture Analyst", "Analyst", "EMEA", "active"],
  ],
};
function patch(s: ParsedSheet): ParsedSheet {
  if (s.sheet === "Owners") return OWNERS;
  if (s.sheet === "Analytics_Assets") {
    return { sheet: s.sheet, data: s.data.map((r, i) => (i > 0 && r[0] === "AST-2" ? [...r.slice(0, 5), "OWN-R", ...r.slice(6)] : r)) };
  }
  return s;
}
const SHEETS = [
  ...FACT_SHEETS.map(patch),
  { sheet: "Asset_Usage", data: [["asset_id", "month", "views", "unique_users"], ["AST-2", "2026-10-01", 900, 300]] },
  { sheet: "Lineage_Edges", data: [["source_id", "target_id", "edge_type", "relationship"], ["AST-2", "AST-9", "ASSET_TO_ASSET", "feeds"]] },
].filter((s, i, all) => all.findIndex((x) => x.sheet === s.sheet) === i);
const EXPECTED = Object.fromEntries(SHEETS.filter((s) => s.sheet !== "START_HERE").map((s) => [s.sheet, s.data.length - 1]));

const dir = mkdtempSync(join(tmpdir(), "scheduler-simulated-test-"));
const DB_PATH = join(dir, "simulated.db");
let db: Client;
let imported = false;

beforeEach(async () => {
  if (!imported) {
    await importWorkbook({ sheets: SHEETS, dest: DB_PATH, expected: EXPECTED });
    db = openDb(DB_PATH);
    imported = true;
  }
  await resetLifecycle(db, 0);
});

after(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

const today = async () => (await readClock(db)).date;
const sim = (opts: Partial<Parameters<typeof runSimulatedTriggers>[1]> = {}) => runSimulatedTriggers(db, { source: "clock_action", ...opts });
const decisions = (r: SimTriggerResult) => Object.fromEntries(r.decisions.map((d) => [d.jobId, d.decision]));
const advance = (days: number) => controlClock(db, { action: "advance", days }, "manager");

/** A real estate change the incremental job watches: AST-2 retired then restored (overlaps AST-3). */
async function restoreAst2() {
  const date = await today();
  const p = await proposeRetire(db, { assetId: "AST-2", reason: "Fixture: retire then restore." }, date);
  await decide(db, { proposalId: p.id, actor: "OWN-R", action: "approve" }, date);
  await restore(db, { assetId: "AST-2", actor: "OWN-R" }, date);
}

const boom: Comparator = async () => {
  throw new Error("fixture: comparison unavailable");
};

describe("B5 simulated-clock triggers", () => {
  it("nothing runs when nothing is due; the decisions say why", async () => {
    const r = await sim();
    assert.deepEqual(decisions(r), { incremental_overlap: "not_due", periodic_reassessment: "not_due" });
    assert.equal((await listRuns(db)).length, 0);
    const status = await simulatedStatus(db, { autoOnClock: true, reassessEveryDays: null });
    assert.deepEqual(status.jobs.map((j) => [j.jobId, j.last?.decision, j.last?.simDate]), [
      ["incremental_overlap", "not_due", r.simDate],
      ["periodic_reassessment", "not_due", r.simDate],
    ]);
  });

  it("clock advances, a watched change makes the incremental job due, it runs and records a real finding", async () => {
    await advance(1);
    await restoreAst2();
    const before = await simulatedStatus(db);
    assert.equal(before.jobs.find((j) => j.jobId === "incremental_overlap")?.due.due, true);
    const r = await sim();
    const inc = r.decisions.find((d) => d.jobId === "incremental_overlap")!;
    assert.equal(inc.decision, "ran");
    assert.deepEqual([inc.run?.status, inc.run?.trigger, inc.run?.actor, inc.run?.simDate], ["succeeded", "simulated_clock", SIM_ACTOR, r.simDate]);
    const open = (await listFindings(db, { status: "open" })).findings;
    assert.deepEqual(open.map((f) => f.assetIds), [["AST-2", "AST-3"]]);
    assert.equal(open[0].firstSeen.runId, inc.run!.runId);
    // The new finding makes a first reassessment due at the same date; it runs after the incremental job.
    const per = r.decisions.find((d) => d.jobId === "periodic_reassessment")!;
    assert.deepEqual([per.decision, per.run?.status, per.run?.trigger], ["ran", "succeeded", "simulated_clock"]);
  });

  it("repeating the same simulated day is idempotent: no second run, no finding change", async () => {
    await restoreAst2();
    await sim();
    const runs = (await listRuns(db)).length;
    const findings = await listFindings(db, { status: "any" });
    for (let i = 0; i < 3; i++) {
      const again = await sim({ source: i % 2 ? "manual_check" : "clock_action" });
      assert.deepEqual(decisions(again), { incremental_overlap: "already_processed", periodic_reassessment: "already_processed" });
    }
    assert.equal((await listRuns(db)).length, runs);
    assert.deepEqual((await listFindings(db, { status: "any" })).findings.map((f) => [f.findingId, f.observations]), findings.findings.map((f) => [f.findingId, f.observations]));
  });

  it("concurrent triggers for the same day start at most one run per job", async () => {
    await restoreAst2();
    const results = await Promise.all([sim(), sim(), sim()]);
    const date = await today();
    for (const jobId of ["incremental_overlap", "periodic_reassessment"] as const) {
      const ok = (await listRuns(db, { jobId })).filter((r) => r.trigger === "simulated_clock" && r.simDate === date && r.status === "succeeded");
      assert.equal(ok.length, 1, jobId);
    }
    const all = results.flatMap((r) => r.decisions.map((d) => d.decision));
    assert.ok(all.every((d) => ["ran", "already_processed", "deferred", "not_due"].includes(d)));
    assert.equal((await listFindings(db, { status: "open" })).total, 1);
  });

  it("the next simulated date makes the periodic reassessment due again; the incremental job is not due without changes", async () => {
    await restoreAst2();
    await sim();
    await advance(1);
    const r = await sim();
    assert.deepEqual(decisions(r), { incremental_overlap: "not_due", periodic_reassessment: "ran" });
    const per = r.decisions[1].run!;
    assert.equal(per.summary?.reassessment?.counts.unchanged, 1);
  });

  it("a failed run is recorded; the next trigger at the same date retries it and recovers", async () => {
    await restoreAst2();
    const failed = await sim({ compare: boom });
    const inc = failed.decisions.find((d) => d.jobId === "incremental_overlap")!;
    assert.deepEqual([inc.decision, inc.run?.status, inc.run?.error?.code], ["ran", "failed", "evaluation_failed"]);
    assert.match(inc.reason, /retries/);
    assert.equal((await listFindings(db, { status: "any" })).total, 0, "a failed run writes no finding");
    assert.equal((await getCheckpoint(db, "incremental_overlap"))?.lastAuditId, 0, "a failed run does not move the checkpoint");
    const status = await simulatedStatus(db);
    assert.equal(status.jobs[0].last?.runId, inc.run!.runId);

    const retry = await sim();
    assert.equal(retry.decisions[0].decision, "ran");
    assert.equal(retry.decisions[0].run?.status, "succeeded");
    assert.equal((await listFindings(db, { status: "open" })).total, 1);
    const simRuns = (await listRuns(db, { jobId: "incremental_overlap" })).map((r) => r.status);
    assert.deepEqual(simRuns, ["succeeded", "failed"]);
  });

  it("a manual run in progress defers the simulated jobs; nothing overlaps, and the next trigger picks up", async () => {
    await restoreAst2();
    let inner: SimTriggerResult | null = null;
    const manual = await runIncremental(db, {
      actor: "manager",
      beforeCommit: async () => {
        inner = await sim();
      },
    });
    assert.equal(manual.status, "succeeded");
    assert.deepEqual(decisions(inner!), { incremental_overlap: "deferred", periodic_reassessment: "deferred" });
    assert.equal(inner!.decisions[0].run?.runId, manual.runId);
    assert.equal((await listRuns(db)).length, 1, "the deferred trigger started no run");

    // The manual run already consumed the change; the new finding is due for reassessment.
    const next = await sim();
    assert.deepEqual(decisions(next), { incremental_overlap: "not_due", periodic_reassessment: "ran" });
  });

  it("a simulated run in progress makes a manual run conflict (409 path), never overlap", async () => {
    await restoreAst2();
    let manualError: unknown = null;
    await sim({
      beforeCommit: async (jobId) => {
        if (jobId !== "incremental_overlap") return;
        await runIncremental(db, { actor: "manager" }).catch((e) => (manualError = e));
      },
    });
    assert.equal((manualError as { code?: string } | null)?.code, "conflict");
  });

  it("never ticks, moves or starts the clock", async () => {
    await controlClock(db, { action: "resume" }, "manager", Date.now());
    const before = await db.execute(`SELECT sim_date, running, anchor_ms FROM app_clock`);
    await restoreAst2();
    await sim();
    const afterRows = await db.execute(`SELECT sim_date, running, anchor_ms FROM app_clock`);
    assert.deepEqual(afterRows.rows[0], before.rows[0]);
  });

  it("demo cadence (opt-in) spaces out simulated reassessments; unset means none", async () => {
    await restoreAst2();
    await sim({ reassessEveryDays: 7 });
    await advance(1);
    const early = await sim({ reassessEveryDays: 7 });
    assert.equal(early.decisions[1].decision, "not_due");
    assert.match(early.decisions[1].reason, /Demo cadence: every 7/);
    await advance(6);
    assert.equal((await sim({ reassessEveryDays: 7 })).decisions[1].decision, "ran");
  });

  it("demo reset clears the simulated state with the other scheduler tables", async () => {
    await restoreAst2();
    await sim();
    await resetLifecycle(db, 0);
    const status = await simulatedStatus(db);
    assert.deepEqual(status.jobs.map((j) => j.last), [null, null]);
    assert.equal((await listRuns(db)).length, 0);
    assert.equal(Number((await db.execute(`SELECT COUNT(*) AS n FROM scheduler_sim_state`)).rows[0].n), 0);
    assert.deepEqual(decisions(await sim()), { incremental_overlap: "not_due", periodic_reassessment: "not_due" });
  });
});

describe("B5 settings and view helpers", () => {
  it("clock actions trigger only with both SCHEDULER_SIM_TRIGGER=1 and the demo action gate", () => {
    assert.equal(simSettings({}).autoOnClock, false);
    assert.equal(simSettings({ SCHEDULER_SIM_TRIGGER: "1" }).autoOnClock, false);
    assert.equal(simSettings({ SCHEDULER_DEMO_ACTIONS: "1" }).autoOnClock, false);
    assert.equal(simSettings({ SCHEDULER_SIM_TRIGGER: "1", SCHEDULER_DEMO_ACTIONS: "1" }).autoOnClock, true);
  });

  it("the demo cadence is off unless a whole number of days from 1 to 365 is set", () => {
    for (const v of [undefined, "", "0", "-3", "1.5", "abc", "366"]) {
      assert.equal(simSettings({ SCHEDULER_SIM_REASSESS_DAYS: v }).reassessEveryDays, null, String(v));
    }
    assert.equal(simSettings({ SCHEDULER_SIM_REASSESS_DAYS: "7" }).reassessEveryDays, 7);
  });

  it("result lines name each job, the date, the run and the reason; runs say who triggered them", async () => {
    await restoreAst2();
    const lines = simResultLines(await sim());
    assert.equal(lines.length, 2);
    assert.match(lines[0].text, /^Incremental overlap at \d{4}-\d{2}-\d{2}: ran SCH-.*succeeded \(1 created\)/);
    assert.equal(lines[0].tone, "ok");
    assert.equal(runTriggerText({ trigger: "simulated_clock", actor: SIM_ACTOR }), "triggered by the simulated clock");
    assert.equal(runTriggerText({ trigger: "manual", actor: "manager" }), "manual by manager (demo identity)");
    assert.deepEqual(simResultLines(null), []);
  });
});

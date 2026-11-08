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
import { clockSchedulerNotice, runTriggerText, simResultLines } from "../src/lib/scheduler-client";
import { addDays } from "../src/services/lifecycle/policy";
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
  await retireAndRestore("AST-2", "OWN-R");
}
async function retireAndRestore(assetId: string, owner: string) {
  const date = await today();
  const p = await proposeRetire(db, { assetId, reason: "Fixture: retire then restore." }, date);
  await decide(db, { proposalId: p.id, actor: owner, action: "approve" }, date);
  await restore(db, { assetId, actor: owner }, date);
}
/** A second watched change on the same simulated day (another asset, so proposal IDs do not collide). */
const restoreAst3 = () => retireAndRestore("AST-3", "OWN-1");

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

/** Saved simulated state per job: [sim_date, decision, run_id]. */
async function savedState() {
  const r = await db.execute(`SELECT job_id, sim_date, decision, run_id FROM scheduler_sim_state ORDER BY job_id`);
  return Object.fromEntries(r.rows.map((x) => [x.job_id as string, [x.sim_date, x.decision, x.run_id]]));
}

/** Every simulated run's sim_date equals the date its saved state names (Codex B5-F2 invariant). */
async function assertStateMatchesRuns() {
  const runs = await listRuns(db, { limit: 200 });
  for (const [jobId, [simDate, , runId]] of Object.entries(await savedState())) {
    if (!runId) continue;
    const run = runs.find((r) => r.runId === runId);
    assert.ok(run, `saved run ${runId} exists`);
    assert.equal(run.simDate, simDate, `${jobId}: saved state date ${simDate} vs run ${run.runId} date ${run.simDate}`);
  }
}

describe("Codex B5-F2: one simulated date per trigger under concurrent clock advancement", () => {
  it("clock advanced between the due decision and the run claim: nothing runs for the old date; the outcome says so", async () => {
    await restoreAst2();
    const d = await today();
    const r = await sim({
      beforeRun: async (jobId) => {
        if (jobId === "incremental_overlap") await advance(1); // a manager clock action lands here
      },
    });
    assert.equal(r.simDate, d);
    const inc = r.decisions.find((x) => x.jobId === "incremental_overlap")!;
    assert.equal(inc.decision, "deferred");
    assert.match(inc.reason, new RegExp(`Clock moved: .*from ${d} to ${addDays(d, 1)}.*next trigger evaluates ${addDays(d, 1)}`));
    assert.equal(inc.run, null);
    assert.equal((await listRuns(db)).length, 0, "no run claimed at the newer date under the older decision");
    assert.deepEqual((await savedState()).incremental_overlap, [d, "deferred", null]);

    // The next trigger evaluates the new date; its run, idempotency and saved state agree.
    const next = await sim();
    assert.equal(next.simDate, addDays(d, 1));
    const ran = next.decisions.find((x) => x.jobId === "incremental_overlap")!;
    assert.deepEqual([ran.decision, ran.run?.status, ran.run?.simDate], ["ran", "succeeded", addDays(d, 1)]);
    await assertStateMatchesRuns();
    assert.equal((await sim()).decisions[0].decision, "already_processed");
  });

  it("Codex's reproduction: a newer trigger completes while an older one is in flight; no run or state mixes the dates", async () => {
    await restoreAst2();
    const d = await today();
    let inner: SimTriggerResult | null = null;
    const outer = await sim({
      beforeRun: async (jobId) => {
        if (jobId !== "incremental_overlap" || inner) return;
        await advance(1);
        inner = await sim(); // completes at d+1 while the outer trigger still holds its d decision
      },
    });
    assert.equal(outer.simDate, d);
    assert.equal(inner!.simDate, addDays(d, 1));
    const innerInc = inner!.decisions.find((x) => x.jobId === "incremental_overlap")!;
    assert.deepEqual([innerInc.decision, innerInc.run?.simDate], ["ran", addDays(d, 1)]);
    assert.equal(outer.decisions.find((x) => x.jobId === "incremental_overlap")!.decision, "deferred");
    for (const run of await listRuns(db)) assert.equal(run.simDate, addDays(d, 1), `run ${run.runId} recorded the date it evaluated`);
    // The older trigger finishing last does not overwrite the newer date's saved state.
    const state = await savedState();
    assert.equal(state.incremental_overlap[0], addDays(d, 1));
    assert.equal(state.incremental_overlap[1], "ran");
    await assertStateMatchesRuns();
  });

  it("clock advanced after the claim: the run keeps the date it was claimed at, and so does the saved state", async () => {
    await restoreAst2();
    const d = await today();
    const r = await sim({
      beforeCommit: async (jobId) => {
        if (jobId === "incremental_overlap") await advance(1);
      },
    });
    const inc = r.decisions.find((x) => x.jobId === "incremental_overlap")!;
    assert.deepEqual([inc.decision, inc.run?.status, inc.run?.simDate], ["ran", "succeeded", d]);
    assert.equal(r.decisions[1].decision, "deferred", "the periodic job is not claimed at the newer date under this trigger");
    await assertStateMatchesRuns();
    const next = await sim();
    assert.deepEqual(decisions(next), { incremental_overlap: "not_due", periodic_reassessment: "ran" });
    assert.equal(next.decisions[1].run?.simDate, addDays(d, 1));
    await assertStateMatchesRuns();
  });
});

describe("Codex B5-F3: same-day watched change after a successful simulated run", () => {
  it("status says pending until the next simulated date, never due now; the trigger agrees; Run now still works", async () => {
    await restoreAst2();
    const d = await today();
    const first = await sim();
    assert.equal(first.decisions[0].decision, "ran");
    await restoreAst3(); // another watched change the same simulated day

    const status = await simulatedStatus(db);
    const inc = status.jobs.find((j) => j.jobId === "incremental_overlap")!;
    assert.equal(inc.due.due, false, "not 'Due now': today was already processed");
    assert.ok((inc.due.pendingChanges ?? 0) > 0, "the outstanding change is still reported");
    assert.equal(inc.due.nextOn, addDays(d, 1));
    assert.match(inc.due.reason, new RegExp(`already ran from the simulated clock at ${d}.*next simulated date \\(${addDays(d, 1)}\\).*Run now`));
    // The trigger does what the status says.
    assert.equal((await sim({ source: "manual_check" })).decisions[0].decision, "already_processed");

    // Every job the status calls due, the trigger runs (and vice versa) at this date.
    for (const j of (await simulatedStatus(db)).jobs) {
      const dec = (await sim()).decisions.find((x) => x.jobId === j.jobId)!;
      assert.equal(j.due.due, dec.decision === "ran", `${j.jobId}: status due=${j.due.due}, trigger ${dec.decision}`);
    }

    // Manual Run now picks the change up today (same-day policy only limits the simulated clock).
    const manual = await runIncremental(db, { actor: "manager" });
    assert.equal(manual.status, "succeeded");
    assert.equal((await simulatedStatus(db)).jobs[0].due.pendingChanges, 0);
  });

  it("without Run now, the pending change runs at the next simulated date", async () => {
    await restoreAst2();
    await sim();
    await restoreAst3();
    await advance(1);
    const before = (await simulatedStatus(db)).jobs[0].due;
    assert.equal(before.due, true);
    const r = await sim();
    assert.deepEqual([r.decisions[0].decision, r.decisions[0].run?.status], ["ran", "succeeded"]);
    assert.equal((await simulatedStatus(db)).jobs[0].due.pendingChanges, 0);
  });
});

describe("Codex B5-F1: a clock action that succeeded with a scheduler that did not", () => {
  const clock = (date: string) => ({ clock: { date, running: false }, processed: 0 });

  it("B5 gates off (no scheduler field): no notice, behaviour as before", () => {
    assert.equal(clockSchedulerNotice(clock("2026-05-01")), null);
    assert.equal(clockSchedulerNotice({}), null);
    assert.equal(clockSchedulerNotice(null), null);
  });

  it("a scheduler error is reported as clock advanced but evaluation failed, with the reason and recovery", () => {
    const n = clockSchedulerNotice({ ...clock("2026-05-01"), scheduler: { error: "database is locked" } })!;
    assert.equal(n.tone, "bad");
    assert.match(n.summary, /^Clock advanced to 2026-05-01, but scheduler evaluation failed\. Governance checks did not run\.$/);
    assert.match(n.detail, /database is locked/);
    assert.match(n.detail, /Check due jobs/);
    assert.doesNotMatch(n.detail, /succeeded/);
    const odd = clockSchedulerNotice({ scheduler: { unexpected: true } }, "Clock updated")!;
    assert.match(odd.summary, /^Clock updated, but scheduler evaluation failed/);
  });

  it("a failed run in the trigger result is reported, not hidden behind the 200", async () => {
    await restoreAst2();
    const scheduler = await sim({ compare: boom });
    const n = clockSchedulerNotice({ ...clock(scheduler.simDate), scheduler })!;
    assert.equal(n.tone, "bad");
    assert.match(n.summary, new RegExp(`Clock advanced to ${scheduler.simDate}, but scheduler evaluation failed at ${scheduler.simDate}`));
    assert.match(n.detail, /Incremental overlap: run SCH-\S+ failed \(evaluation_failed: .*comparison unavailable\)/);
    assert.match(n.detail, /Check due jobs/);
  });

  it("a deferred job (clock moved, or another run in progress) is reported as deferred with its reason", async () => {
    await restoreAst2();
    const scheduler = await sim({ beforeRun: async (j) => void (j === "incremental_overlap" && (await advance(1))) });
    const n = clockSchedulerNotice({ ...clock(scheduler.simDate), scheduler })!;
    assert.equal(n.tone, "attention");
    assert.match(n.summary, /but scheduler evaluation was deferred/);
    assert.match(n.detail, /Incremental overlap: deferred\. Clock moved/);
  });

  it("all jobs succeeded, not due or already processed: no warning", async () => {
    await restoreAst2();
    const ok = await sim();
    assert.equal(clockSchedulerNotice({ ...clock(ok.simDate), scheduler: ok }), null);
    assert.equal(clockSchedulerNotice({ ...clock(ok.simDate), scheduler: await sim() }), null);
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

// T24 (B1): incremental governance scheduler. Disposable database built from
// the team-authored T15 fact fixture (not Bayer data), patched like
// estate.test.ts: AST-1 Alphazol EMEA (KPI-004, OWN-1); AST-2 Betavex US
// (KPI-001, OWN-R) covered by AST-3 Betavex Global (KPI-001) and by AST-4, a
// Global board with six KPIs. REQ-S01 (Alphazol EMEA, KPI-004 + KPI-042)
// builds an insight (owner OWN-R) that covers AST-1. OWN-T is a third EMEA
// colleague so three non-owners can trigger the D17 promote-to-Team proposal.
//
// Database failures are injected natively (triggers, a deferred foreign key,
// a second connection holding a lock), never by throwing before a
// transaction starts, and no test calls or exposes garbage collection.
import { after, afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook, type ParsedSheet } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { decideBuild, proposeBuild } from "../src/services/build";
import { suggestMerge } from "../src/services/estate";
import { decide, listPendingProposals, proposeRetire, recordUsage, registerTemporary, resetLifecycle, restore } from "../src/services/lifecycle";
import {
  INCREMENTAL_JOB,
  SCHEDULER_TABLES,
  SchedulerError,
  abandonRun,
  ensureScheduler,
  authorizeDemoAction,
  claimRun,
  commitRun,
  countRuns,
  dismissFinding,
  getCheckpoint,
  getFinding,
  getRun,
  listFindings,
  listRuns,
  runIncremental,
  schedulerOverview,
  type Comparator,
} from "../src/services/scheduler";
import { LOCK_WAIT_MS, LockTimeoutError, schedulerDbTesting } from "../src/services/scheduler/db";
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
const TAIL = ["active", "certified", "Dashboard", "Power BI", "WS-1", "2026-09-01"];
function patch(s: ParsedSheet): ParsedSheet {
  if (s.sheet === "Owners") return OWNERS;
  if (s.sheet === "Analytics_Assets") {
    const rows = s.data.map((r, i) => (i > 0 && r[0] === "AST-2" ? [...r.slice(0, 5), "OWN-R", ...r.slice(6)] : r));
    return { sheet: s.sheet, data: [...rows, ["AST-4", "Betavex Global Everything", "SM-1", "Betavex", "Global", "OWN-S", ...TAIL]] };
  }
  if (s.sheet === "Asset_KPI_Map") {
    const extra = ["KPI-001", "KPI-004", "KPI-005", "KPI-014", "KPI-027", "KPI-042"].map((k) => ["AST-4", k, "primary"]);
    return { sheet: s.sheet, data: [...s.data, ...extra] };
  }
  return s;
}
const SHEETS = [
  ...FACT_SHEETS.map(patch),
  { sheet: "Asset_Usage", data: [["asset_id", "month", "views", "unique_users"], ["AST-2", "2026-10-01", 900, 300]] },
  { sheet: "Lineage_Edges", data: [["source_id", "target_id", "edge_type", "relationship"], ["AST-2", "AST-9", "ASSET_TO_ASSET", "feeds"]] },
].filter((s, i, all) => all.findIndex((x) => x.sheet === s.sheet) === i);
const EXPECTED = Object.fromEntries(SHEETS.filter((s) => s.sheet !== "START_HERE").map((s) => [s.sheet, s.data.length - 1]));
const DAY = "2026-11-03";
const INSIGHT = "INS-REQ-S01-1";

const dir = mkdtempSync(join(tmpdir(), "scheduler-test-"));
const DB_PATH = join(dir, "scheduler.db");
let db: Client;
let imported = false;

beforeEach(async () => {
  if (!imported) {
    await importWorkbook({ sheets: SHEETS, dest: DB_PATH, expected: EXPECTED });
    db = openDb(DB_PATH);
    imported = true;
  }
  schedulerDbTesting.lockWaitMs = LOCK_WAIT_MS;
  schedulerDbTesting.onOpen = undefined;
  schedulerDbTesting.onBusy = undefined;
  await resetLifecycle(db, 0);
});

// Locks held by a second connection are always released, even when a test fails.
const held: { release: () => Promise<void> }[] = [];
afterEach(async () => {
  for (const h of held.splice(0)) await h.release();
});

after(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function buildInsight() {
  const r = await proposeBuild(db, { requestId: "REQ-S01", requesterId: "OWN-R" }, DAY);
  assert.equal(r.status, "proposed");
  const { insight } = await decideBuild(db, { proposalId: (r as { proposal: { id: string } }).proposal.id, actor: "OWN-1", action: "approve" }, DAY);
  assert.equal(insight?.id, INSIGHT);
}

/** A watched change ("restored") that leaves the asset's scope, KPIs and tier as they were. */
async function retireAndRestore(assetId: string, owner: string, date = DAY) {
  const p = await proposeRetire(db, { assetId, reason: "Fixture: retire then restore." }, date);
  await decide(db, { proposalId: p.id, actor: owner, action: "approve" }, date);
  await restore(db, { assetId, actor: owner }, date);
}
const retireAndRestoreAst2 = () => retireAndRestore("AST-2", "OWN-R");
const retireAndRestoreAst1 = (date = DAY) => retireAndRestore("AST-1", "OWN-1", date);

/** Client A: a second, independent connection that takes the write lock (BEGIN IMMEDIATE) and writes an unwatched row. */
async function holdWriteLock() {
  await ensureScheduler(db); // tables first, so the lock is met by the scheduler step under test, not by table creation
  const a = openDb(DB_PATH);
  const tx = await a.transaction("write");
  await tx.execute({ sql: `INSERT INTO usage_events (asset_id, user_id, sim_date, origin) VALUES ('AST-9', 'EXT-A', ?, 'app')`, args: [DAY] });
  return hold(async () => {
    await tx.commit();
    a.close();
  });
}
function hold(end: () => Promise<void>) {
  let done = false;
  const h = {
    release: async () => {
      if (done) return;
      done = true;
      await end();
    },
  };
  held.push(h);
  return h;
}
/** A second, independent connection holding a read lock (SHARED) in an open transaction: a COMMIT elsewhere fails busy. */
async function holdReadLock() {
  const r = openDb(DB_PATH);
  const tx = await r.transaction("deferred");
  await tx.execute(`SELECT COUNT(*) FROM audit_log`);
  return hold(async () => {
    await tx.rollback();
    r.close();
  });
}
const externalWrites = async () =>
  Number((await db.execute(`SELECT COUNT(*) AS n FROM usage_events WHERE user_id = 'EXT-A'`)).rows[0].n);
const noGc = () => assert.equal(typeof (globalThis as { gc?: unknown }).gc, "undefined", "tests must not rely on garbage collection");

async function openFinding() {
  await buildInsight();
  await run();
  return (await listFindings(db, { status: "open" })).findings[0];
}
const sideOf = (f: { evidence: { mergeAway: { assetId: string; tier: string; appOpens90d: number }; keep: { assetId: string; tier: string; appOpens90d: number } } }, id: string) =>
  [f.evidence.mergeAway, f.evidence.keep].find((x) => x.assetId === id)!;

const maxAuditId = async () => Number((await db.execute(`SELECT MAX(id) AS m FROM audit_log`)).rows[0].m);
const run = (compare?: Comparator) => runIncremental(db, { actor: "manager", compare });
const spy = () => {
  const calls: string[] = [];
  const compare: Comparator = async (d, input, date) => (calls.push(input.assetId), suggestMerge(d, input, date));
  return { calls, compare };
};

describe("incremental run", () => {
  it("succeeds on a fresh estate without loading or comparing anything", async () => {
    const { calls, compare } = spy();
    const r = await run(compare);
    assert.equal(r.status, "succeeded");
    assert.deepEqual([r.mode, r.trigger, r.actor, r.jobId], ["incremental", "manual", "manager", "incremental_overlap"]);
    assert.match(r.runId, /^SCH-[0-9a-f-]{36}$/);
    assert.deepEqual(r.window, { fromAuditId: 0, toAuditId: await maxAuditId() });
    assert.deepEqual(r.summary?.assessments, []);
    assert.deepEqual(calls, []);
    assert.deepEqual(r.rules, [{ ruleId: "active_overlap", version: "overlap-v2" }]);
    assert.equal((await getCheckpoint(db, "incremental_overlap"))?.lastAuditId, r.window.toAuditId);
  });

  it("finds that a new insight covers an existing board, with evidence, and advances the checkpoint", async () => {
    await buildInsight();
    const r = await run();
    assert.equal(r.status, "succeeded");
    const a = r.summary!.assessments.find((x) => x.assetId === INSIGHT);
    assert.ok(a);
    assert.equal(a.outcome, "evaluated");
    assert.deepEqual(a.triggers.map((t) => t.action), ["temporary_registered", "insight_built"]);
    assert.equal(a.overlaps.merge, 1);
    assert.equal(r.summary!.findings.created, 1);
    assert.equal((await getCheckpoint(db, "incremental_overlap"))?.lastAuditId, await maxAuditId());

    const { findings } = await listFindings(db, { status: "open" });
    assert.equal(findings.length, 1);
    const f = findings[0];
    assert.deepEqual(f.assetIds, ["AST-1", INSIGHT]);
    assert.equal(f.dedupKey, `active_overlap:AST-1|${INSIGHT}`);
    assert.equal(f.evidence.verdict, "merge");
    assert.deepEqual([f.evidence.mergeAway.assetId, f.evidence.keep.assetId], ["AST-1", INSIGHT]);
    assert.deepEqual(f.evidence.sharedKpis, ["KPI-004"]);
    assert.equal(f.evidence.changedAssetId, INSIGHT);
    assert.match(f.evidence.reason, /already covers every KPI/);
    assert.ok(f.evidence.source.some((s) => s.sheet === "Analytics_Assets" && s.ids.includes("AST-1")));
    assert.ok(f.evidence.source.some((s) => s.sheet === "insights (app)" && s.ids.includes(INSIGHT)));
    assert.match(f.fingerprint, /^[0-9a-f]{64}$/);
    assert.deepEqual([f.firstSeen.runId, f.lastSeen.runId, f.observations, f.proposalId], [r.runId, r.runId, 1, null]);
  });

  it("a restored asset is compared again: merge into its Global board, keep both with the crowded one", async () => {
    await retireAndRestoreAst2();
    const r = await run();
    const a = r.summary!.assessments.find((x) => x.assetId === "AST-2");
    assert.deepEqual([a?.outcome, a?.overlaps], ["evaluated", { merge: 1, keep_both: 1, partial: 0 }]);
    const f = (await listFindings(db, { assetId: "AST-2" })).findings;
    assert.deepEqual(f.map((x) => x.assetIds), [["AST-2", "AST-3"]]);
    assert.deepEqual(f[0].evidence.downstreamAssets, ["AST-9"]);
    // Retire / proposal / decision rows in the window are read but are not triggers.
    assert.ok(r.summary!.eventsRead > r.summary!.relevantEvents);
  });

  it("repeat runs with no new changes create nothing and compare nothing", async () => {
    await buildInsight();
    await run();
    const { calls, compare } = spy();
    const r = await run(compare);
    assert.equal(r.window.fromAuditId, r.window.toAuditId);
    assert.deepEqual([r.summary!.assessments.length, calls.length], [0, 0]);
    assert.deepEqual(r.summary!.findings, { created: 0, updated: 0, unchanged: 0, reopened: 0, suppressed: 0 });
    assert.equal((await listFindings(db)).total, 1);
    assert.deepEqual(await countRuns(db), { running: 0, succeeded: 2, failed: 0, total: 2 });
    assert.equal((await listRuns(db, { limit: 1 }))[0].runId, r.runId);
  });

  it("re-observing an open finding keeps one row and counts the observation", async () => {
    await buildInsight();
    await run();
    await retireAndRestoreAst1(); // a watched change on the other side; nothing material changes
    const r = await run();
    assert.deepEqual([r.summary!.findings.unchanged, r.summary!.findings.created], [1, 0]);
    const all = await listFindings(db);
    assert.equal(all.total, 1);
    assert.deepEqual([all.findings[0].observations, all.findings[0].lastSeen.runId], [2, r.runId]);
  });

  it("an app asset without a built insight is reported as unsupported, not healthy", async () => {
    await registerTemporary(db, { assetId: "APP-X", name: "No insight row", ownerId: "OWN-R", approvedBy: "OWN-1" }, DAY);
    const r = await run();
    const a = r.summary!.assessments.find((x) => x.assetId === "APP-X");
    assert.equal(a?.outcome, "unsupported");
    assert.match(a!.reason, /overlap not assessed/);
    assert.ok(r.summary!.limitations.some((l) => /Imported catalog/.test(l)));
    assert.ok(INCREMENTAL_JOB.limitations.some((l) => /not detected/.test(l)));
  });

  it("never writes proposals, decisions, asset state, insights, usage, the clock, the audit log or imported tables", async () => {
    await buildInsight();
    await retireAndRestoreAst2();
    const tables = ["proposals", "decisions", "asset_state", "insights", "usage_events", "app_clock", "audit_log", "archive_snapshots", "Analytics_Assets", "Asset_KPI_Map", "KPI_Catalog", "Owners"];
    const snap = async () => Promise.all(tables.map(async (t) => JSON.stringify((await db.execute(`SELECT * FROM ${t} ORDER BY rowid`)).rows)));
    const before = await snap();
    const r = await run();
    assert.ok(r.summary!.findings.created >= 2);
    assert.deepEqual(await snap(), before);
  });
});

describe("dismissal", () => {
  it("requires a reason and is audited", async () => {
    const f = await openFinding();
    await assert.rejects(dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "  " }), (e: unknown) => e instanceof SchedulerError && e.code === "invalid");
    const d = await dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "Temporary insight is a one-off; AST-1 stays." });
    assert.equal(d.status, "dismissed");
    assert.deepEqual([d.dismissal?.actor, d.dismissal?.reason, d.dismissal?.fingerprint], ["manager", "Temporary insight is a one-off; AST-1 stays.", f.fingerprint]);
    const audit = await db.execute(`SELECT * FROM audit_log WHERE action = 'scheduler_finding_dismissed'`);
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].actor, "manager");
    assert.match(audit.rows[0].rationale as string, /one-off/);
    await assert.rejects(dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "again" }), (e: unknown) => e instanceof SchedulerError && e.code === "conflict");
  });

  it("stays dismissed when the same evidence is seen again; the scheduler's own audit rows are ignored", async () => {
    const f = await openFinding();
    await dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "Known overlap." });
    await retireAndRestoreAst1();
    const r = await run();
    assert.equal(r.summary!.ignoredSchedulerEvents, 1);
    assert.equal(r.summary!.findings.suppressed, 1);
    const after = await getFinding(db, f.findingId);
    assert.deepEqual([after?.status, after?.observations, after?.dismissal?.reason], ["dismissed", 2, "Known overlap."]);
  });

  it("reopens (audited) when the evidence changes materially", async () => {
    const f = await openFinding();
    await dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "Known overlap." });
    await retireAndRestoreAst1();
    // The board now maps one more KPI (simulated: imported mappings are read-only at runtime).
    const changed: Comparator = async (d, input, date) => {
      const r = await suggestMerge(d, input, date);
      for (const s of r.suggestions) for (const side of [s.mergeAway, s.keep]) if (side.assetId === "AST-1") side.kpiIds = [...side.kpiIds, "KPI-001"];
      return r;
    };
    const r = await run(changed);
    assert.equal(r.summary!.findings.reopened, 1);
    const after = await getFinding(db, f.findingId);
    assert.deepEqual([after?.status, after?.dismissal], ["open", null]);
    assert.notEqual(after?.fingerprint, f.fingerprint);
    const audit = await db.execute(`SELECT rationale FROM audit_log WHERE action = 'scheduler_finding_reopened'`);
    assert.equal(audit.rows.length, 1);
    assert.match(audit.rows[0].rationale as string, /Known overlap/);
  });
});

describe("failure, concurrency and recovery", () => {
  it("a failed evaluation records the error and keeps the checkpoint and findings unchanged", async () => {
    await run();
    const before = await getCheckpoint(db, "incremental_overlap");
    await buildInsight();
    const r = await run(async () => {
      throw new Error("estate read failed");
    });
    assert.deepEqual([r.status, r.error?.code, r.error?.stage, r.error?.message], ["failed", "evaluation_failed", "evaluate", "estate read failed"]);
    assert.deepEqual(await getCheckpoint(db, "incremental_overlap"), before);
    assert.equal((await listFindings(db)).total, 0);
    const retry = await run();
    assert.equal(retry.window.fromAuditId, before!.lastAuditId);
    assert.equal(retry.summary!.findings.created, 1);
  });


  it("refuses a second run while one is running", async () => {
    const held = await claimRun(db, { ...INCREMENTAL_JOB, trigger: "manual", actor: "manager" });
    await assert.rejects(run(), (e: unknown) => e instanceof SchedulerError && e.code === "conflict" && e.detail?.runningRunId === held.runId);
  });

  it("a run started while another is running is refused; one finding, consistent checkpoint", async () => {
    await buildInsight();
    let second: unknown;
    const first = await runIncremental(db, { actor: "manager", beforeCommit: async () => void (second = await run().catch((e: unknown) => e)) });
    assert.equal(first.status, "succeeded");
    assert.ok(second instanceof SchedulerError && second.code === "conflict" && second.detail?.runningRunId === first.runId);
    assert.equal((await listFindings(db)).total, 1);
    assert.equal((await getCheckpoint(db, "incremental_overlap"))?.lastAuditId, await maxAuditId());
    assert.deepEqual(await countRuns(db), { running: 0, succeeded: 1, failed: 0, total: 1 });
  });

  it("runs started at once from two independent clients never overlap and leave consistent state", async () => {
    await buildInsight();
    const other = openDb(DB_PATH);
    try {
      const results = await Promise.allSettled([run(), runIncremental(other, { actor: "manager" })]);
      for (const x of results) {
        if (x.status === "fulfilled") assert.equal(x.value.status, "succeeded");
        else assert.ok(x.reason instanceof SchedulerError && x.reason.code === "conflict", String(x.reason));
      }
      const ok = results.filter((x) => x.status === "fulfilled").length;
      assert.ok(ok >= 1);
      assert.deepEqual(await countRuns(db), { running: 0, succeeded: ok, failed: 0, total: ok });
      assert.equal((await listFindings(db)).total, 1);
      assert.equal((await getCheckpoint(db, "incremental_overlap"))?.lastAuditId, await maxAuditId());
    } finally {
      other.close();
    }
  });

  it("a run cannot be completed twice", async () => {
    const r = await claimRun(db, { ...INCREMENTAL_JOB, trigger: "manual", actor: "manager" });
    const summary = { window: r.window, eventsRead: 0, relevantEvents: 0, ignoredSchedulerEvents: 0, assessments: [], findings: { created: 0, updated: 0, unchanged: 0, reopened: 0, suppressed: 0 }, limitations: [] };
    await commitRun(db, r, async () => summary);
    await assert.rejects(commitRun(db, r, async () => summary), (e: unknown) => e instanceof SchedulerError && e.code === "conflict");
  });

  it("after a crash a manager abandons the stuck run (reason required, audited); a late commit is refused", async () => {
    await buildInsight();
    const stuck = await claimRun(db, { ...INCREMENTAL_JOB, trigger: "manual", actor: "manager" }); // process dies here
    await assert.rejects(run(), (e: unknown) => e instanceof SchedulerError && e.code === "conflict");
    await assert.rejects(abandonRun(db, { runId: stuck.runId, actor: "manager", reason: "" }), (e: unknown) => e instanceof SchedulerError && e.code === "invalid");
    const a = await abandonRun(db, { runId: stuck.runId, actor: "manager", reason: "Server restarted mid-run." });
    assert.deepEqual([a.status, a.error?.code, a.error?.actor], ["failed", "abandoned", "manager"]);
    assert.equal((await db.execute(`SELECT 1 FROM audit_log WHERE action = 'scheduler_run_abandoned'`)).rows.length, 1);
    assert.equal((await getCheckpoint(db, "incremental_overlap"))?.lastAuditId, 0);

    const next = await run();
    assert.deepEqual([next.status, next.window.fromAuditId, next.summary!.findings.created], ["succeeded", 0, 1]);
    // The "crashed" run comes back late: refused, nothing changes.
    const cp = await getCheckpoint(db, "incremental_overlap");
    await assert.rejects(commitRun(db, stuck, async () => next.summary!), (e: unknown) => e instanceof SchedulerError && e.code === "conflict");
    assert.deepEqual(await getCheckpoint(db, "incremental_overlap"), cp);
    await assert.rejects(abandonRun(db, { runId: stuck.runId, actor: "manager", reason: "x" }), (e: unknown) => e instanceof SchedulerError && e.code === "conflict");
  });

  it("a run abandoned while it evaluated cannot commit", async () => {
    await buildInsight();
    let runId = "";
    await assert.rejects(
      runIncremental(db, {
        actor: "manager",
        beforeCommit: async () => {
          runId = (await listRuns(db, { limit: 1 }))[0].runId;
          await abandonRun(db, { runId, actor: "manager", reason: "Looked stuck." });
        },
      }),
      (e: unknown) => e instanceof SchedulerError && e.code === "conflict" && e.detail?.outcome === "abandoned" && e.detail?.runId === runId,
    );
    assert.equal((await getRun(db, runId))?.error?.code, "abandoned");
    assert.equal((await listFindings(db)).total, 0);
  });
});

describe("lock contention across connections (F1)", () => {
  it("client A holds the write lock past the wait: the claim is refused and nothing is left running; once A commits the run succeeds", async () => {
    schedulerDbTesting.lockWaitMs = 100;
    const busy: string[] = [];
    schedulerDbTesting.onBusy = (s) => busy.push(s);
    await buildInsight();
    const a = await holdWriteLock();
    await assert.rejects(run(), (e: unknown) => e instanceof LockTimeoutError && e.code === "conflict");
    assert.ok(busy.length > 1 && busy.every((s) => s === "BEGIN"), "every retry met the lock at BEGIN, each on a new connection");
    assert.deepEqual(await countRuns(db), { running: 0, succeeded: 0, failed: 0, total: 0 });
    await a.release();
    noGc();
    // The scheduler writes right after A releases, and so does the app's shared client.
    const r = await run();
    assert.deepEqual([r.status, r.summary!.findings.created], ["succeeded", 1]);
    await recordUsage(db, { assetId: "AST-1", userId: "OWN-T" }, DAY);
    assert.equal(await externalWrites(), 1, "client A's own write was committed");
    assert.deepEqual(await countRuns(db), { running: 0, succeeded: 1, failed: 0, total: 1 });
  });

  it("client A releases during the wait: the run carries on and commits", async () => {
    const busy: string[] = [];
    schedulerDbTesting.onBusy = (s) => busy.push(s);
    await buildInsight();
    const a = await holdWriteLock();
    setTimeout(() => void a.release(), 100);
    const r = await run();
    assert.equal(r.status, "succeeded");
    assert.ok(busy.includes("BEGIN"));
    assert.equal(await externalWrites(), 1);
    assert.equal((await getCheckpoint(db, "incremental_overlap"))?.lastAuditId, await maxAuditId());
  });

  it("a reader makes the native COMMIT fail busy: rolled back, retried on a new connection, committed once the reader leaves", async () => {
    const busy: string[] = [];
    schedulerDbTesting.onBusy = (s) => busy.push(s);
    await buildInsight();
    const r = await runIncremental(db, {
      actor: "manager",
      beforeCommit: async () => {
        const h = await holdReadLock();
        setTimeout(() => void h.release(), 100);
      },
    });
    assert.ok(busy.includes("COMMIT"), `COMMIT itself met SQLITE_BUSY (saw ${busy.join(", ")})`);
    assert.deepEqual([r.status, r.summary!.findings.created], ["succeeded", 1]);
    assert.equal((await listFindings(db)).total, 1, "the retried commit wrote each finding once");
    noGc();
  });

  it("COMMIT stays busy and recording the failure meets the same lock: reported as unrecorded (not abandoned), nothing committed, the stranded run is recovered", async () => {
    schedulerDbTesting.lockWaitMs = 100;
    const busy: string[] = [];
    schedulerDbTesting.onBusy = (s) => busy.push(s);
    await buildInsight();
    let h: { release: () => Promise<void> } | undefined;
    let err: SchedulerError | undefined;
    await runIncremental(db, { actor: "manager", beforeCommit: async () => void (h = await holdReadLock()) }).catch((e) => (err = e));
    assert.ok(err instanceof SchedulerError && err.code === "conflict", String(err));
    const d = err.detail as { outcome: string; runId: string; runStatus: string; failure: { code: string; stage: string; message: string }; recordingError: string };
    assert.deepEqual([d.outcome, d.runStatus, d.failure.code, d.failure.stage], ["unrecorded", "running", "commit_failed", "commit"]);
    assert.match(d.failure.message, /stayed busy/);
    assert.match(d.recordingError, /stayed busy/);
    assert.match(err.message, new RegExp(d.runId));
    assert.doesNotMatch(err.message, /abandoned/);
    assert.ok(busy.includes("COMMIT"));
    // What is stored matches what was reported.
    const stuck = await getRun(db, d.runId);
    assert.deepEqual([stuck?.status, stuck?.error], ["running", null]);
    assert.equal((await listFindings(db)).total, 0);
    assert.deepEqual([(await getCheckpoint(db, "incremental_overlap"))?.lastAuditId, (await getCheckpoint(db, "incremental_overlap"))?.runId], [0, null]);

    await h!.release();
    noGc();
    await assert.rejects(run(), (e: unknown) => e instanceof SchedulerError && e.code === "conflict" && e.detail?.runningRunId === d.runId);
    const a = await abandonRun(db, { runId: d.runId, actor: "manager", reason: "Commit and failure recording both timed out." });
    assert.equal(a.error?.code, "abandoned");
    const next = await run();
    assert.deepEqual([next.status, next.window.fromAuditId, next.summary!.findings.created], ["succeeded", 0, 1]);
  });

  it("an evaluation failure whose recording meets an external writer keeps the original failure", async () => {
    schedulerDbTesting.lockWaitMs = 100;
    await buildInsight();
    let a: { release: () => Promise<void> } | undefined;
    let err: SchedulerError | undefined;
    await run(async () => {
      a = await holdWriteLock();
      throw new Error("estate read failed");
    }).catch((e) => (err = e));
    assert.ok(err instanceof SchedulerError, String(err));
    const d = err.detail as { outcome: string; runId: string; runStatus: string; failure: { code: string; message: string } };
    assert.deepEqual([d.outcome, d.runStatus, d.failure.code, d.failure.message], ["unrecorded", "running", "evaluation_failed", "estate read failed"]);
    assert.match(err.message, /estate read failed/);
    await a!.release();
    // Recorded on a retry? No: the run stays running until a manager abandons it; the checkpoint never moved.
    assert.equal((await getRun(db, d.runId))?.status, "running");
    assert.equal((await getCheckpoint(db, "incremental_overlap"))?.lastAuditId, 0);
  });
});

describe("commit transaction failures roll back (F1, C4)", () => {
  async function twoObservations() {
    await buildInsight();
    await retireAndRestoreAst2();
    await ensureScheduler(db);
  }

  it("a native error after one finding write rolls back every finding; the checkpoint stays; the failure is recorded", async () => {
    await twoObservations();
    // Fires on the second finding INSERT of the commit transaction, i.e. after one finding row was written in it.
    await db.execute(`CREATE TRIGGER test_fail_second_finding BEFORE INSERT ON scheduler_findings
                      WHEN (SELECT COUNT(*) FROM scheduler_findings) >= 1 BEGIN SELECT RAISE(ABORT, 'injected: second finding write failed'); END`);
    const r = await run();
    assert.deepEqual([r.status, r.error?.code, r.error?.stage], ["failed", "commit_failed", "commit"]);
    assert.match(r.error!.message, /injected: second finding write failed/);
    assert.equal(r.summary, null);
    assert.equal((await listFindings(db)).total, 0, "the first finding write was rolled back");
    assert.deepEqual(await getCheckpoint(db, "incremental_overlap").then((c) => [c?.lastAuditId, c?.runId]), [0, null]);

    await db.execute(`DROP TRIGGER test_fail_second_finding`);
    const retry = await run();
    assert.deepEqual([retry.status, retry.window.fromAuditId, retry.summary!.findings.created], ["succeeded", 0, 2]);
  });

  it("failing the last statement before COMMIT (checkpoint move) rolls back the findings and the run's success", async () => {
    await twoObservations();
    await db.execute(`CREATE TRIGGER test_fail_checkpoint BEFORE UPDATE ON scheduler_checkpoints
                      BEGIN SELECT RAISE(ABORT, 'injected: checkpoint write failed'); END`);
    try {
      const r = await run();
      assert.deepEqual([r.status, r.error?.code], ["failed", "commit_failed"]);
      assert.match(r.error!.message, /checkpoint write failed/);
      assert.equal((await listFindings(db)).total, 0);
      assert.deepEqual(await countRuns(db), { running: 0, succeeded: 0, failed: 1, total: 1 });
      assert.equal((await getCheckpoint(db, "incremental_overlap"))?.lastAuditId, 0);
    } finally {
      await db.execute(`DROP TRIGGER IF EXISTS test_fail_checkpoint`);
    }
  });

  it("a native COMMIT failure (deferred foreign key) rolls back, leaves no lock, and is recorded as commit_failed", async () => {
    await twoObservations();
    // COMMIT itself fails: a deferred foreign key is only checked there (scheduler connections get foreign_keys=ON via the test hook).
    schedulerDbTesting.onOpen = (conn) => void conn.exec("PRAGMA foreign_keys = ON");
    await db.execute(`CREATE TABLE test_parent (id TEXT PRIMARY KEY)`);
    await db.execute(`CREATE TABLE test_child (pid TEXT REFERENCES test_parent(id) DEFERRABLE INITIALLY DEFERRED)`);
    await db.execute(`CREATE TRIGGER test_commit_fk AFTER UPDATE ON scheduler_checkpoints BEGIN INSERT INTO test_child VALUES ('missing'); END`);
    try {
      const r = await run();
      assert.deepEqual([r.status, r.error?.code, r.error?.stage], ["failed", "commit_failed", "commit"]);
      assert.match(r.error!.message, /FOREIGN KEY/i);
      assert.equal((await listFindings(db)).total, 0);
      assert.equal(Number((await db.execute(`SELECT COUNT(*) AS n FROM test_child`)).rows[0].n), 0);
      assert.equal((await getCheckpoint(db, "incremental_overlap"))?.lastAuditId, 0);
      // No lock outlives the failed COMMIT: an independent connection writes at once.
      const b = openDb(DB_PATH);
      try {
        const w = await b.execute({ sql: `INSERT INTO usage_events (asset_id, user_id, sim_date, origin) VALUES ('AST-9', 'EXT-A', ?, 'app')`, args: [DAY] });
        assert.equal(w.rowsAffected, 1);
      } finally {
        b.close();
      }
      noGc();
    } finally {
      schedulerDbTesting.onOpen = undefined;
      await db.execute(`DROP TRIGGER IF EXISTS test_commit_fk`);
      await db.execute(`DROP TABLE IF EXISTS test_child`);
      await db.execute(`DROP TABLE IF EXISTS test_parent`);
    }
  });
});

describe("tier changes are material (F2)", () => {
  it("Temporary -> Personal after dismissal: the next run reopens it with the new tier; without further material change it stays dismissed", async () => {
    const f = await openFinding();
    assert.equal(sideOf(f, INSIGHT).tier, "temporary");
    assert.equal(f.evidence.basis.assets.find((a) => a.assetId === INSIGHT)?.tier, "temporary");
    await dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "Temporary one-off; AST-1 stays." });

    await recordUsage(db, { assetId: INSIGHT, userId: "OWN-R" }, DAY); // the owner opens it again: promoted to Personal
    const r = await run();
    assert.deepEqual(r.summary!.assessments.find((a) => a.assetId === INSIGHT)?.triggers.map((t) => t.action), ["promoted"]);
    assert.deepEqual([r.summary!.findings.reopened, r.summary!.findings.suppressed], [1, 0]);
    const reopened = (await getFinding(db, f.findingId))!;
    assert.deepEqual([reopened.status, reopened.dismissal], ["open", null]);
    assert.equal(sideOf(reopened, INSIGHT).tier, "personal");
    assert.equal(reopened.evidence.basis.assets.find((a) => a.assetId === INSIGHT)?.tier, "personal");
    assert.notEqual(reopened.fingerprint, f.fingerprint);
    assert.equal(reopened.lastSeen.runId, r.runId);
    const audit = await db.execute(`SELECT rationale FROM audit_log WHERE action = 'scheduler_finding_reopened'`);
    assert.equal(audit.rows.length, 1);

    // Dismissed again on the Personal evidence; a later non-material change keeps it dismissed.
    await dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "Personal copy is fine." });
    await retireAndRestoreAst1();
    const again = await run();
    assert.deepEqual([again.summary!.findings.suppressed, again.summary!.findings.reopened], [1, 0]);
    const empty = await run();
    assert.equal(empty.summary!.assessments.length, 0);
    const still = (await getFinding(db, f.findingId))!;
    assert.deepEqual([still.status, still.dismissal?.reason], ["dismissed", "Personal copy is fine."]);
  });

  it("Temporary -> Team after dismissal (D17 promotion approved by a Lead) reopens the finding", async () => {
    const f = await openFinding();
    await dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "Temporary one-off." });
    for (const user of ["OWN-1", "OWN-S", "OWN-T"]) await recordUsage(db, { assetId: INSIGHT, userId: user }, DAY);
    const p = (await listPendingProposals(db)).find((x) => x.type === "promote");
    assert.ok(p, "three EMEA colleagues opened it: promote-to-Team proposal");
    await decide(db, { proposalId: p.id, actor: "OWN-1", action: "approve" }, DAY);

    const r = await run();
    assert.equal(r.summary!.findings.reopened, 1);
    const after = (await getFinding(db, f.findingId))!;
    assert.deepEqual([after.status, sideOf(after, INSIGHT).tier], ["open", "team"]);
  });

  it("usage counters alone change the stored evidence but not the fingerprint", async () => {
    const f = await openFinding();
    assert.equal(sideOf(f, INSIGHT).appOpens90d, 0);
    await recordUsage(db, { assetId: INSIGHT, userId: "OWN-1" }, DAY); // a colleague's open: no promotion (1 of 3)
    await recordUsage(db, { assetId: "AST-1", userId: "OWN-T" }, DAY);
    await retireAndRestoreAst1();
    const r = await run();
    assert.deepEqual([r.summary!.findings.unchanged, r.summary!.findings.updated], [1, 0]);
    const after = (await getFinding(db, f.findingId))!;
    assert.equal(after.fingerprint, f.fingerprint);
    assert.equal(sideOf(after, INSIGHT).appOpens90d, 1);
    assert.equal(sideOf(after, INSIGHT).tier, "temporary");

    await dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "Known overlap." });
    await recordUsage(db, { assetId: "AST-1", userId: "OWN-S" }, DAY);
    await retireAndRestoreAst1("2026-11-04");
    const again = await run();
    assert.deepEqual([again.summary!.findings.suppressed, again.summary!.findings.reopened], [1, 0]);
  });
});

describe("evaluation cost (C2)", () => {
  it("compares each asset at most once per run, with the same findings", async () => {
    await buildInsight();
    await retireAndRestoreAst1(); // AST-1 changed too, and the new insight covers it: asked about twice without the memo
    const { calls, compare } = spy();
    const r = await run(compare);
    assert.deepEqual([...calls].sort(), [...new Set(calls)].sort());
    assert.deepEqual([...calls].sort(), ["AST-1", INSIGHT].sort());
    assert.deepEqual([r.summary!.findings.created, (await listFindings(db)).total], [1, 1]);
    for (const id of ["AST-1", INSIGHT]) assert.ok(r.summary!.assessments.find((a) => a.assetId === id)?.findingKeys.length === 1);
  });
});

describe("demo reset", () => {
  it("drops runs, findings and the checkpoint with the audit log; the next run starts at the new log", async () => {
    await buildInsight();
    await run();
    assert.equal((await listFindings(db)).total, 1);
    await resetLifecycle(db, 0);
    const tables = await db.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'scheduler_%'`);
    assert.deepEqual(tables.rows, [], `reset drops ${SCHEDULER_TABLES.join(", ")}`);
    const o = await schedulerOverview(db);
    assert.deepEqual([o.jobs[0].checkpoint, o.jobs[0].runs.total, o.findings], [null, 0, { open: 0, dismissed: 0 }]);
    const r = await run();
    assert.deepEqual([r.window.fromAuditId, r.summary!.assessments.length], [0, 0]);
  });

  it("a run in flight during a reset commits nothing", async () => {
    await buildInsight();
    await assert.rejects(
      runIncremental(db, { actor: "manager", beforeCommit: () => resetLifecycle(db, 0) }),
      (e: unknown) => e instanceof SchedulerError && e.code === "conflict" && e.detail?.outcome === "reset",
    );
    assert.equal((await listFindings(db)).total, 0);
    assert.equal((await countRuns(db)).total, 0);
    assert.equal(await getCheckpoint(db, "incremental_overlap"), null);
  });
});

describe("HTTP access gate", () => {
  it("is off unless the server opts in, and then accepts only the demo manager", () => {
    assert.throws(() => authorizeDemoAction("manager", {}), (e: unknown) => e instanceof SchedulerError && e.code === "not_allowed");
    assert.equal(authorizeDemoAction("manager", { SCHEDULER_DEMO_ACTIONS: "1" }), "manager");
    for (const actor of ["OWN-1", "", undefined, "Manager "]) {
      assert.throws(() => authorizeDemoAction(actor, { SCHEDULER_DEMO_ACTIONS: "1" }), SchedulerError);
    }
  });
});

// T24 (B1): incremental governance scheduler. Disposable database built from
// the team-authored T15 fact fixture (not Bayer data), patched like
// estate.test.ts: AST-1 Alphazol EMEA (KPI-004, OWN-1); AST-2 Betavex US
// (KPI-001, OWN-R) covered by AST-3 Betavex Global (KPI-001) and by AST-4, a
// Global board with six KPIs. REQ-S01 (Alphazol EMEA, KPI-004 + KPI-042)
// builds an insight that covers AST-1.
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook, type ParsedSheet } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { decideBuild, proposeBuild } from "../src/services/build";
import { suggestMerge } from "../src/services/estate";
import { decide, proposeRetire, recordUsage, registerTemporary, resetLifecycle, restore } from "../src/services/lifecycle";
import {
  INCREMENTAL_JOB,
  SCHEDULER_TABLES,
  SchedulerError,
  abandonRun,
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
import { FACT_SHEETS } from "./fixtures/facts";

const OWNERS: ParsedSheet = {
  sheet: "Owners",
  data: [
    ["owner_id", "owner_name", "role", "scope", "status"],
    ["OWN-1", "Fixture Lead", "Commercial Lead", "EMEA", "active"],
    ["OWN-R", "Fixture Requester", "Analyst", "EMEA", "active"],
    ["OWN-S", "Fixture Steward", "Data Steward", "EMEA", "active"],
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
let db: Client;
let imported = false;

beforeEach(async () => {
  if (!imported) {
    const dest = join(dir, "scheduler.db");
    await importWorkbook({ sheets: SHEETS, dest, expected: EXPECTED });
    db = openDb(dest);
    imported = true;
  }
  await resetLifecycle(db, 0);
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

async function retireAndRestoreAst2() {
  const p = await proposeRetire(db, { assetId: "AST-2", reason: "Fixture: retire then restore." }, DAY);
  await decide(db, { proposalId: p.id, actor: "OWN-R", action: "approve" }, DAY);
  await restore(db, { assetId: "AST-2", actor: "OWN-R" }, DAY);
}

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
    assert.deepEqual(r.rules, [{ ruleId: "active_overlap", version: "overlap-v1" }]);
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
    await recordUsage(db, { assetId: INSIGHT, userId: "OWN-R" }, DAY); // owner reopens: promoted (a watched change)
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
  async function openFinding() {
    await buildInsight();
    await run();
    return (await listFindings(db, { status: "open" })).findings[0];
  }

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
    await recordUsage(db, { assetId: INSIGHT, userId: "OWN-R" }, DAY);
    const r = await run();
    assert.equal(r.summary!.ignoredSchedulerEvents, 1);
    assert.equal(r.summary!.findings.suppressed, 1);
    const after = await getFinding(db, f.findingId);
    assert.deepEqual([after?.status, after?.observations, after?.dismissal?.reason], ["dismissed", 2, "Known overlap."]);
  });

  it("reopens (audited) when the evidence changes materially", async () => {
    const f = await openFinding();
    await dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "Known overlap." });
    await recordUsage(db, { assetId: INSIGHT, userId: "OWN-R" }, DAY);
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

  it("a failed commit writes no findings and does not move the checkpoint", async () => {
    await buildInsight();
    const r = await runIncremental(db, {
      actor: "manager",
      beforeCommit: async () => {
        throw new Error("disk full");
      },
    });
    assert.deepEqual([r.status, r.error?.code], ["failed", "commit_failed"]);
    assert.equal((await getCheckpoint(db, "incremental_overlap"))?.lastAuditId, 0);
    assert.equal((await listFindings(db)).total, 0);
  });

  it("refuses a second run while one is running", async () => {
    const held = await claimRun(db, { ...INCREMENTAL_JOB, trigger: "manual", actor: "manager" });
    await assert.rejects(run(), (e: unknown) => e instanceof SchedulerError && e.code === "conflict" && e.detail?.runningRunId === held.runId);
  });

  it("two simultaneous runs: one succeeds, the other is refused; one finding, consistent checkpoint", async () => {
    await buildInsight();
    const results = await Promise.allSettled([run(), run()]);
    const ok = results.filter((x) => x.status === "fulfilled" && x.value.status === "succeeded");
    const refused = results.filter((x) => x.status === "rejected" && x.reason instanceof SchedulerError && x.reason.code === "conflict");
    assert.deepEqual([ok.length, refused.length], [1, 1]);
    assert.equal((await listFindings(db)).total, 1);
    assert.equal((await getCheckpoint(db, "incremental_overlap"))?.lastAuditId, await maxAuditId());
    assert.deepEqual(await countRuns(db), { running: 0, succeeded: 1, failed: 0, total: 1 });
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
      (e: unknown) => e instanceof SchedulerError && e.code === "conflict",
    );
    assert.equal((await getRun(db, runId))?.error?.code, "abandoned");
    assert.equal((await listFindings(db)).total, 0);
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
      (e: unknown) => e instanceof SchedulerError && e.code === "conflict",
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

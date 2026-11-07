// T24 (B2): periodic reassessment of known scheduler findings (Mode 3).
// Same disposable fixture as tests/scheduler.test.ts (team-authored T15
// facts, not Bayer data): AST-1 Alphazol EMEA (KPI-004, OWN-1); REQ-S01
// builds INS-REQ-S01-1 (Alphazol EMEA, KPI-004 + KPI-042, owner OWN-R) that
// covers AST-1, so the incremental run records one open finding for the pair.
//
// Catalog KPI mappings are read-only at runtime; tests that need them to
// change edit this disposable copy and restore it in `finally`.
// Failures are injected natively (triggers), never by throwing before a
// transaction starts. No LLM or network calls.
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook, type ParsedSheet } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { decideBuild, proposeBuild } from "../src/services/build";
import { proposeMerge, suggestMerge, type MergeSuggestion } from "../src/services/estate";
import { decide, listPendingProposals, proposeRetire, recordUsage, resetLifecycle, restore } from "../src/services/lifecycle";
import {
  B1_FINDINGS_DDL,
  INCREMENTAL_JOB,
  PERIODIC_JOB,
  SCHEDULER_TABLES,
  SchedulerError,
  abandonRun,
  claimConflict,
  claimRun,
  commitRun,
  countRuns,
  dismissFinding,
  ensureScheduler,
  getCheckpoint,
  getFinding,
  getRun,
  listFindings,
  listRuns,
  parseJobFilter,
  parseJobId,
  readReassessmentDueState,
  reassessmentDue,
  runIncremental,
  runJob,
  runReassessment,
  schedulerOverview,
  type Comparator,
  type Finding,
} from "../src/services/scheduler";
import { LOCK_WAIT_MS, schedulerDbTesting } from "../src/services/scheduler/db";
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

const dir = mkdtempSync(join(tmpdir(), "scheduler-reassess-test-"));
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

/** One open finding for AST-1 / the insight, recorded by an incremental run. */
async function openFinding(): Promise<Finding> {
  await buildInsight();
  const r = await runIncremental(db, { actor: "manager" });
  assert.equal(r.summary!.findings.created, 1);
  return (await listFindings(db, { status: "open" })).findings[0];
}

async function archiveAst1() {
  const p = await proposeRetire(db, { assetId: "AST-1", reason: "Fixture: retired." }, DAY);
  await decide(db, { proposalId: p.id, actor: "OWN-1", action: "approve" }, DAY);
}

const periodic = (compare?: Comparator) => runReassessment(db, { actor: "manager", compare });
const maxAuditId = async () => Number((await db.execute(`SELECT MAX(id) AS m FROM audit_log`)).rows[0].m);
const auditSince = async (id: number) =>
  (await db.execute({ sql: `SELECT action, actor FROM audit_log WHERE id > ? ORDER BY id`, args: [id] })).rows.map((r) => ({ action: r.action as string, actor: r.actor as string }));
const sideOf = (f: Finding, id: string) => [f.evidence.mergeAway, f.evidence.keep].find((x) => x.assetId === id)!;

/** Edits the disposable copy's (read-only at runtime) AST-1 KPI mapping, restoring it afterwards. */
async function withAst1Kpis(kpis: string[], fn: () => Promise<void>) {
  const before = (await db.execute(`SELECT * FROM Asset_KPI_Map WHERE asset_id = 'AST-1' ORDER BY rowid`)).rows;
  const cols = Object.keys(before[0]);
  await db.execute(`DELETE FROM Asset_KPI_Map WHERE asset_id = 'AST-1'`);
  try {
    for (const k of kpis) {
      const row = { ...before[0], kpi_id: k, _source_row: 9000 + kpis.indexOf(k) } as Record<string, unknown>;
      await db.execute({ sql: `INSERT INTO Asset_KPI_Map (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, args: cols.map((c) => row[c] as string) });
    }
    await fn();
  } finally {
    await db.execute(`DELETE FROM Asset_KPI_Map WHERE asset_id = 'AST-1'`);
    for (const r of before) {
      await db.execute({ sql: `INSERT INTO Asset_KPI_Map (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, args: cols.map((c) => r[c] as string) });
    }
  }
}

const LIFECYCLE_TABLES = ["proposals", "decisions", "asset_state", "insights", "usage_events", "app_clock", "archive_snapshots", "Analytics_Assets", "Asset_KPI_Map", "KPI_Catalog", "Owners"];
const snapLifecycle = async () => Promise.all(LIFECYCLE_TABLES.map(async (t) => JSON.stringify((await db.execute(`SELECT * FROM ${t} ORDER BY rowid`)).rows)));

describe("periodic reassessment run", () => {
  it("runs manually without chat or an LLM; reports an empty scope when there are no findings", async () => {
    const calls: string[] = [];
    const r = await periodic(async (d, input, date) => (calls.push(input.assetId), suggestMerge(d, input, date)));
    assert.deepEqual([r.status, r.jobId, r.mode, r.trigger, r.actor], ["succeeded", "periodic_reassessment", "reassessment", "manual", "manager"]);
    assert.deepEqual(r.summary!.reassessment!.scope, { open: 0, dismissed: 0 });
    assert.deepEqual(calls, [], "nothing to reassess: nothing compared");
    assert.deepEqual(r.window, { fromAuditId: 0, toAuditId: await maxAuditId() });
    assert.deepEqual(r.rules, PERIODIC_JOB.rules);
    assert.equal(await getCheckpoint(db, "periodic_reassessment"), null, "no checkpoint for the periodic job");
  });

  it("reassesses an open finding: same material evidence => unchanged; current evidence refreshed; compares only the pair", async () => {
    const f = await openFinding();
    const calls: string[] = [];
    const r = await periodic(async (d, input, date) => (calls.push(input.assetId), suggestMerge(d, input, date)));
    assert.equal(r.status, "succeeded");
    const re = r.summary!.reassessment!;
    assert.deepEqual(re.scope, { open: 1, dismissed: 0 });
    assert.deepEqual(re.assetsCompared, ["AST-1", INSIGHT]);
    assert.deepEqual([...new Set(calls)].sort(), ["AST-1", INSIGHT], "no full-estate sweep");
    assert.equal(re.counts.unchanged, 1);
    assert.deepEqual(re.results.map((x) => [x.findingId, x.fromStatus, x.toStatus, x.outcome]), [[f.findingId, "open", "open", "unchanged"]]);
    assert.deepEqual(r.summary!.findings, { created: 0, updated: 0, unchanged: 1, reopened: 0, suppressed: 0, resolved: 0 });
    const after = (await getFinding(db, f.findingId))!;
    assert.deepEqual([after.status, after.fingerprint, after.observations, after.lastSeen.runId], ["open", f.fingerprint, 2, r.runId]);
    // B2-F2: current evidence is the periodic observation (no audit triggers), everything else equal here.
    const auditRef = (e: Finding["evidence"]) => e.source.map((x) => (x.sheet === "audit_log (app)" ? { ...x, ids: [] } : x));
    assert.deepEqual({ ...after.evidence, source: auditRef(after.evidence) }, { ...f.evidence, triggers: [], source: auditRef(f.evidence) });
  });

  it("updates an open finding whose evidence changed (tier Temporary -> Personal)", async () => {
    const f = await openFinding();
    await recordUsage(db, { assetId: INSIGHT, userId: "OWN-R" }, DAY); // owner opens it again: promoted to Personal
    const r = await periodic();
    assert.equal(r.summary!.reassessment!.counts.updated, 1);
    const after = (await getFinding(db, f.findingId))!;
    assert.deepEqual([after.status, sideOf(after, INSIGHT).tier], ["open", "personal"]);
    assert.notEqual(after.fingerprint, f.fingerprint);
    assert.equal(after.evidence.changedAssetId, f.evidence.changedAssetId, "same perspective as the stored evidence");
    assert.deepEqual(after.evidence.triggers, []);
  });

  it("resolves when one side is archived (asset_inactive), audited, without any lifecycle side effect", async () => {
    const f = await openFinding();
    await archiveAst1();
    const before = await snapLifecycle();
    const mark = await maxAuditId();
    const r = await periodic();
    const res = r.summary!.reassessment!.results[0];
    assert.deepEqual([res.outcome, res.toStatus, res.resolution?.reason], ["resolved", "resolved", "asset_inactive"]);
    assert.equal(r.summary!.findings.resolved, 1);
    const after = (await getFinding(db, f.findingId))!;
    assert.equal(after.status, "resolved");
    assert.equal(after.resolution?.reason, "asset_inactive");
    assert.equal(after.resolution?.fromStatus, "open");
    assert.equal(after.resolution?.runId, r.runId);
    assert.equal(after.resolution?.evidence.assets.find((a) => a.assetId === "AST-1")?.status, "archived");
    assert.equal(after.resolution?.evidence.previousFingerprint, f.fingerprint);
    assert.equal(after.lastSeen.runId, f.lastSeen.runId, "last seen stays the last run that saw the overlap");
    // No lease / TTL / retire / promote / proposal side effects: only the scheduler's own audit row.
    assert.deepEqual(await snapLifecycle(), before);
    assert.deepEqual(await auditSince(mark), [{ action: "scheduler_finding_resolved", actor: "scheduler" }]);
  });

  it("resolves when the KPIs diverge (no_overlap) and when the verdict changes (verdict_changed), with the evidence", async () => {
    const f = await openFinding();
    await withAst1Kpis(["KPI-001"], async () => {
      const r = await periodic();
      const res = r.summary!.reassessment!.results[0];
      assert.deepEqual([res.outcome, res.resolution?.reason], ["resolved", "no_overlap"]);
      assert.deepEqual(res.resolution?.evidence.assets.find((a) => a.assetId === "AST-1")?.kpiIds, ["KPI-001"]);
      assert.equal(res.resolution?.evidence.verdict, null);
    });

    await resetLifecycle(db, 0);
    const g = await openFinding();
    assert.notEqual(g.findingId, f.findingId);
    await withAst1Kpis(["KPI-004", "KPI-005"], async () => {
      const r = await periodic();
      const res = r.summary!.reassessment!.results[0];
      assert.deepEqual([res.outcome, res.resolution?.reason, res.resolution?.evidence.verdict], ["resolved", "verdict_changed", "partial"]);
      assert.match(res.reason, /partial/);
      const stored = (await getFinding(db, g.findingId))!;
      assert.deepEqual([stored.status, stored.resolution?.reason], ["resolved", "verdict_changed"]);
      assert.match(stored.resolution!.evidence.suggestionReason!, /lacks KPI-005/);
    });
  });

  it("a side that cannot be compared is indeterminate and left as it was", async () => {
    const f = await openFinding();
    await withAst1Kpis([], async () => {
      const r = await periodic();
      assert.equal(r.summary!.reassessment!.counts.indeterminate, 1);
      const after = (await getFinding(db, f.findingId))!;
      assert.deepEqual([after.status, after.observations, after.lastSeen.runId], ["open", 1, f.lastSeen.runId]);
    });
  });

  it("repeated runs are idempotent: the second run changes nothing material and writes no audit rows", async () => {
    await openFinding();
    await archiveAst1();
    await periodic();
    const snap = async () => (await listFindings(db, { status: "any" })).findings.map((x) => ({ ...x, lastSeen: null, observations: null }));
    const before = await snap();
    const mark = await maxAuditId();
    const again = await periodic();
    assert.equal(again.status, "succeeded");
    assert.deepEqual(again.summary!.reassessment!.scope, { open: 0, dismissed: 0 }, "a resolved finding is not reassessed");
    assert.deepEqual(await snap(), before);
    assert.deepEqual(await auditSince(mark), []);
    assert.equal(again.window.fromAuditId, (await listRuns(db, { jobId: "periodic_reassessment", limit: 2 }))[1].window.toAuditId);

    // Open + unchanged: a second run on the same estate rewrites the same evidence; only last seen / count move.
    await resetLifecycle(db, 0);
    const f = await openFinding();
    await periodic();
    const e2 = (await getFinding(db, f.findingId))!.evidence;
    const m2 = await maxAuditId();
    const third = await periodic();
    assert.equal(third.summary!.reassessment!.counts.unchanged, 1);
    const g = (await getFinding(db, f.findingId))!;
    assert.deepEqual([g.status, g.fingerprint, g.evidence], ["open", f.fingerprint, e2]);
    assert.deepEqual(await auditSince(m2), []);
  });
});

describe("dismissed findings", () => {
  it("same evidence => stays dismissed (suppressed), no audit", async () => {
    const f = await openFinding();
    await dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "Known overlap." });
    const mark = await maxAuditId();
    const r = await periodic();
    assert.equal(r.summary!.reassessment!.counts.suppressed, 1);
    const after = (await getFinding(db, f.findingId))!;
    assert.deepEqual([after.status, after.dismissal?.reason, after.observations], ["dismissed", "Known overlap.", 2]);
    assert.deepEqual(await auditSince(mark), []);
  });

  it("changed evidence => reopened (audited)", async () => {
    const f = await openFinding();
    await dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "Temporary one-off." });
    await recordUsage(db, { assetId: INSIGHT, userId: "OWN-R" }, DAY); // promoted to Personal
    const mark = await maxAuditId();
    const r = await periodic();
    assert.equal(r.summary!.reassessment!.counts.reopened, 1);
    const after = (await getFinding(db, f.findingId))!;
    assert.deepEqual([after.status, after.dismissal], ["open", null]);
    assert.deepEqual((await auditSince(mark)).map((a) => a.action), ["scheduler_finding_reopened"]);
  });

  it("overlap gone => resolved, keeping the dismissal; overlap back on the dismissed evidence => dismissed again (audited)", async () => {
    const f = await openFinding();
    await dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "Known overlap." });
    await archiveAst1();
    const r = await periodic();
    assert.equal(r.summary!.reassessment!.results[0].fromStatus, "dismissed");
    const resolved = (await getFinding(db, f.findingId))!;
    assert.deepEqual([resolved.status, resolved.resolution?.fromStatus, resolved.dismissal?.reason], ["resolved", "dismissed", "Known overlap."]);

    await restore(db, { assetId: "AST-1", actor: "OWN-1" }, DAY); // a watched change: the incremental run sees the overlap again
    const mark = await maxAuditId();
    const inc = await runIncremental(db, { actor: "manager" });
    assert.equal(inc.summary!.findings.suppressed, 1);
    const back = (await getFinding(db, f.findingId))!;
    assert.deepEqual([back.status, back.resolution, back.dismissal?.reason], ["dismissed", null, "Known overlap."]);
    assert.deepEqual((await auditSince(mark)).map((a) => a.action), ["scheduler_finding_recurred"]);
  });

  it("a resolved open finding reopens (audited) when an incremental run sees the overlap again", async () => {
    const f = await openFinding();
    await archiveAst1();
    await periodic();
    await restore(db, { assetId: "AST-1", actor: "OWN-1" }, DAY);
    const mark = await maxAuditId();
    const inc = await runIncremental(db, { actor: "manager" });
    assert.equal(inc.summary!.findings.reopened, 1);
    const back = (await getFinding(db, f.findingId))!;
    assert.deepEqual([back.status, back.resolution, back.dismissal], ["open", null, null]);
    assert.deepEqual((await auditSince(mark)).map((a) => a.action), ["scheduler_finding_reopened"]);
    assert.equal((await listFindings(db)).total, 1, "same row, no duplicate");
  });
});

describe("current evidence vs dismissal evidence (Codex B2-F2)", () => {
  type Tweak = (s: MergeSuggestion) => MergeSuggestion;
  /** suggestMerge, with each suggestion passed through `tweak` (non-material edits only). */
  const tweaked = (tweak: Tweak): Comparator => async (d, input, date) => {
    const r = await suggestMerge(d, input, date);
    return { ...r, suggestions: r.suggestions.map(tweak) };
  };
  const swap: Tweak = (s) => ({ ...s, mergeAway: s.keep, keep: s.mergeAway });
  const describeAnew: Tweak = (s) => ({ ...s, reason: `${s.reason} (reworded)`, keep: { ...s.keep, name: `${s.keep.name} (renamed)` } });
  /** Usage counters through the app: one more open by a non-owner (no tier change, nothing audited as a watched change). */
  const moreUsage = async () => void (await recordUsage(db, { assetId: INSIGHT, userId: "OWN-T" }, DAY));
  const cases: { name: string; setup?: () => Promise<void>; compare?: Comparator; check: (e: Finding["evidence"]) => void }[] = [
    { name: "usage counters", setup: moreUsage, check: (e) => assert.equal(sideOf({ evidence: e } as Finding, INSIGHT).appOpens90d, 1) },
    { name: "comparator direction", compare: tweaked(swap), check: (e) => assert.equal(e.keep.assetId, "AST-1") },
    { name: "descriptive evidence", compare: tweaked(describeAnew), check: (e) => assert.match(e.reason, /\(reworded\)$/) },
  ];

  for (const c of cases) {
    it(`open finding: ${c.name} changed => current evidence refreshed, still open, same fingerprint`, async () => {
      const f = await openFinding();
      assert.equal(f.evidence.keep.assetId, INSIGHT, "fixture: the insight is the kept side");
      await c.setup?.();
      const mark = await maxAuditId();
      const r = await periodic(c.compare);
      assert.equal(r.summary!.reassessment!.counts.unchanged, 1);
      const after = (await getFinding(db, f.findingId))!;
      assert.deepEqual([after.status, after.fingerprint, after.lastSeen.runId], ["open", f.fingerprint, r.runId]);
      assert.notDeepEqual(after.evidence, f.evidence);
      c.check(after.evidence);
      assert.deepEqual(await auditSince(mark), []);
    });

    it(`dismissed finding: ${c.name} changed => stays dismissed, dismissal evidence kept, current evidence refreshed`, async () => {
      const f = await openFinding();
      const d = await dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "Known overlap." });
      assert.deepEqual(d.dismissal?.evidence, f.evidence, "dismissal records the evidence it was based on");
      await c.setup?.();
      const mark = await maxAuditId();
      const r = await periodic(c.compare);
      assert.equal(r.summary!.reassessment!.counts.suppressed, 1);
      const after = (await getFinding(db, f.findingId))!;
      assert.deepEqual([after.status, after.fingerprint, after.dismissal?.reason, after.dismissal?.fingerprint], ["dismissed", f.fingerprint, "Known overlap.", f.fingerprint]);
      assert.deepEqual(after.dismissal?.evidence, f.evidence, "dismissal basis preserved");
      c.check(after.evidence);
      assert.deepEqual(await auditSince(mark), [], "not reopened, nothing audited");

      // A material change still reopens per the existing rules, and clears the dismissal with its evidence.
      await recordUsage(db, { assetId: INSIGHT, userId: "OWN-R" }, DAY); // promoted to Personal
      const again = await periodic(c.compare);
      assert.equal(again.summary!.reassessment!.counts.reopened, 1);
      const reopened = (await getFinding(db, f.findingId))!;
      assert.deepEqual([reopened.status, reopened.dismissal], ["open", null]);
      assert.equal(sideOf(reopened, INSIGHT).tier, "personal");
      assert.equal((await db.execute({ sql: `SELECT dismissed_evidence FROM scheduler_findings WHERE finding_id = ?`, args: [f.findingId] })).rows[0].dismissed_evidence, null);
    });
  }

  it("an incremental re-observation of a dismissed finding also refreshes current evidence and keeps the dismissal basis", async () => {
    const f = await openFinding();
    await dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "Known overlap." });
    await moreUsage();
    // A watched audit row for the insight with no material change (the audit log only refuses updates and deletes).
    await db.execute({
      sql: `INSERT INTO audit_log (sim_date, actor, action, asset_id, policy_version, rationale, evidence, created_at)
            VALUES (?, 'fixture', 'promoted', ?, 'fixture', 'Fixture: watched change without a material change.', '{}', ?)`,
      args: [DAY, INSIGHT, new Date().toISOString()],
    });
    const inc = await runIncremental(db, { actor: "manager", compare: tweaked(describeAnew) });
    assert.deepEqual([inc.summary!.findings.suppressed, inc.summary!.findings.reopened], [1, 0]);
    const after = (await getFinding(db, f.findingId))!;
    assert.deepEqual([after.status, after.fingerprint, after.dismissal?.evidence], ["dismissed", f.fingerprint, f.evidence]);
    assert.equal(sideOf(after, INSIGHT).appOpens90d, 1);
    assert.match(after.evidence.reason, /\(reworded\)$/);
    assert.equal(after.evidence.triggers[0]?.action, "promoted");
  });
});

describe("stale proposal evidence (read-only)", () => {
  it("reports pending proposals on changed findings without touching proposals or decisions", async () => {
    const f = await openFinding();
    const merge = await proposeMerge(db, { sourceId: "AST-1", targetId: INSIGHT }, DAY);
    const retire = await proposeRetire(db, { assetId: INSIGHT, reason: "Fixture: pending retire." }, DAY);
    const before = await snapLifecycle();
    const pending = await listPendingProposals(db);
    await withAst1Kpis(["KPI-004", "KPI-005"], async () => {
      const r = await periodic();
      const stale = r.summary!.reassessment!.staleProposals;
      const byId = Object.fromEntries(stale.map((s) => [s.proposalId, s]));
      assert.deepEqual([byId[merge.id]?.relation, byId[merge.id]?.findingOutcome, byId[merge.id]?.findingId], ["same_pair", "resolved", f.findingId]);
      assert.deepEqual([byId[retire.id]?.relation, byId[retire.id]?.type], ["shares_asset", "retire"]);
    });
    assert.deepEqual(await snapLifecycle(), before, "proposals and decisions untouched");
    assert.deepEqual(await listPendingProposals(db), pending);
  });

  it("an unchanged finding reports no stale proposal", async () => {
    await openFinding();
    await proposeRetire(db, { assetId: "AST-1", reason: "Fixture: pending retire." }, DAY);
    const r = await periodic();
    assert.deepEqual(r.summary!.reassessment!.staleProposals, []);
  });
});

describe("failure and concurrency", () => {
  it("a failure mid-commit rolls back every finding change; the run is failed; a retry succeeds", async () => {
    const f = await openFinding();
    await archiveAst1();
    await ensureScheduler(db);
    // Fires after the finding UPDATE inside the commit transaction.
    await db.execute(`CREATE TRIGGER test_fail_resolve_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'scheduler_finding_resolved'
                      BEGIN SELECT RAISE(ABORT, 'injected: resolve audit failed'); END`);
    let failed;
    try {
      failed = await periodic();
    } finally {
      await db.execute(`DROP TRIGGER IF EXISTS test_fail_resolve_audit`);
    }
    assert.deepEqual([failed.status, failed.error?.code, failed.error?.stage, failed.summary], ["failed", "commit_failed", "commit", null]);
    assert.match(failed.error!.message, /injected/);
    const still = (await getFinding(db, f.findingId))!;
    assert.deepEqual([still.status, still.resolution], ["open", null]);
    assert.equal((await db.execute(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'scheduler_finding_resolved'`)).rows[0].n, 0);
    const retry = await periodic();
    assert.deepEqual([retry.status, retry.summary!.reassessment!.counts.resolved], ["succeeded", 1]);
    assert.equal(retry.window.fromAuditId, 0, "the failed run is not a previous success");
  });

  it("an evaluation failure is recorded and changes nothing", async () => {
    const f = await openFinding();
    const r = await periodic(async () => {
      throw new Error("estate read failed");
    });
    assert.deepEqual([r.status, r.error?.code], ["failed", "evaluation_failed"]);
    assert.deepEqual(await getFinding(db, f.findingId), f);
  });

  it("finding-writing jobs never run concurrently: a held periodic run blocks both jobs (Codex B2-F1)", async () => {
    await buildInsight();
    const held = await claimRun(db, { jobId: "periodic_reassessment", mode: "reassessment", trigger: "manual", actor: "manager", rules: PERIODIC_JOB.rules });
    const blocked = (e: unknown) => e instanceof SchedulerError && e.code === "conflict" && e.detail?.runningRunId === held.runId;
    await assert.rejects(periodic(), blocked);
    await assert.rejects(runIncremental(db, { actor: "manager" }), blocked);
    assert.deepEqual(await countRuns(db, "incremental_overlap"), { running: 0, succeeded: 0, failed: 0, total: 0 }, "refused claims leave no run");
    assert.deepEqual(await countRuns(db, "periodic_reassessment"), { running: 1, succeeded: 0, failed: 0, total: 1 });
  });

  it("B2-F1 ordering: incremental claimed, subject archived, periodic refused; abandoning the incremental run releases the claim", async () => {
    const f = await openFinding();
    await recordUsage(db, { assetId: INSIGHT, userId: "OWN-R" }, DAY); // promoted: a watched change for the next incremental run
    const held = await claimRun(db, { jobId: "incremental_overlap", mode: "incremental", trigger: "manual", actor: "manager", rules: INCREMENTAL_JOB.rules });
    await archiveAst1();
    await assert.rejects(
      runJob(db, { jobId: "periodic_reassessment", actor: "manager" }),
      (e: unknown) =>
        e instanceof SchedulerError && e.code === "conflict" && e.detail?.runningRunId === held.runId && e.detail?.runningJobId === "incremental_overlap",
    );
    assert.equal((await getFinding(db, f.findingId))!.status, "open", "nothing resolved while the incremental run holds the claim");

    await abandonRun(db, { runId: held.runId, actor: "manager", reason: "Fixture: crashed." });
    const r = await periodic();
    assert.deepEqual([r.status, r.summary!.reassessment!.counts.resolved], ["succeeded", 1]);
    await assert.rejects(
      commitRun(db, held, async () => ({ ...r.summary!, findings: { created: 0, updated: 0, unchanged: 0, reopened: 0, suppressed: 0 } })),
      (e: unknown) => e instanceof SchedulerError && e.code === "conflict",
      "the abandoned run's late commit is refused",
    );
    assert.equal((await getFinding(db, f.findingId))!.status, "resolved");
  });

  it("B2-F1 ordering end to end: the older incremental run commits first; the periodic run then resolves, and nothing reopens it", async () => {
    const f = await openFinding();
    await recordUsage(db, { assetId: INSIGHT, userId: "OWN-R" }, DAY); // promoted: the incremental run evaluates the overlap again
    let refused: unknown;
    const inc = await runIncremental(db, {
      actor: "manager",
      // Evaluated (overlap still active); now the subject is archived and a periodic run is attempted before this run commits.
      beforeCommit: async () => {
        await archiveAst1();
        refused = await periodic().then(() => undefined, (e: unknown) => e);
      },
    });
    assert.ok(refused instanceof SchedulerError && refused.code === "conflict" && refused.detail?.runningRunId === inc.runId, "periodic refused while incremental holds the claim");
    assert.deepEqual([inc.status, inc.summary!.findings.updated], ["succeeded", 1]);
    assert.deepEqual(await countRuns(db, "periodic_reassessment"), { running: 0, succeeded: 0, failed: 0, total: 0 });

    const r = await periodic();
    assert.equal(r.summary!.reassessment!.counts.resolved, 1);
    const again = await runIncremental(db, { actor: "manager" });
    assert.equal(again.summary!.findings.reopened, 0);
    const now = (await getFinding(db, f.findingId))!;
    assert.deepEqual([now.status, now.resolution?.reason], ["resolved", "asset_inactive"], "no stale reopen");
  });

  it("the database itself refuses a second running finding writer, and the claim error is a conflict (409), not a 500", async () => {
    await ensureScheduler(db);
    const held = await claimRun(db, { jobId: "incremental_overlap", mode: "incremental", trigger: "manual", actor: "manager", rules: INCREMENTAL_JOB.rules });
    const insert = (jobId: string) =>
      db.execute({
        sql: `INSERT INTO scheduler_runs (run_id, job_id, mode, trigger, actor, sim_date, status, started_at, from_audit_id, to_audit_id, rules, policy_version)
              VALUES (?, ?, 'reassessment', 'manual', 'manager', '2026-11-03', 'running', 't', 0, 0, '[]', 'p')`,
        args: [`SCH-raw-${jobId}`, jobId],
      });
    let raw: unknown;
    await insert("periodic_reassessment").catch((e: unknown) => (raw = e));
    assert.match(String(raw), /UNIQUE constraint failed/);
    const mapped = claimConflict(raw);
    assert.ok(mapped instanceof SchedulerError && mapped.code === "conflict");
    assert.equal(claimConflict(new Error("disk I/O error")), null);
    await abandonRun(db, { runId: held.runId, actor: "manager", reason: "Fixture." });
    await insert("periodic_reassessment"); // released
  });

  it("upgrade: a database with concurrent running finding writers gets the index; all but the oldest are abandoned", async () => {
    await ensureScheduler(db);
    await db.execute(`DROP INDEX scheduler_runs_one_finding_writer`);
    for (const [id, job, at] of [["SCH-a", "incremental_overlap", "2026-11-01T00:00:00Z"], ["SCH-b", "periodic_reassessment", "2026-11-02T00:00:00Z"]]) {
      await db.execute({
        sql: `INSERT INTO scheduler_runs (run_id, job_id, mode, trigger, actor, sim_date, status, started_at, from_audit_id, to_audit_id, rules, policy_version)
              VALUES (?, ?, 'incremental', 'manual', 'manager', '2026-11-03', 'running', ?, 0, 0, '[]', 'p')`,
        args: [id, job, at],
      });
    }
    await ensureScheduler(db);
    assert.equal((await db.execute(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'scheduler_runs_one_finding_writer'`)).rows[0].n, 1);
    const [a, b] = await Promise.all([getRun(db, "SCH-a"), getRun(db, "SCH-b")]);
    assert.deepEqual([a?.status, b?.status, b?.error?.code], ["running", "failed", "abandoned"]);
    await ensureScheduler(db); // idempotent
    assert.equal((await getRun(db, "SCH-a"))?.status, "running");
  });

  it("a finding changed between evaluation and commit is skipped, not overwritten", async () => {
    const f = await openFinding();
    await archiveAst1();
    const r = await runReassessment(db, {
      actor: "manager",
      beforeCommit: async () => void (await dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "Dismissed meanwhile." })),
    });
    assert.equal(r.summary!.reassessment!.counts.skipped, 1);
    const after = (await getFinding(db, f.findingId))!;
    assert.deepEqual([after.status, after.resolution, after.dismissal?.reason], ["dismissed", null, "Dismissed meanwhile."]);
  });
});

describe("schema migration from B1", () => {
  it("rebuilds a B1 findings table (old status CHECK) keeping its rows; then resolved is accepted", async () => {
    await ensureScheduler(db);
    await db.execute(`DROP TABLE scheduler_findings`);
    await db.execute(B1_FINDINGS_DDL);
    await db.execute(`INSERT INTO scheduler_findings (finding_id, dedup_key, rule_id, rule_version, asset_ids, status, evidence, fingerprint,
                        first_seen_at, first_seen_sim_date, first_run_id, last_seen_at, last_seen_sim_date, last_run_id, observations,
                        dismissed_by, dismissed_reason, dismissed_at, dismissed_sim_date, dismissed_fingerprint, proposal_id)
                      VALUES ('FND-old', 'active_overlap:A|B', 'active_overlap', 'overlap-v2', '["A","B"]', 'dismissed', '{}', 'fp',
                        't', '2026-11-01', 'SCH-1', 't', '2026-11-01', 'SCH-1', 3, 'manager', 'why', 't', '2026-11-01', 'fp', 'PRP-1')`);
    await assert.rejects(db.execute(`UPDATE scheduler_findings SET status = 'resolved'`), /CHECK constraint/);

    await ensureScheduler(db);
    const sql = (await db.execute(`SELECT sql FROM sqlite_master WHERE name = 'scheduler_findings'`)).rows[0].sql as string;
    assert.match(sql, /'resolved', 'superseded'/);
    assert.match(sql, /resolution TEXT/);
    const f = (await getFinding(db, "FND-old"))!;
    assert.deepEqual([f.status, f.observations, f.dismissal?.reason, f.proposalId, f.resolution], ["dismissed", 3, "why", "PRP-1", null]);
    assert.deepEqual(f.dismissal?.evidence, {}, "B2-F2 backfill: a dismissed row's stored evidence is what it was dismissed on");
    await db.execute(`UPDATE scheduler_findings SET status = 'resolved' WHERE finding_id = 'FND-old'`);
    await assert.rejects(db.execute(`UPDATE scheduler_findings SET status = 'bogus'`), /CHECK constraint/);
    assert.equal((await db.execute(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'scheduler_findings_b2'`)).rows[0].n, 0);
    // Idempotent: nothing to do on the next call.
    await ensureScheduler(db);
    assert.equal((await getFinding(db, "FND-old"))?.status, "resolved");
  });
});

describe("schema migration from B2 (before B2-F2)", () => {
  it("adds dismissed_evidence, backfills it for rows with a dismissal only, keeps every row; idempotent", async () => {
    const f = await openFinding();
    await dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "Known overlap." });
    await db.execute(`INSERT INTO scheduler_findings (finding_id, dedup_key, rule_id, rule_version, asset_ids, status, evidence, fingerprint,
                        first_seen_at, first_seen_sim_date, first_run_id, last_seen_at, last_seen_sim_date, last_run_id, observations)
                      SELECT 'FND-open', 'active_overlap:X|Y', rule_id, rule_version, '["X","Y"]', 'open', evidence, fingerprint,
                        first_seen_at, first_seen_sim_date, first_run_id, last_seen_at, last_seen_sim_date, last_run_id, 1 FROM scheduler_findings`);
    // Recreate the table as B2 shipped it (no dismissed_evidence), keeping the rows.
    const current = (await db.execute(`SELECT sql FROM sqlite_master WHERE name = 'scheduler_findings'`)).rows[0].sql as string;
    const b2 = current.replace(/,\s*dismissed_evidence TEXT/, "").replace("scheduler_findings", "scheduler_findings_pre");
    assert.doesNotMatch(b2, /dismissed_evidence/);
    await db.execute(b2);
    const cols = (await db.execute(`SELECT name FROM pragma_table_info('scheduler_findings_pre')`)).rows.map((r) => r.name as string).join(", ");
    await db.execute(`INSERT INTO scheduler_findings_pre (${cols}) SELECT ${cols} FROM scheduler_findings`);
    await db.execute(`DROP TABLE scheduler_findings`);
    await db.execute(`ALTER TABLE scheduler_findings_pre RENAME TO scheduler_findings`);

    await ensureScheduler(db);
    const sql = (await db.execute(`SELECT sql FROM sqlite_master WHERE name = 'scheduler_findings'`)).rows[0].sql as string;
    assert.match(sql, /dismissed_evidence TEXT/);
    const dismissed = (await getFinding(db, f.findingId))!;
    assert.deepEqual([dismissed.status, dismissed.dismissal?.reason, dismissed.dismissal?.evidence], ["dismissed", "Known overlap.", f.evidence]);
    assert.deepEqual([(await getFinding(db, "FND-open"))?.status, (await getFinding(db, "FND-open"))?.dismissal], ["open", null]);
    await ensureScheduler(db);
    assert.deepEqual((await getFinding(db, f.findingId))!.dismissal?.evidence, f.evidence);
  });
});

describe("jobs, overview, due check and reset", () => {
  it("job IDs are validated (route contract): default incremental, unknown rejected", async () => {
    assert.equal(parseJobId(undefined), "incremental_overlap");
    assert.equal(parseJobId(""), "incremental_overlap");
    assert.equal(parseJobId("periodic_reassessment"), "periodic_reassessment");
    assert.equal(parseJobFilter(null), undefined, "GET: no filter");
    assert.equal(parseJobFilter("periodic_reassessment"), "periodic_reassessment");
    for (const bad of ["nope", 7, {}]) {
      assert.throws(() => parseJobId(bad), (e: unknown) => e instanceof SchedulerError && e.code === "invalid");
      assert.throws(() => parseJobFilter(bad), (e: unknown) => e instanceof SchedulerError && e.code === "invalid");
    }
    const r = await runJob(db, { jobId: "periodic_reassessment", actor: "manager" });
    assert.equal(r.jobId, "periodic_reassessment");
    assert.deepEqual((await listRuns(db, { jobId: "periodic_reassessment" })).map((x) => x.runId), [r.runId]);
    assert.deepEqual(await listRuns(db, { jobId: "incremental_overlap" }), []);
  });

  it("overview lists both jobs; the periodic one has no checkpoint; finding counts include resolved", async () => {
    await openFinding();
    await archiveAst1();
    const r = await periodic();
    const o = await schedulerOverview(db);
    assert.deepEqual(o.jobs.map((j) => j.job.jobId), ["incremental_overlap", "periodic_reassessment"]);
    const p = o.jobs[1];
    assert.deepEqual([p.checkpoint, p.pendingAuditRows, p.runs.succeeded, p.latestRun?.runId, p.running], [null, 0, 1, r.runId, null]);
    assert.ok(o.jobs[0].checkpoint);
    assert.deepEqual(o.findings, { open: 0, dismissed: 0, resolved: 1, superseded: 0 });
    assert.deepEqual((await listFindings(db, { status: "resolved" })).total, 1);
  });

  it("reassessmentDue is pure, depends only on observable state, and has no cadence", async () => {
    const base = { simDate: "2026-11-05", lastSucceededSimDate: "2026-11-04", reassessableFindings: 2, running: false };
    assert.equal(reassessmentDue(base).due, true);
    assert.equal(reassessmentDue({ ...base, lastSucceededSimDate: null }).due, true);
    assert.equal(reassessmentDue({ ...base, lastSucceededSimDate: "2026-11-05" }).due, false);
    assert.equal(reassessmentDue({ ...base, reassessableFindings: 0 }).due, false);
    assert.equal(reassessmentDue({ ...base, running: true }).due, false);

    await openFinding();
    assert.equal(reassessmentDue(await readReassessmentDueState(db)).due, true);
    await periodic();
    const s = await readReassessmentDueState(db);
    assert.deepEqual([s.lastSucceededSimDate, reassessmentDue(s).due], [s.simDate, false]);
    await db.execute(`UPDATE app_clock SET sim_date = '2026-11-02'`); // the stored date moved (test setup; the scheduler never ticks)
    assert.equal(reassessmentDue(await readReassessmentDueState(db)).due, true);
  });

  it("demo reset drops periodic runs and resolved findings with everything else", async () => {
    await openFinding();
    await archiveAst1();
    await periodic();
    await resetLifecycle(db, 0);
    const tables = await db.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'scheduler_%'`);
    assert.deepEqual(tables.rows, [], `reset drops ${SCHEDULER_TABLES.join(", ")}`);
    const o = await schedulerOverview(db);
    assert.deepEqual(o.jobs.map((j) => j.runs.total), [0, 0]);
    assert.deepEqual(o.findings, { open: 0, dismissed: 0, resolved: 0, superseded: 0 });
    const r = await periodic();
    assert.deepEqual([r.window.fromAuditId, r.summary!.reassessment!.scope], [0, { open: 0, dismissed: 0 }]);
  });
});

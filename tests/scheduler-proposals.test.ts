// T24 (B3): finding -> governed merge proposal. Same team-authored fixture as
// tests/scheduler.test.ts (not Bayer data), in its own disposable database:
// AST-1 Alphazol EMEA (KPI-004, OWN-1, certified); AST-2 Betavex US (KPI-001,
// OWN-R, certified) covered by AST-3 Betavex Global (KPI-001, OWN-1,
// certified) and by AST-4 (Global, six KPIs, OWN-S). REQ-S01 builds a
// Temporary insight (owner OWN-R, KPI-004 + KPI-042) that covers AST-1.
//
// Tests call the service directly; the HTTP POST is switched off until B0
// (FINDING_PROPOSALS_ENABLED) and is only checked to refuse. No LLM, no network.
//
// B0 dependency: nothing here asserts behaviour that B0 changes. Rejecting
// another proposal on an asset archived by an approved merge (the pre-B0
// "reject reactivates" path) is deliberately not exercised; the raise refuses
// while either asset has another open proposal, but a proposal opened on an
// asset after the raise (a lease review, a retire on the kept side) is only
// made safe by B0.
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook, type ParsedSheet } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { decideBuild, proposeBuild } from "../src/services/build";
import { proposeMerge, suggestMerge } from "../src/services/estate";
import { decide, listPendingProposals, proposeRetire, readClock, resetLifecycle, restore } from "../src/services/lifecycle";
import {
  FINDING_PROPOSALS_ENABLED,
  SchedulerError,
  dismissFinding,
  getFinding,
  listFindingProposals,
  listFindings,
  previewFindingProposal,
  raiseFindingProposal,
  runIncremental,
  syncFindingProposals,
  type Comparator,
  type Finding,
} from "../src/services/scheduler";
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

const dir = mkdtempSync(join(tmpdir(), "scheduler-proposals-test-"));
const DB_PATH = join(dir, "proposals.db");
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

const run = (compare?: Comparator) => runIncremental(db, { actor: "manager", compare });
const today = async () => (await readClock(db)).date;

async function retireAndRestore(assetId: string, owner: string, date = DAY) {
  const p = await proposeRetire(db, { assetId, reason: "Fixture: retire then restore." }, date);
  await decide(db, { proposalId: p.id, actor: owner, action: "approve" }, date);
  await restore(db, { assetId, actor: owner }, date);
}

/** Open finding AST-2 (US) / AST-3 (Global): merging AST-2 into AST-3 is the only valid direction. */
async function betavexFinding(): Promise<Finding> {
  await retireAndRestore("AST-2", "OWN-R");
  await run();
  const f = (await listFindings(db, { status: "open", assetId: "AST-2" })).findings;
  assert.deepEqual(f.map((x) => x.assetIds), [["AST-2", "AST-3"]]);
  return f[0];
}

/** Open finding AST-1 (certified) / Temporary insight; the comparator prefers keeping the insight. */
async function insightFinding(): Promise<Finding> {
  const r = await proposeBuild(db, { requestId: "REQ-S01", requesterId: "OWN-R" }, DAY);
  assert.equal(r.status, "proposed");
  await decideBuild(db, { proposalId: (r as { proposal: { id: string } }).proposal.id, actor: "OWN-1", action: "approve" }, DAY);
  await run();
  return (await listFindings(db, { status: "open" })).findings[0];
}

const raise = (f: Finding, over: Partial<Parameters<typeof raiseFindingProposal>[1]> = {}, c: Client = db, compare?: Comparator) =>
  raiseFindingProposal(
    c,
    { findingId: f.findingId, actor: "manager", action: "merge", sourceId: "AST-2", targetId: "AST-3", expectedFingerprint: f.fingerprint, ...over },
    { compare },
  );

const count = async (sql: string) => Number((await db.execute(sql)).rows[0].n);
const mergeProposals = () => count(`SELECT COUNT(*) AS n FROM proposals WHERE type = 'merge'`);
const links = () => count(`SELECT COUNT(*) AS n FROM scheduler_finding_proposals`);

/** Refused with a conflict whose reasons include `code`; nothing written. */
async function refused(p: Promise<unknown>, code: string) {
  const [proposals, linkRows] = [await mergeProposals(), await links()];
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof SchedulerError, String(e));
    assert.equal(e.code, "conflict");
    const reasons = (e.detail?.reasons ?? []) as { code: string }[];
    assert.ok(reasons.some((r) => r.code === code), `expected ${code}, got ${JSON.stringify(reasons)}`);
    return true;
  });
  assert.deepEqual([await mergeProposals(), await links()], [proposals, linkRows]);
}

/** AST-3 maps one more KPI (simulated: imported mappings are read-only at runtime). Material: changes the fingerprint. */
const ast3GainsKpi: Comparator = async (d, input, date) => {
  const r = await suggestMerge(d, input, date);
  for (const s of r.suggestions) for (const side of [s.mergeAway, s.keep]) if (side.assetId === "AST-3") side.kpiIds = [...side.kpiIds, "KPI-005"];
  return r;
};

describe("raising a proposal from a finding", () => {
  it("creates the merge through proposeMerge with both owners as approvers; link, snapshot, linkage and audit persisted", async () => {
    const f = await betavexFinding();
    const pv = await previewFindingProposal(db, { findingId: f.findingId });
    assert.deepEqual([pv.eligible, pv.enabled, pv.blockedBy, pv.reasons, pv.link], [true, false, "B0", [], null]);
    assert.equal(pv.currentFingerprint, f.fingerprint);
    assert.deepEqual(
      pv.directions.map((d) => [d.sourceId, d.targetId, d.allowed, d.reasons.map((r) => r.code)]),
      [
        ["AST-2", "AST-3", true, []],
        ["AST-3", "AST-2", false, ["target_does_not_cover_scope"]],
      ],
    );

    const date = await today();
    const r = await raise(f);
    assert.equal(r.created, true);
    assert.equal(r.proposal.id, `PRP-MERGE-AST-2-INTO-AST-3-${date}`);
    assert.deepEqual([r.proposal.type, r.proposal.status, r.proposal.assetIds], ["merge", "open", ["AST-2"]]);
    assert.deepEqual(r.proposal.requiredApprovers, ["OWN-R", "OWN-1"], "both owners must approve");
    assert.ok((await listPendingProposals(db)).some((p) => p.id === r.proposal.id), "waits in the Inbox");

    assert.deepEqual(
      [r.link.findingId, r.link.proposalId, r.link.action, r.link.sourceId, r.link.targetId, r.link.actor, r.link.simDate, r.link.outcome],
      [f.findingId, r.proposal.id, "merge", "AST-2", "AST-3", "manager", date, "pending"],
    );
    assert.equal(r.link.fingerprint, f.fingerprint);
    assert.deepEqual(r.link.evidence.basis, f.evidence.basis);
    assert.deepEqual(r.link.evidence.sharedKpis, ["KPI-001"]);
    assert.equal((await getFinding(db, f.findingId))?.proposalId, r.proposal.id);
    assert.equal((await getFinding(db, f.findingId))?.status, "open", "the finding status is unchanged (C1)");

    const audit = await db.execute({ sql: `SELECT actor, action, evidence FROM audit_log WHERE proposal_id = ? ORDER BY id`, args: [r.proposal.id] });
    assert.deepEqual(audit.rows.map((x) => [x.actor, x.action]), [
      ["manager", "merge_proposed"],
      ["manager", "scheduler_finding_proposal_raised"],
    ]);
    const ev = JSON.parse(audit.rows[1].evidence as string);
    assert.deepEqual([ev.findingId, ev.linkId, ev.fingerprint, ev.chosen], [f.findingId, r.link.linkId, f.fingerprint, { sourceId: "AST-2", targetId: "AST-3" }]);

    // The scheduler ignores its own audit row; the merge_proposed row is not a watched change.
    const next = await run();
    assert.equal(next.summary!.assessments.length, 0);
  });

  it("refuses a stale client fingerprint and evidence that changed since the run", async () => {
    const f = await betavexFinding();
    await refused(raise(f, { expectedFingerprint: "0".repeat(64) }), "stale_client");
    await assert.rejects(raise(f, {}, db, ast3GainsKpi), (e: unknown) => e instanceof SchedulerError && e.detail?.stale === true);
    await refused(raise(f, {}, db, ast3GainsKpi), "stale_evidence");
    const pv = await previewFindingProposal(db, { findingId: f.findingId }, { compare: ast3GainsKpi });
    assert.equal(pv.eligible, false);
    assert.notEqual(pv.currentFingerprint, f.fingerprint);
  });

  it("refuses a finding that is not open", async () => {
    const f = await betavexFinding();
    await dismissFinding(db, { findingId: f.findingId, actor: "manager", reason: "Known overlap." });
    await refused(raise(f), "finding_not_open");
    assert.equal((await previewFindingProposal(db, { findingId: f.findingId })).eligible, false);
    await assert.rejects(raise({ ...f, findingId: "FND-missing" }), (e: unknown) => e instanceof SchedulerError && e.code === "not_found");
  });

  it("validates the manager's direction and input", async () => {
    const f = await betavexFinding();
    await refused(raise(f, { sourceId: "AST-3", targetId: "AST-2" }), "target_does_not_cover_scope");
    await refused(raise(f, { sourceId: "AST-2", targetId: "AST-4" }), "direction_not_in_finding");
    await assert.rejects(raise(f, { action: "retire" as never }), (e: unknown) => e instanceof SchedulerError && e.code === "invalid");
    await assert.rejects(raise(f, { sourceId: " " }), (e: unknown) => e instanceof SchedulerError && e.code === "invalid");
    await assert.rejects(raise(f, { expectedFingerprint: "" }), (e: unknown) => e instanceof SchedulerError && e.code === "invalid");
    const pv = await previewFindingProposal(db, { findingId: f.findingId, sourceId: "ast-3", targetId: "ast-2" });
    assert.deepEqual([pv.eligible, pv.reasons.map((r) => r.code)], [false, ["target_does_not_cover_scope"]]);
    assert.equal(await mergeProposals(), 0);
  });

  it("never lets a Temporary insight replace a certified asset, even in the comparator's preferred direction", async () => {
    const f = await insightFinding();
    assert.deepEqual([f.evidence.mergeAway.assetId, f.evidence.keep.assetId], ["AST-1", INSIGHT], "comparator prefers keeping the insight");
    await refused(raise(f, { sourceId: "AST-1", targetId: INSIGHT }), "temporary_over_certified");
    await refused(raise(f, { sourceId: INSIGHT, targetId: "AST-1" }), "target_lacks_kpis");
    const pv = await previewFindingProposal(db, { findingId: f.findingId });
    assert.equal(pv.eligible, false);
    // The guard is ours: proposeMerge alone would accept this direction.
    const direct = await proposeMerge(db, { sourceId: "AST-1", targetId: INSIGHT }, await today());
    assert.equal(direct.type, "merge");
  });

  it("is idempotent: a repeat raise returns the open proposal, whatever direction it asks for", async () => {
    const f = await betavexFinding();
    const first = await raise(f);
    const again = await raise(f);
    const other = await raise(f, { sourceId: "AST-3", targetId: "AST-2", expectedFingerprint: "stale" });
    assert.deepEqual([again.created, other.created], [false, false]);
    assert.deepEqual([again.proposal.id, other.proposal.id, again.link.linkId], [first.proposal.id, first.proposal.id, first.link.linkId]);
    assert.deepEqual([await mergeProposals(), await links()], [1, 1]);
    const pv = await previewFindingProposal(db, { findingId: f.findingId });
    assert.deepEqual([pv.eligible, pv.reasons.map((r) => r.code), pv.link?.proposalId], [false, ["already_pending"], first.proposal.id]);
  });

  it("concurrent raises from separate clients on the same file create exactly one proposal", async () => {
    const f = await betavexFinding();
    const clients = [openDb(DB_PATH), openDb(DB_PATH), openDb(DB_PATH)];
    try {
      const results = await Promise.all(clients.map((c) => raise(f, {}, c)));
      assert.equal(results.filter((x) => x.created).length, 1);
      assert.equal(new Set(results.map((x) => x.proposal.id)).size, 1);
    } finally {
      for (const c of clients) c.close();
    }
    assert.deepEqual([await mergeProposals(), await links()], [1, 1]);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'scheduler_finding_proposal_raised'`), 1);
  });

  it("an existing open proposal on either asset blocks the raise", async () => {
    const f = await betavexFinding();
    const retire = await proposeRetire(db, { assetId: "AST-3", reason: "Fixture: under review." }, await today());
    await refused(raise(f), "asset_under_review");
    const pv = await previewFindingProposal(db, { findingId: f.findingId });
    assert.equal(pv.eligible, false);
    assert.match(pv.reasons.find((r) => r.code === "asset_under_review")!.message, new RegExp(retire.id));
  });
});

describe("decision synchronisation", () => {
  it("approval by both owners: outcome approved, the finding keeps its proposal, and the same evidence cannot be raised again", async () => {
    const f = await betavexFinding();
    const r = await raise(f);
    const date = await today();
    await decide(db, { proposalId: r.proposal.id, actor: "OWN-R", action: "approve" }, date);
    assert.equal((await listFindingProposals(db, f.findingId))[0].outcome, "pending", "one of two owners");
    await decide(db, { proposalId: r.proposal.id, actor: "OWN-1", action: "approve" }, date);

    const [live] = await listFindingProposals(db, f.findingId);
    assert.deepEqual([live.outcome, live.storedOutcome], ["approved", "pending"], "outcome is read live; the stored one is a cache");
    assert.deepEqual(live.decisions.map((d) => [d.actor, d.action]), [["OWN-R", "approve"], ["OWN-1", "approve"]]);
    assert.deepEqual(await syncFindingProposals(db), { changed: 1 });
    assert.deepEqual(await syncFindingProposals(db), { changed: 0 });
    const [synced] = await listFindingProposals(db, f.findingId);
    assert.equal(synced.storedOutcome, "approved");
    assert.equal((await getFinding(db, f.findingId))?.proposalId, r.proposal.id);

    const pv = await previewFindingProposal(db, { findingId: f.findingId });
    assert.equal(pv.eligible, false);
    assert.ok(pv.reasons.some((x) => x.code === "already_approved"));
    assert.ok(pv.reasons.some((x) => x.code === "asset_not_active"), "AST-2 was archived by the governed merge");
  });

  it("rejection: outcome rejected, linkage cleared, the same evidence is suppressed; changed evidence is eligible again", async () => {
    const f = await betavexFinding();
    const r = await raise(f);
    await decide(db, { proposalId: r.proposal.id, actor: "OWN-1", action: "reject", reason: "Keep the US board for the US team." }, await today());
    assert.deepEqual(await syncFindingProposals(db, { findingId: f.findingId }), { changed: 1 });
    const [l] = await listFindingProposals(db, f.findingId);
    assert.deepEqual([l.outcome, l.storedOutcome, l.decisions[0].reason], ["rejected", "rejected", "Keep the US board for the US team."]);
    assert.equal((await getFinding(db, f.findingId))?.proposalId, null);

    await refused(raise(f), "rejected_same_evidence");
    // A later run on unchanged evidence does not make it eligible.
    await retireAndRestore("AST-2", "OWN-R", "2026-11-04");
    assert.equal((await run()).summary!.findings.unchanged, 1);
    await refused(raise(f), "rejected_same_evidence");

    // Material change (AST-3 gains a KPI) seen by a run: a new fingerprint, eligible again.
    await retireAndRestore("AST-2", "OWN-R", "2026-11-05");
    assert.equal((await run(ast3GainsKpi)).summary!.findings.updated, 1);
    const changed = (await getFinding(db, f.findingId))!;
    assert.notEqual(changed.fingerprint, f.fingerprint);
    // Same simulated day: proposeMerge would reuse the rejected proposal's ID.
    await refused(raise(changed, {}, db, ast3GainsKpi), "proposal_id_taken");
    await db.execute(`UPDATE app_clock SET sim_date = '2026-11-02'`);
    const again = await raise(changed, {}, db, ast3GainsKpi);
    assert.equal(again.created, true);
    assert.equal(again.link.fingerprint, changed.fingerprint);
    assert.equal((await listFindingProposals(db, f.findingId)).length, 2);
    assert.equal((await getFinding(db, f.findingId))?.proposalId, again.proposal.id);
  });
});

describe("read-only preview, HTTP gate and reset", () => {
  it("the preview writes nothing, even when a decision is not yet synced", async () => {
    const f = await betavexFinding();
    const r = await raise(f);
    await decide(db, { proposalId: r.proposal.id, actor: "OWN-1", action: "reject", reason: "No." }, await today());
    const tables = ["proposals", "decisions", "audit_log", "asset_state", "scheduler_findings", "scheduler_finding_proposals"];
    const snap = async () => Promise.all(tables.map(async (t) => JSON.stringify((await db.execute(`SELECT * FROM ${t} ORDER BY rowid`)).rows)));
    const before = await snap();
    const pv = await previewFindingProposal(db, { findingId: f.findingId, sourceId: "AST-2", targetId: "AST-3", expectedFingerprint: f.fingerprint });
    assert.deepEqual([pv.link?.outcome, pv.link?.storedOutcome], ["rejected", "pending"]);
    assert.ok(pv.reasons.some((x) => x.code === "rejected_same_evidence"));
    assert.deepEqual(await snap(), before);
  });

  it("POST is switched off until B0: 409 blockedBy B0, nothing created, even with the demo gate open", async () => {
    assert.equal(FINDING_PROPOSALS_ENABLED, false);
    const f = await betavexFinding();
    const before = [await mergeProposals(), await count(`SELECT COUNT(*) AS n FROM audit_log`)];
    const script = `
      const m = await import("./src/app/api/scheduler/findings/[id]/proposal/route.ts");
      const req = new Request("http://local/api", { method: "POST", body: JSON.stringify(${JSON.stringify({
        actor: "manager",
        action: "merge",
        sourceId: "AST-2",
        targetId: "AST-3",
        expectedFingerprint: f.fingerprint,
      })}) });
      const res = await m.POST(req, { params: Promise.resolve({ id: ${JSON.stringify(f.findingId)} }) });
      process.stdout.write(JSON.stringify({ status: res.status, body: await res.json() }));`;
    const out = execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "-e", script], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_FILE: DB_PATH, SCHEDULER_DEMO_ACTIONS: "1" },
      encoding: "utf8",
    });
    const res = JSON.parse(out) as { status: number; body: { error: string; blockedBy: string } };
    assert.equal(res.status, 409);
    assert.equal(res.body.blockedBy, "B0");
    assert.match(res.body.error, /switched off/);
    assert.deepEqual([await mergeProposals(), await count(`SELECT COUNT(*) AS n FROM audit_log`)], before);
    assert.equal(await links(), 0);
    assert.equal((await getFinding(db, f.findingId))?.proposalId, null);
  });

  it("demo reset drops the link table with the other scheduler tables", async () => {
    const f = await betavexFinding();
    await raise(f);
    assert.equal(await links(), 1);
    await resetLifecycle(db, 0);
    const t = await db.execute(`SELECT name FROM sqlite_master WHERE name = 'scheduler_finding_proposals'`);
    assert.deepEqual(t.rows, []);
  });
});

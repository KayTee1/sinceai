// T24 (B3): finding -> governed merge proposal. Same team-authored fixture as
// tests/scheduler.test.ts (not Bayer data), in its own disposable database:
// AST-1 Alphazol EMEA (KPI-004, OWN-1, certified); AST-2 Betavex US (KPI-001,
// OWN-R, certified) covered by AST-3 Betavex Global (KPI-001, OWN-1,
// certified) and by AST-4 (Global, six KPIs, OWN-S). REQ-S01 builds a
// Temporary insight (owner OWN-R, KPI-004 + KPI-042) that covers AST-1.
//
// Tests call the service directly; the HTTP POST is switched off until B0
// and MERGE-APPROVERS (FINDING_PROPOSALS_ENABLED) and is only checked to
// refuse. No LLM, no network.
//
// MERGE-APPROVERS dependency: every fixture side has an active owner, so the
// proposeMerge gap (a side without any active approver is dropped from the
// required approvers) is not exercised; it is fixed in estate/merge.ts, not
// here.
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
    assert.deepEqual([pv.eligible, pv.enabled, pv.blockedBy, pv.reasons, pv.link], [true, false, ["B0", "MERGE-APPROVERS"], [], null]);
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
    assert.deepEqual([ev.findingId, ev.linkId, ev.fingerprint, ev.chosen], [f.findingId, r.link.linkId, f.fingerprint, { sourceId: "AST-2", targetId: "AST-3", chosenBy: "manager" }]);

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

/**
 * Simulated: the comparator prefers keeping AST-2 (as suggestMerge does for an otherwise equal pair
 * by tier, then usage). Direction is not part of the fingerprint, so the finding stays current.
 */
const prefersAst2: Comparator = async (d, input, date) => {
  const r = await suggestMerge(d, input, date);
  for (const s of r.suggestions) if (s.mergeAway.assetId === "AST-2" && s.keep.assetId === "AST-3") [s.mergeAway, s.keep] = [s.keep, s.mergeAway];
  return r;
};

describe("direction evidence (Codex B3-F2)", () => {
  it("agreeing direction: recorded on the link, the proposal and the audit; the comparator is labelled as evidence", async () => {
    const f = await betavexFinding();
    const pv = await previewFindingProposal(db, { findingId: f.findingId });
    assert.deepEqual(pv.comparatorPreferredDirection, { sourceId: "AST-2", targetId: "AST-3" });
    assert.deepEqual(pv.directions.map((d) => [d.sourceId, d.comparatorPreferred]), [["AST-2", true], ["AST-3", false]]);

    const r = await raise(f);
    assert.deepEqual([r.link.sourceId, r.link.targetId, r.link.againstComparator], ["AST-2", "AST-3", false]);
    assert.deepEqual(r.link.comparatorPreferredDirection, { sourceId: "AST-2", targetId: "AST-3" });
    const ev = r.proposal.evidence as { sourceId: string; targetId: string };
    assert.deepEqual([ev.sourceId, ev.targetId, r.proposal.assetIds], ["AST-2", "AST-3", ["AST-2"]]);
    assert.match(r.proposal.rationale, /^Merge AST-2 .* into AST-3 /);
    assert.match(r.proposal.rationale, /Direction chosen by manager from scheduler finding FND-[^:]+: AST-2 is merged into AST-3\./);
    assert.match(r.proposal.rationale, /Comparison evidence only, not an authorisation: the overlap comparator preferred the same direction\./);
    const audit = await db.execute({
      sql: `SELECT evidence FROM audit_log WHERE action = 'scheduler_finding_proposal_raised' AND proposal_id = ?`,
      args: [r.proposal.id],
    });
    const a = JSON.parse(audit.rows[0].evidence as string);
    assert.deepEqual([a.chosen, a.comparatorPreferredDirection, a.againstComparator], [
      { sourceId: "AST-2", targetId: "AST-3", chosenBy: "manager" },
      { sourceId: "AST-2", targetId: "AST-3" },
      false,
    ]);
  });

  it("opposing direction: the manager's choice is what is proposed; the comparator's preference is flagged, and it authorises nothing", async () => {
    const f = await betavexFinding();
    const pv = await previewFindingProposal(db, { findingId: f.findingId }, { compare: prefersAst2 });
    assert.equal(pv.currentFingerprint, f.fingerprint, "direction is not material");
    assert.deepEqual(pv.comparatorPreferredDirection, { sourceId: "AST-3", targetId: "AST-2" });
    assert.deepEqual(
      pv.directions.map((d) => [d.sourceId, d.targetId, d.comparatorPreferred, d.allowed, d.reasons.map((x) => x.code)]),
      [
        ["AST-2", "AST-3", false, true, []],
        ["AST-3", "AST-2", true, false, ["target_does_not_cover_scope"]],
      ],
      "the comparator's preferred direction is still refused by the checks",
    );
    await refused(raise(f, { sourceId: "AST-3", targetId: "AST-2" }, db, prefersAst2), "target_does_not_cover_scope");

    const r = await raise(f, {}, db, prefersAst2);
    assert.deepEqual([r.link.sourceId, r.link.targetId, r.link.againstComparator], ["AST-2", "AST-3", true]);
    assert.deepEqual(r.link.comparatorPreferredDirection, { sourceId: "AST-3", targetId: "AST-2" });
    const ev = r.proposal.evidence as { sourceId: string; targetId: string };
    assert.deepEqual([ev.sourceId, ev.targetId, r.proposal.assetIds], ["AST-2", "AST-3", ["AST-2"]]);
    assert.match(r.proposal.rationale, /Direction chosen by manager from scheduler finding FND-[^:]+: AST-2 is merged into AST-3\./);
    assert.match(r.proposal.rationale, /the overlap comparator preferred the opposite direction \(AST-3 into AST-2\)/);
    const shownLink = (await listFindingProposals(db, f.findingId))[0];
    assert.deepEqual([shownLink.againstComparator, shownLink.comparatorPreferredDirection], [true, { sourceId: "AST-3", targetId: "AST-2" }]);
    const audit = await db.execute({
      sql: `SELECT rationale, evidence FROM audit_log WHERE action = 'scheduler_finding_proposal_raised' AND proposal_id = ?`,
      args: [r.proposal.id],
    });
    assert.match(audit.rows[0].rationale as string, /direction chosen by manager.*comparator preferred AST-3 into AST-2 \(comparison evidence only\)/);
    assert.equal(JSON.parse(audit.rows[0].evidence as string).againstComparator, true);
  });
});

// Codex B3-F1: outcomes come from the lifecycle proposals row on every read.
// Decisions go through the real lifecycle services (decide, resetLifecycle);
// assertions use the functions behind the scheduler GET routes (getFinding,
// listFindings, previewFindingProposal, listFindingProposals). No sync call
// precedes these reads unless a test is about the cache itself.
const SCHEDULER_STATE = ["scheduler_findings", "scheduler_finding_proposals", "scheduler_runs", "scheduler_checkpoints"];
const snapScheduler = async () =>
  Promise.all(SCHEDULER_STATE.map(async (t) => JSON.stringify((await db.execute(`SELECT * FROM ${t} ORDER BY rowid`)).rows)));

/** What the Scheduler GET routes show for a finding: the finding itself, its entry in the list, and the preview's link. */
async function shown(findingId: string) {
  const one = (await getFinding(db, findingId))!;
  const listed = (await listFindings(db, { status: "any" })).findings.find((x) => x.findingId === findingId)!;
  assert.deepEqual([listed.proposalId, listed.proposal], [one.proposalId, one.proposal], "list and detail agree");
  const pv = await previewFindingProposal(db, { findingId });
  return { proposalId: one.proposalId, proposal: one.proposal, link: pv.link, pv };
}

describe("decision synchronisation (outcome derived on read)", () => {
  it("approval by both owners through decide: pending after one, approved after both; nothing pending is shown", async () => {
    const f = await betavexFinding();
    const r = await raise(f);
    const date = await today();
    let s = await shown(f.findingId);
    assert.equal(s.proposalId, r.proposal.id);
    assert.deepEqual(s.proposal, { proposalId: r.proposal.id, outcome: "pending", sourceId: "AST-2", targetId: "AST-3" });

    const before = await snapScheduler();
    await decide(db, { proposalId: r.proposal.id, actor: "OWN-R", action: "approve" }, date);
    s = await shown(f.findingId);
    assert.deepEqual([s.proposalId, s.proposal?.outcome, s.link?.outcome], [r.proposal.id, "pending", "pending"], "one of two owners");
    await decide(db, { proposalId: r.proposal.id, actor: "OWN-1", action: "approve" }, date);
    assert.deepEqual(await snapScheduler(), before, "the lifecycle decision path writes no scheduler state");

    s = await shown(f.findingId);
    assert.equal(s.proposalId, null, "no longer waiting in the Inbox");
    assert.equal(s.proposal?.outcome, "approved");
    assert.deepEqual([s.link?.outcome, s.link?.storedOutcome], ["approved", "pending"], "the stored outcome is a stale cache and is not used");
    assert.deepEqual(s.link?.decisions.map((d) => [d.actor, d.action]), [["OWN-R", "approve"], ["OWN-1", "approve"]]);
    assert.equal(s.pv.eligible, false);
    assert.ok(s.pv.reasons.some((x) => x.code === "already_approved"));
    assert.ok(s.pv.reasons.some((x) => x.code === "asset_not_active"), "AST-2 was archived by the governed merge");

    // The cache refresh is optional and idempotent; reads are unchanged by it.
    assert.deepEqual(await syncFindingProposals(db), { changed: 1 });
    assert.deepEqual(await syncFindingProposals(db), { changed: 0 });
    assert.equal((await listFindingProposals(db, f.findingId))[0].storedOutcome, "approved");
    assert.deepEqual((await shown(f.findingId)).proposal, s.proposal);
  });

  it("rejection with a reason through decide: shown as rejected at once (no sync), suppressed on the same evidence, eligible after a material change", async () => {
    const f = await betavexFinding();
    const r = await raise(f);
    await assert.rejects(decide(db, { proposalId: r.proposal.id, actor: "OWN-1", action: "reject" }, await today()), /reason/i);
    await decide(db, { proposalId: r.proposal.id, actor: "OWN-1", action: "reject", reason: "Keep the US board for the US team." }, await today());

    const s = await shown(f.findingId);
    assert.equal(s.proposalId, null, "a rejected proposal is never displayed as pending");
    assert.equal(s.proposal?.outcome, "rejected");
    assert.deepEqual([s.link?.outcome, s.link?.storedOutcome, s.link?.decisions[0].reason], ["rejected", "pending", "Keep the US board for the US team."]);
    assert.ok(s.pv.reasons.some((x) => x.code === "rejected_same_evidence"));
    assert.ok(!s.pv.reasons.some((x) => x.code === "already_pending"));

    // The refused raise rolls back its whole transaction, cache refresh included; nothing reads the cache, so nothing changes.
    await refused(raise(f), "rejected_same_evidence");
    assert.equal((await listFindingProposals(db, f.findingId))[0].storedOutcome, "pending");

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
    // The successful raise refreshed the stale cached 'pending' first (one-pending-link index), in its own transaction.
    assert.deepEqual((await listFindingProposals(db, f.findingId)).map((l) => l.storedOutcome), ["rejected", "pending"]);
    const now = await shown(f.findingId);
    assert.deepEqual([now.proposalId, now.proposal?.outcome], [again.proposal.id, "pending"], "the newest link wins");
  });

  it("expired and escalated rows are read as they are (merges have no due date, so the status is set directly here)", async () => {
    // No lifecycle path expires or escalates a merge today (proposeMerge stores due_on NULL);
    // this only checks the read-side mapping should one appear.
    const f = await betavexFinding();
    const r = await raise(f);
    await db.execute({ sql: `UPDATE proposals SET status = 'escalated' WHERE id = ?`, args: [r.proposal.id] });
    let s = await shown(f.findingId);
    assert.deepEqual([s.proposalId, s.proposal?.outcome], [r.proposal.id, "pending"]);
    await db.execute({ sql: `UPDATE proposals SET status = 'expired' WHERE id = ?`, args: [r.proposal.id] });
    s = await shown(f.findingId);
    assert.deepEqual([s.proposalId, s.proposal?.outcome, s.link?.outcome], [null, "expired", "expired"]);
    assert.ok(s.pv.reasons.some((x) => x.code === "rejected_same_evidence"));
  });

  it("a link whose proposal row is gone is stale: not shown, not pending, and does not block a raise", async () => {
    const f = await betavexFinding();
    const r = await raise(f);
    await db.execute({ sql: `DELETE FROM proposals WHERE id = ?`, args: [r.proposal.id] });
    const s = await shown(f.findingId);
    assert.deepEqual([s.proposalId, s.proposal, s.link], [null, null, null]);
    assert.deepEqual(s.pv.links.map((l) => l.outcome), ["missing"], "kept as history");
    assert.equal(s.pv.eligible, true);
    await db.execute(`UPDATE app_clock SET sim_date = '2026-11-02'`);
    const again = await raise(f);
    assert.equal(again.created, true);
    assert.equal((await shown(f.findingId)).proposalId, again.proposal.id);
  });

  it("demo reset (resetLifecycle) leaves no finding, link or pending proposal behind", async () => {
    const f = await betavexFinding();
    const r = await raise(f);
    await resetLifecycle(db, 0);
    assert.equal(await getFinding(db, f.findingId), null);
    assert.deepEqual((await listFindings(db, { status: "any" })).findings, []);
    await assert.rejects(previewFindingProposal(db, { findingId: f.findingId }), (e: unknown) => e instanceof SchedulerError && e.code === "not_found");
    assert.ok(!(await listPendingProposals(db)).some((p) => p.id === r.proposal.id));
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

  it("POST is switched off until B0 and the merge approver fix: 409 blockedBy both, nothing created, even with the demo gate open", async () => {
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
    const res = JSON.parse(out) as { status: number; body: { error: string; blockedBy: string[]; blockers: { id: string }[] } };
    assert.equal(res.status, 409);
    assert.deepEqual(res.body.blockedBy, ["B0", "MERGE-APPROVERS"]);
    assert.deepEqual(res.body.blockers.map((b) => b.id), ["B0", "MERGE-APPROVERS"]);
    assert.match(res.body.error, /switched off.*B0.*MERGE-APPROVERS/);
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

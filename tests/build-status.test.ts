// T21: read-only build status and duplicate-build protection, against a
// disposable copy of the team-authored fact fixture (tests/fixtures/facts.ts)
// plus the North America slice that lets TEAM-REQ-01 (D18) reach
// build_proposal (as in tests/build.test.ts), and REQ-S05, which needs
// clarification (Alphazol / EMEA from context, Betavex from the text).
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook, type ParsedSheet } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { buildStatusView } from "../src/mastra/tools/build-status-tools";
import { buildProposalView } from "../src/mastra/tools/build-tools";
import { decideBuild, getBuildStatus, proposeBuild, type BuildStatus } from "../src/services/build";
import { controlClock, processDue, resetLifecycle, type BuildEvidence } from "../src/services/lifecycle";
import { TEAM_REQUEST_SHEET } from "../src/services/steward/team-requests";
import { FACT_SHEETS } from "./fixtures/facts";

const OWNERS: ParsedSheet = {
  sheet: "Owners",
  data: [
    ["owner_id", "owner_name", "role", "scope", "status"],
    ["OWN-1", "Fixture Lead", "Commercial Lead", "EMEA", "active"],
    ["OWN-R", "Fixture Requester", "Analyst", "EMEA", "active"],
    ["OWN-S", "Fixture Steward", "Data Steward", "EMEA", "active"],
    ["OWN-NL", "Fixture NA Lead", "Commercial Lead", "North America", "active"],
    ["OWN-NA", "Fixture NA Analyst", "Analyst", "North America", "active"],
  ],
};
const A = "actual_like_synthetic";
const ASSET_TAIL = ["active", "certified", "Dashboard", "Power BI", "WS-1", "2026-09-01"];
const ADD: Record<string, unknown[][]> = {
  Products: [["P-XAR", "Xarelto"]],
  Markets: [["CA", "Canada", "North America"]],
  Analytics_Assets: [["AST-X1", "Xarelto North America Sales", "SM-1", "Xarelto", "North America", "OWN-NL", ...ASSET_TAIL]],
  Asset_KPI_Map: [["AST-X1", "KPI-001", "primary"]],
  Business_Requests: [
    ["REQ-S05", "2026-10-05", "Alphazol", "EMEA", "Net sales growth and forecast variance for Betavex by country.", "low", "new"],
  ],
  Product_Market_Monthly: [
    ["P-XAR", "US", "2026-09-01", 40.0, 38.0, 400, 5.3, 60, 90, 4, A, 1],
    ["P-XAR", "US", "2026-10-01", 44.0, 40.0, 440, 10.0, 62, 91, 4, A, 1],
    ["P-XAR", "CA", "2026-09-01", 8.0, 8.0, 80, 0, 50, 88, 3, A, 1],
    ["P-XAR", "CA", "2026-10-01", 9.0, 10.0, 90, -10.0, 52, 89, 3, A, 1],
  ],
};
const SHEETS = FACT_SHEETS.map((s) => (s.sheet === "Owners" ? OWNERS : ADD[s.sheet] ? { sheet: s.sheet, data: [...s.data, ...ADD[s.sheet]] } : s));
const EXPECTED = Object.fromEntries(SHEETS.filter((s) => s.sheet !== "START_HERE").map((s) => [s.sheet, s.data.length - 1]));

const dir = mkdtempSync(join(tmpdir(), "build-status-test-"));
let db: Client;
let imported = false;

beforeEach(async () => {
  if (!imported) {
    const dest = join(dir, "status.db");
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

const DAY = "2026-11-03";
const TTL_END = "2026-12-03";
const REQ = "TEAM-REQ-01";
const PRP = "PRP-INS-TEAM-REQ-01-1";
const INS = "INS-TEAM-REQ-01-1";

const APP_TABLES = ["app_clock", "asset_state", "proposals", "decisions", "audit_log", "archive_snapshots", "usage_events", "insights"];

/** Every app-owned row, in a stable order: proves a call changed nothing. */
async function snapshot(): Promise<string> {
  const out: Record<string, unknown> = {};
  for (const t of APP_TABLES) out[t] = (await db.execute(`SELECT * FROM ${t} ORDER BY rowid`)).rows;
  return JSON.stringify(out);
}

async function buildRows() {
  const r = await db.execute(`SELECT id, status FROM proposals WHERE type = 'build_temporary' ORDER BY rowid`);
  return r.rows.map((x) => [x.id as string, x.status as string]);
}

/**
 * Only the insight's TTL falls due: the fixture has no Asset_Usage sheet, so
 * pack leases (which would open lease reviews) are moved out of the window.
 */
async function expireInsight() {
  await db.execute(`UPDATE asset_state SET lease_end = '2099-01-01' WHERE origin = 'pack'`);
  assert.equal(await processDue(db, TTL_END), 1);
}

async function approved() {
  const r = await proposeBuild(db, { requestId: REQ }, DAY);
  assert.equal(r.status, "proposed");
  await decideBuild(db, { proposalId: PRP, actor: "OWN-NL", action: "approve" }, DAY);
}

const status = (by: "request" | "proposal" | "insight", id: string) => getBuildStatus(db, { by, id });

describe("getBuildStatus", () => {
  it("reports no proposal for a request that has none", async () => {
    const s = await status("request", REQ);
    assert.deepEqual([s.found, s.requestId, s.builds], [false, null, []]);
    assert.deepEqual(s.summary, { proposals: 0, pending: 0, approved: 0, rejected: 0, built: 0, active: 0, archived: 0 });
    assert.match(s.notes[0], /No build proposal has been stored for TEAM-REQ-01/);
    assert.equal(s.clockDate, "2026-11-01");
  });

  it("reports a pending proposal: no decision, nothing built or registered", async () => {
    await proposeBuild(db, { requestId: REQ }, DAY);
    const s = await status("request", REQ);
    assert.equal(s.found, true);
    const [b] = s.builds;
    assert.deepEqual([b.proposal.id, b.proposal.status, b.proposal.requiredApprovers], [PRP, "open", ["OWN-NL"]]);
    assert.deepEqual([b.proposal.scope, b.proposal.kpiIds], [{ product: "Xarelto", market: "North America" }, ["KPI-001", "KPI-042"]]);
    assert.equal(b.proposal.requestSourceSheet, TEAM_REQUEST_SHEET);
    assert.equal(b.decision, null);
    assert.deepEqual([b.insight.id, b.insight.built, b.lifecycle.registered, b.lifecycle.status], [INS, false, false, null]);
    assert.deepEqual([s.summary.pending, s.summary.approved, s.summary.built], [1, 0, 0]);
    const facts = buildStatusView(s).builds[0].facts;
    assert.deepEqual(facts, [`Approval: ${PRP} is open, waiting for OWN-NL in the approval inbox. Nothing is approved or built.`]);
  });

  it("reports an escalated proposal as pending", async () => {
    await proposeBuild(db, { requestId: REQ }, DAY);
    // The engine does not escalate build proposals (no due date); the status
    // type allows it, so the reader is checked against a stored escalated row.
    await db.execute({ sql: `UPDATE proposals SET status = 'escalated' WHERE id = ?`, args: [PRP] });
    const s = await status("proposal", PRP);
    assert.deepEqual([s.builds[0].proposal.status, s.summary.pending, s.builds[0].decision], ["escalated", 1, null]);
  });

  it("reports an approved build with an active Temporary insight", async () => {
    await approved();
    const s = await status("request", REQ);
    const [b] = s.builds;
    assert.equal(b.proposal.status, "approved");
    assert.deepEqual(b.decision, { action: "approve", actor: "OWN-NL", simDate: DAY, reason: null });
    assert.deepEqual(
      [b.insight.built, b.insight.requestId, b.insight.proposalId, b.insight.ownerId, b.insight.builtOn, b.insight.builtBy],
      [true, REQ, PRP, "OWN-NA", DAY, "OWN-NL"],
    );
    assert.equal(b.insight.name, "Xarelto · North America: Net Sales, Forecast Variance");
    assert.deepEqual(b.insight.scope, { product: "Xarelto", market: "North America" });
    assert.deepEqual(
      b.insight.kpis.map((k) => [k.kpiId, k.month, k.computedMarkets, k.totalMarkets]),
      [
        ["KPI-001", "2026-10-01", 2, 2],
        ["KPI-042", "2026-10-01", 2, 2],
      ],
    );
    assert.deepEqual([b.lifecycle.status, b.lifecycle.tier, b.lifecycle.ttlEnd], ["active", "temporary", TTL_END]);
    assert.equal(b.lifecycle.lastEvent?.action, "temporary_registered");
    assert.deepEqual([s.summary.approved, s.summary.built, s.summary.active, s.summary.archived], [1, 1, 1, 0]);
    // No values are copied into the status: those stay in the insight (Dashboard).
    assert.ok(!JSON.stringify(s).includes('"value"'));
  });

  it("keeps approval and lifecycle apart: approved, built, then archived by TTL expiry", async () => {
    await approved();
    await expireInsight();
    const s = await status("insight", INS);
    const [b] = s.builds;
    // The approval and the build are unchanged by the expiry.
    assert.equal(b.proposal.status, "approved");
    assert.deepEqual(b.decision, { action: "approve", actor: "OWN-NL", simDate: DAY, reason: null });
    assert.equal(b.insight.built, true);
    // The lifecycle reports the expiry.
    assert.deepEqual([b.lifecycle.status, b.lifecycle.prevTier], ["archived", "temporary"]);
    assert.deepEqual([b.lifecycle.lastEvent?.action, b.lifecycle.lastEvent?.simDate, b.lifecycle.lastEvent?.actor], ["ttl_expired", TTL_END, "policy"]);
    assert.deepEqual([s.summary.approved, s.summary.built, s.summary.active, s.summary.archived], [1, 1, 0, 1]);

    const facts = buildStatusView(s).builds[0].facts;
    assert.equal(facts[0], `Approval: ${PRP} was approved by OWN-NL on ${DAY}.`);
    assert.equal(facts[1], `Build: insight ${INS} was built on ${DAY} (approved by OWN-NL).`);
    assert.match(facts[2], /^Lifecycle: INS-TEAM-REQ-01-1 is archived, tier temporary before archiving, TTL end 2026-12-03\. Last lifecycle event: ttl_expired on 2026-12-03/);
    assert.match(facts[2], /Archiving does not change the approval/);
  });

  it("reports a rejected proposal with its reason and no insight", async () => {
    await proposeBuild(db, { requestId: REQ }, DAY);
    await decideBuild(db, { proposalId: PRP, actor: "OWN-NL", action: "reject", reason: "Covered by Q4 review" }, DAY);
    const [b] = (await status("proposal", PRP)).builds;
    assert.equal(b.proposal.status, "rejected");
    assert.deepEqual(b.decision, { action: "reject", actor: "OWN-NL", simDate: DAY, reason: "Covered by Q4 review" });
    assert.deepEqual([b.insight.built, b.lifecycle.registered], [false, false]);
    assert.deepEqual(buildFactsOf(b), [
      `Approval: ${PRP} was rejected by OWN-NL on ${DAY} (reason: Covered by Q4 review).`,
      `Build: no insight ${INS} was built.`,
    ]);
  });

  it("lists every proposal for a request, and one for its proposal or insight ID", async () => {
    await proposeBuild(db, { requestId: REQ }, DAY);
    await decideBuild(db, { proposalId: PRP, actor: "OWN-NL", action: "reject", reason: "Not now" }, DAY);
    const again = await proposeBuild(db, { requestId: REQ }, DAY);
    assert.deepEqual([again.status, again.status === "proposed" && again.proposal.id], ["proposed", "PRP-INS-TEAM-REQ-01-2"]);

    const all = await status("request", REQ);
    assert.deepEqual(all.builds.map((b) => [b.proposal.id, b.proposal.status]), [
      [PRP, "rejected"],
      ["PRP-INS-TEAM-REQ-01-2", "open"],
    ]);
    assert.deepEqual([all.summary.proposals, all.summary.pending, all.summary.rejected], [2, 1, 1]);
    assert.match(all.notes[0], /2 build proposals match TEAM-REQ-01/);

    const one = await status("proposal", "PRP-INS-TEAM-REQ-01-2");
    const byInsight = await status("insight", "INS-TEAM-REQ-01-2");
    assert.deepEqual(one.builds, byInsight.builds);
    assert.deepEqual(one.builds, [all.builds[1]]);
    assert.deepEqual(one.notes, []);
  });

  it("finds the same build by request, proposal and insight ID, ignoring case and spaces", async () => {
    await approved();
    const views = await Promise.all([
      status("request", " team-req-01 "),
      status("proposal", PRP.toLowerCase()),
      status("insight", INS),
    ]);
    for (const s of views) assert.deepEqual(s.builds, views[2].builds);
    assert.deepEqual(views.map((s) => s.query), [
      { by: "request", id: REQ },
      { by: "proposal", id: PRP },
      { by: "insight", id: INS },
    ]);
  });

  it("explains unknown, empty and wrong-kind identifiers without guessing", async () => {
    await approved();
    const cases: [BuildStatus, RegExp][] = [
      [await status("request", "REQ-NOPE"), /No build proposal has been stored for REQ-NOPE/],
      [await status("proposal", "PRP-NOPE"), /No proposal with ID PRP-NOPE exists/],
      [await status("insight", "INS-NOPE"), /No build proposal names insight INS-NOPE/],
      [await status("insight", "AST-X1"), /AST-X1 is a catalog asset, not an insight built from a build proposal/],
      [await status("request", "   "), /No identifier was given/],
      // A request ID passed as a proposal ID is not matched across kinds.
      [await status("proposal", REQ), /No proposal with ID TEAM-REQ-01 exists/],
    ];
    for (const [s, note] of cases) {
      assert.deepEqual([s.found, s.builds.length], [false, 0]);
      assert.match(s.notes.join(" "), note);
    }
  });

  it("names a non-build proposal as such", async () => {
    await db.execute({
      sql: `INSERT INTO proposals (id, version, type, asset_ids, rationale, evidence, required_approvers, status, created_on, due_on)
            VALUES ('PRP-AST-1-2026-11-02', 1, 'retire', '["AST-1"]', 'r', '{}', '["OWN-1"]', 'open', '2026-11-02', NULL)`,
    });
    const s = await status("proposal", "PRP-AST-1-2026-11-02");
    assert.equal(s.found, false);
    assert.match(s.notes[0], /is a retire proposal, not a build proposal/);
  });

  it("reports a genuinely empty, complete store as verified absence", async () => {
    const s = await status("request", REQ);
    assert.deepEqual([s.store, s.missingTables, s.found, s.storedProposals], ["complete", [], false, []]);
    assert.match(s.notes.join(" "), /No build proposal has been stored for TEAM-REQ-01/);
  });

  it("does not claim absence when a lifecycle table is missing, and keeps stored proposals", async () => {
    await approved();
    await db.execute(`DROP TABLE insights`);
    const s = await status("request", REQ);
    assert.deepEqual([s.store, s.missingTables, s.found, s.builds], ["incomplete", ["insights"], null, []]);
    assert.doesNotMatch(s.notes.join(" "), /not initialised|No build proposal has been stored|so no proposal/i);
    assert.match(s.notes[0], /cannot be verified: the lifecycle store is incomplete \(missing insights\)/);
    assert.match(s.notes[0], /does not show that no proposal or insight exists/);
    // The proposals table is intact: its row is reported with its stored status only.
    assert.deepEqual(
      s.storedProposals.map((p) => [p.id, p.status, p.requestSourceSheet, p.insightId]),
      [[PRP, "approved", TEAM_REQUEST_SHEET, INS]],
    );
    assert.match(s.notes[1], /PRP-INS-TEAM-REQ-01-1 \(approved\); its decision, build and lifecycle state cannot be read/);
    const v = buildStatusView(s);
    assert.deepEqual([v.store, v.found, v.builds], ["incomplete", null, []]);
    // Nothing was recreated by the lookup.
    const t = await db.execute(`SELECT 1 FROM sqlite_master WHERE name = 'insights'`);
    assert.equal(t.rows.length, 0);
  });

  it("does not claim absence when the proposals table itself is missing", async () => {
    await db.execute(`DROP TABLE proposals`);
    for (const [by, id] of [["request", REQ], ["proposal", PRP], ["insight", INS]] as const) {
      const s = await status(by, id);
      assert.deepEqual([s.store, s.found, s.builds, s.storedProposals], ["incomplete", null, [], []]);
      assert.deepEqual(s.missingTables, ["proposals"]);
      assert.match(s.notes[0], /cannot be verified/);
    }
    const t = await db.execute(`SELECT 1 FROM sqlite_master WHERE name = 'proposals'`);
    assert.equal(t.rows.length, 0);
  });

  it("is read-only: no write, no tick, no audit row, even with the clock running", async () => {
    await approved();
    // Running since epoch 0: any tick would advance the clock and process due events.
    await controlClock(db, { action: "resume" }, "test", 0);
    const before = await snapshot();
    for (const [by, id] of [["request", REQ], ["proposal", PRP], ["insight", INS], ["request", "REQ-NOPE"]] as const) {
      await status(by, id);
    }
    assert.equal(await snapshot(), before);
  });
});

function buildFactsOf(b: BuildStatus["builds"][number]) {
  return buildStatusView({ query: { by: "proposal", id: b.proposal.id }, store: "complete", missingTables: [], found: true, requestId: null, builds: [b], storedProposals: [], summary: {} as BuildStatus["summary"], clockDate: null, notes: [] }).builds[0].facts;
}

describe("proposeBuild duplicate protection (T21)", () => {
  it("stores the first proposal and returns the pending one on repeat", async () => {
    const first = await proposeBuild(db, { requestId: REQ }, DAY);
    assert.equal(first.status, "proposed");
    const before = await snapshot();
    const again = await proposeBuild(db, { requestId: REQ }, DAY);
    assert.equal(again.status, "already_proposed");
    assert.equal(await snapshot(), before);
  });

  it("does not store a second proposal after an approved build, for any requester", async () => {
    await approved();
    const before = await snapshot();
    for (const requesterId of [undefined, "OWN-NA", "OWN-NL"]) {
      const r = await proposeBuild(db, { requestId: REQ, requesterId }, "2026-11-10");
      assert.equal(r.status, "already_built");
      if (r.status !== "already_built") continue;
      assert.deepEqual([r.proposal.id, r.proposal.status], [PRP, "approved"]);
      assert.deepEqual([r.build.insight.id, r.build.insight.built, r.build.lifecycle.status], [INS, true, "active"]);
    }
    // History (proposals, decisions, audit, insight, lifecycle) is unchanged.
    assert.equal(await snapshot(), before);
    assert.deepEqual(await buildRows(), [[PRP, "approved"]]);
  });

  it("does not rebuild an archived insight automatically (no agreed rebuild policy; restore exists)", async () => {
    await approved();
    await expireInsight();
    const before = await snapshot();
    const r = await proposeBuild(db, { requestId: REQ }, "2026-12-10");
    assert.equal(r.status, "already_built");
    if (r.status === "already_built") {
      assert.deepEqual([r.proposal.status, r.build.lifecycle.status, r.build.lifecycle.lastEvent?.action], ["approved", "archived", "ttl_expired"]);
    }
    assert.equal(await snapshot(), before);
  });

  it("allows a new proposal after a rejection (existing versioning)", async () => {
    await proposeBuild(db, { requestId: REQ }, DAY);
    await decideBuild(db, { proposalId: PRP, actor: "OWN-NL", action: "reject", reason: "Not now" }, DAY);
    const r = await proposeBuild(db, { requestId: REQ }, DAY);
    assert.equal(r.status, "proposed");
    assert.deepEqual(await buildRows(), [
      [PRP, "rejected"],
      ["PRP-INS-TEAM-REQ-01-2", "open"],
    ]);
  });

  it("does not conflate different scopes of the same request", async () => {
    // An approved build for another offered scope of REQ-S05 (stored directly:
    // only one scope of this fixture request reaches build_proposal).
    const other: BuildEvidence = {
      kind: "build",
      requestId: "REQ-S05",
      requestText: "x",
      scope: { product: "Betavex", market: "EMEA" },
      requesterId: "OWN-R",
      requesterSource: "given",
      kpis: [],
      gaps: [],
      rationale: [],
      source: [{ sheet: "Business_Requests", ids: ["REQ-S05"] }],
    };
    await db.execute({
      sql: `INSERT INTO proposals (id, version, type, asset_ids, rationale, evidence, required_approvers, status, created_on, due_on)
            VALUES ('PRP-INS-REQ-S05-1', 1, 'build_temporary', '["INS-REQ-S05-1"]', 'r', ?, '["OWN-1"]', 'approved', ?, NULL)`,
      args: [JSON.stringify(other), DAY],
    });
    const r = await proposeBuild(db, { requestId: "REQ-S05", answer: { product: "Alphazol", market: "EMEA" }, requesterId: "OWN-R" }, DAY);
    assert.equal(r.status, "proposed");
    if (r.status === "proposed") {
      assert.deepEqual((r.proposal.evidence as BuildEvidence).scope, { product: "Alphazol", market: "EMEA" });
      assert.equal(r.proposal.id, "PRP-INS-REQ-S05-2"); // numbering still counts every proposal of the request
    }
    // The same scope again is now pending, not a third proposal.
    const again = await proposeBuild(db, { requestId: "REQ-S05", answer: { product: "Alphazol", market: "EMEA" } }, DAY);
    assert.equal(again.status, "already_proposed");
  });

  it("concurrent identical submissions store exactly one proposal", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => proposeBuild(db, { requestId: REQ }, DAY)));
    assert.deepEqual(await buildRows(), [[PRP, "open"]]);
    // Queued per client: the first stores it, the others see it pending.
    assert.deepEqual(results.map((r) => r.status), ["proposed", "already_proposed", "already_proposed", "already_proposed"]);
    const audit = await db.execute(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'build_proposed'`);
    assert.equal(Number(audit.rows[0].n), 1);
  });

  it("concurrent submissions after approval store nothing", async () => {
    await approved();
    const before = await snapshot();
    const results = await Promise.all(Array.from({ length: 4 }, () => proposeBuild(db, { requestId: REQ }, DAY)));
    assert.deepEqual(results.map((r) => r.status), ["already_built", "already_built", "already_built", "already_built"]);
    assert.equal(await snapshot(), before);
  });

  it("keeps human approval and requester/approver separation", async () => {
    await proposeBuild(db, { requestId: REQ }, DAY);
    await assert.rejects(decideBuild(db, { proposalId: PRP, actor: "OWN-NA", action: "approve" }, DAY), /not a required approver/);
    await decideBuild(db, { proposalId: PRP, actor: "OWN-NL", action: "approve" }, DAY);
    // An approved proposal cannot be decided again.
    await assert.rejects(decideBuild(db, { proposalId: PRP, actor: "OWN-NL", action: "approve" }, DAY), /already approved/);
  });

  it("does not conflate a workbook and a team request that share an ID and scope", async () => {
    // An approved build of a workbook (Business_Requests) request with the same
    // ID and scope as team-authored TEAM-REQ-01. Stored directly, without an
    // insight, so only the T21 same-request check can match it.
    const pack: BuildEvidence = {
      kind: "build",
      requestId: REQ,
      requestText: "x",
      scope: { product: "Xarelto", market: "North America" },
      requesterId: "OWN-NA",
      requesterSource: "given",
      kpis: [],
      gaps: [],
      rationale: [],
      source: [{ sheet: "Business_Requests", ids: [REQ] }],
    };
    await db.execute({
      sql: `INSERT INTO proposals (id, version, type, asset_ids, rationale, evidence, required_approvers, status, created_on, due_on)
            VALUES ('PRP-INS-TEAM-REQ-01-1', 1, 'build_temporary', '["INS-TEAM-REQ-01-1"]', 'r', ?, '["OWN-NL"]', 'approved', ?, NULL)`,
      args: [JSON.stringify(pack), DAY],
    });
    // The team request does not get the workbook build back: it is proposed as its own.
    const team = await proposeBuild(db, { requestId: REQ }, DAY);
    assert.equal(team.status, "proposed");
    if (team.status !== "proposed") return;
    assert.equal(team.proposal.id, "PRP-INS-TEAM-REQ-01-2");
    assert.deepEqual((team.proposal.evidence as BuildEvidence).source[0], { sheet: TEAM_REQUEST_SHEET, ids: [REQ] });
    // Repeating it finds its own pending proposal, not the approved workbook one.
    const again = await proposeBuild(db, { requestId: REQ }, DAY);
    assert.equal(again.status, "already_proposed");
    if (again.status === "already_proposed") assert.equal(again.proposal.id, "PRP-INS-TEAM-REQ-01-2");
    // Status by request lists both, each with its own source, and says they are different requests.
    const s = await status("request", REQ);
    assert.deepEqual(
      s.builds.map((b) => [b.proposal.id, b.proposal.status, b.proposal.requestSourceSheet]),
      [
        ["PRP-INS-TEAM-REQ-01-1", "approved", "Business_Requests"],
        ["PRP-INS-TEAM-REQ-01-2", "open", TEAM_REQUEST_SHEET],
      ],
    );
    assert.match(s.notes.join(" "), /different request sources .*they are different requests/);
  });

  it("a workbook request colliding with a built team request gets the estate verdict, not the team build", async () => {
    await approved();
    const text = "Net sales and forecast variance for Xarelto in North America, by country.";
    await db.execute({
      sql: `INSERT INTO Business_Requests (request_id, request_date, product_context, market_context, request_text, urgency, status, _source_row)
            VALUES (?, '2026-11-01', 'Xarelto', 'North America', ?, 'normal', 'new', 999)`,
      args: [REQ, text],
    });
    try {
      const before = await snapshot();
      const r = await proposeBuild(db, { requestId: REQ }, DAY);
      // Not already_built/already_proposed for the team proposal: the T22 estate gate
      // points to the built insight as a reuse candidate, and nothing is stored.
      assert.equal(r.status, "duplicate");
      if (r.status === "duplicate") assert.equal(r.duplicate.verdict, "reuse");
      assert.equal(await snapshot(), before);
    } finally {
      await db.execute({ sql: `DELETE FROM Business_Requests WHERE request_id = ? AND _source_row = 999`, args: [REQ] });
    }
  });

  it("already_built keeps F5 provenance in the service result and the chat view", async () => {
    await approved();
    const r = await proposeBuild(db, { requestId: REQ }, DAY);
    assert.equal(r.status, "already_built");
    if (r.status !== "already_built") return;
    assert.deepEqual((r.proposal.evidence as BuildEvidence).source[0], { sheet: TEAM_REQUEST_SHEET, ids: [REQ] });
    assert.equal(r.build.proposal.requestSourceSheet, TEAM_REQUEST_SHEET);
    const v = buildProposalView(r);
    assert.equal(v.status, "already_built");
    if (v.status !== "already_built") return;
    assert.deepEqual(v.request, { id: REQ, sourceSheet: TEAM_REQUEST_SHEET, teamAuthored: true });
    assert.deepEqual(v.build?.request, { sourceSheet: TEAM_REQUEST_SHEET, teamAuthored: true });
    assert.match(v.next, /^No new proposal was stored/);
    assert.match(v.next, /was approved by OWN-NL/);
  });
});

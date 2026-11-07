// Build step (step 4) against the team-authored fact fixture (tests/fixtures/facts.ts).
// REQ-S01 reaches build_proposal there: Alphazol, EMEA (DE, FR); KPI-004 growth
// DE 25 % / FR -20 %, KPI-042 variance DE 2.5 / FR -1.0 (fixture header).
// A North America slice (as in tests/orchestrator.test.ts) lets the
// team-authored TEAM-REQ-01 (D18) reach build_proposal too: Net Sales mapped by
// AST-X1, Forecast Variance by no asset, both computing for US and CA in 2026-10.
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook, type ParsedSheet } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { decideBuild, getInsight, proposeBuild } from "../src/services/build";
import {
  decide,
  getAssetAudit,
  getAssetState,
  listPendingProposals,
  resetLifecycle,
  type BuildEvidence,
} from "../src/services/lifecycle";
import { TEAM_REQUEST_SHEET } from "../src/services/steward/team-requests";
import { FACT_SHEETS } from "./fixtures/facts";

// Our copy of the fixture with a requester, a Lead and a steward in EMEA.
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
const NA_SLICE: Record<string, unknown[][]> = {
  Products: [["P-XAR", "Xarelto"]],
  Markets: [["CA", "Canada", "North America"]],
  Analytics_Assets: [["AST-X1", "Xarelto North America Sales", "SM-1", "Xarelto", "North America", "OWN-NL", ...ASSET_TAIL]],
  Asset_KPI_Map: [["AST-X1", "KPI-001", "primary"]],
  Product_Market_Monthly: [
    ["P-XAR", "US", "2026-09-01", 40.0, 38.0, 400, 5.3, 60, 90, 4, A, 1],
    ["P-XAR", "US", "2026-10-01", 44.0, 40.0, 440, 10.0, 62, 91, 4, A, 1],
    ["P-XAR", "CA", "2026-09-01", 8.0, 8.0, 80, 0, 50, 88, 3, A, 1],
    ["P-XAR", "CA", "2026-10-01", 9.0, 10.0, 90, -10.0, 52, 89, 3, A, 1],
  ],
};
const SHEETS = FACT_SHEETS.map((s) =>
  s.sheet === "Owners" ? OWNERS : NA_SLICE[s.sheet] ? { sheet: s.sheet, data: [...s.data, ...NA_SLICE[s.sheet]] } : s,
);
const EXPECTED = Object.fromEntries(SHEETS.filter((s) => s.sheet !== "START_HERE").map((s) => [s.sheet, s.data.length - 1]));

const dir = mkdtempSync(join(tmpdir(), "build-test-"));
let db: Client;
let imported = false;

beforeEach(async () => {
  if (!imported) {
    const dest = join(dir, "build.db");
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

describe("proposeBuild", () => {
  it("stores a build proposal for the requester's Lead when the analysis recommends a build", async () => {
    const r = await proposeBuild(db, { requestId: "REQ-S01", requesterId: "OWN-R" }, DAY);
    assert.equal(r.status, "proposed");
    if (r.status !== "proposed") return;
    const p = r.proposal;
    assert.deepEqual([p.type, p.status, p.assetIds[0]], ["build_temporary", "open", "INS-REQ-S01-1"]);
    assert.deepEqual(p.requiredApprovers, ["OWN-1"]); // Lead in EMEA, not the requester
    const ev = p.evidence as BuildEvidence;
    assert.deepEqual(ev.kpis.map((k) => k.kpiId), ["KPI-004", "KPI-042"]);
    assert.deepEqual([ev.scope, ev.requesterSource], [{ product: "Alphazol", market: "EMEA" }, "given"]);
    assert.ok(ev.gaps.some((g) => g.includes("Forecast Variance")));
    assert.equal(await getInsight(db, "INS-REQ-S01-1"), null); // nothing built yet
  });

  it("does not propose when the analysis does not recommend a build", async () => {
    const r = await proposeBuild(db, { requestId: "REQ-S02", requesterId: "OWN-R" }, DAY);
    assert.equal(r.status, "not_proposed");
    assert.equal((await listPendingProposals(db)).length, 0);
  });

  it("picks a requester by our region mapping and does not duplicate a pending proposal", async () => {
    const first = await proposeBuild(db, { requestId: "REQ-S01" }, DAY);
    assert.equal(first.status, "proposed");
    if (first.status === "proposed") {
      const ev = first.proposal.evidence as BuildEvidence;
      assert.deepEqual([ev.requesterId, ev.requesterSource], ["OWN-R", "team_mapping"]); // non-Lead, non-steward
    }
    const again = await proposeBuild(db, { requestId: "REQ-S01" }, DAY);
    assert.equal(again.status, "already_proposed");
  });
});

// F5 (Codex T16B review): the request source in stored evidence and audit must
// be the sheet the request was loaded from, not a hardcoded Business_Requests.
describe("proposeBuild request provenance (F5)", () => {
  async function storedEvidence(proposalId: string, insightId: string) {
    const row = await db.execute({ sql: `SELECT evidence FROM proposals WHERE id = ?`, args: [proposalId] });
    const audit = (await getAssetAudit(db, insightId)).filter((a) => a.action === "build_proposed");
    assert.equal(audit.length, 1);
    return { proposal: JSON.parse(row.rows[0].evidence as string) as BuildEvidence, audit: audit[0].evidence as BuildEvidence };
  }

  it("cites the team-authored sheet for TEAM-REQ-01 in output, stored proposal and audit, never Business_Requests", async () => {
    const r = await proposeBuild(db, { requestId: "TEAM-REQ-01" }, DAY);
    assert.equal(r.status, "proposed");
    if (r.status !== "proposed") return;
    const expected = [
      { sheet: TEAM_REQUEST_SHEET, ids: ["TEAM-REQ-01"] },
      { sheet: "KPI_Catalog", ids: ["KPI-001", "KPI-042"] },
    ];
    const stored = await storedEvidence(r.proposal.id, "INS-TEAM-REQ-01-1");
    for (const ev of [r.proposal.evidence as BuildEvidence, stored.proposal, stored.audit]) {
      assert.deepEqual(ev.source, expected);
      assert.ok(!JSON.stringify(ev).includes("Business_Requests"));
    }
    // Eligibility, scope, approvers and the rest of the evidence are unchanged.
    const ev = stored.proposal;
    assert.deepEqual([r.proposal.type, r.proposal.status, r.proposal.requiredApprovers], ["build_temporary", "open", ["OWN-NL"]]);
    assert.deepEqual([ev.requestId, ev.scope, ev.requesterId, ev.requesterSource], [
      "TEAM-REQ-01",
      { product: "Xarelto", market: "North America" },
      "OWN-NA",
      "team_mapping",
    ]);
    assert.deepEqual(stored.audit, stored.proposal);
    // A proposal builds nothing.
    assert.equal(await getInsight(db, "INS-TEAM-REQ-01-1"), null);
    assert.equal(await getAssetState(db, "INS-TEAM-REQ-01-1"), null);
  });

  it("keeps Business_Requests for a workbook request in output, stored proposal and audit", async () => {
    const r = await proposeBuild(db, { requestId: "REQ-S01", requesterId: "OWN-R" }, DAY);
    assert.equal(r.status, "proposed");
    if (r.status !== "proposed") return;
    const expected = [
      { sheet: "Business_Requests", ids: ["REQ-S01"] },
      { sheet: "KPI_Catalog", ids: ["KPI-004", "KPI-042"] },
    ];
    const stored = await storedEvidence(r.proposal.id, "INS-REQ-S01-1");
    for (const ev of [r.proposal.evidence as BuildEvidence, stored.proposal, stored.audit]) assert.deepEqual(ev.source, expected);
  });

  it("a team request still needs a human Lead; the requester cannot approve it", async () => {
    await proposeBuild(db, { requestId: "TEAM-REQ-01" }, DAY);
    const id = "PRP-INS-TEAM-REQ-01-1";
    await assert.rejects(decideBuild(db, { proposalId: id, actor: "OWN-NA", action: "approve" }, DAY), /not a required approver/);
    assert.equal(await getInsight(db, "INS-TEAM-REQ-01-1"), null);
    const { insight } = await decideBuild(db, { proposalId: id, actor: "OWN-NL", action: "approve" }, DAY);
    assert.equal(insight?.requestId, "TEAM-REQ-01");
    assert.equal((await getAssetState(db, "INS-TEAM-REQ-01-1"))?.tier, "temporary");
  });
});

describe("decideBuild", () => {
  it("on approval computes the KPIs per market and registers a Temporary insight", async () => {
    await proposeBuild(db, { requestId: "REQ-S01", requesterId: "OWN-R" }, DAY);
    const { insight } = await decideBuild(db, { proposalId: "PRP-INS-REQ-S01-1", actor: "OWN-1", action: "approve" }, DAY);
    assert.ok(insight);
    const values = insight.results.map((r) => [r.kpiId, r.byMarket.map((m) => [m.marketId, m.status, m.value])]);
    assert.deepEqual(values, [
      ["KPI-004", [["DE", "computed", 25], ["FR", "computed", -20]]],
      ["KPI-042", [["DE", "computed", 2.5], ["FR", "computed", -1]]],
    ]);
    // Every value carries its query and source rows (Rule 2).
    for (const m of insight.results.flatMap((r) => r.byMarket)) {
      assert.ok(m.provenance.query?.sql.includes("Product_Market_Monthly"));
      assert.ok(m.provenance.rows.length > 0);
    }
    const s = await getAssetState(db, "INS-REQ-S01-1");
    assert.deepEqual([s?.tier, s?.ownerId, s?.ttlEnd, s?.origin], ["temporary", "OWN-R", "2026-12-03", "app"]);
    assert.deepEqual(
      (await getAssetAudit(db, "INS-REQ-S01-1")).map((a) => a.action),
      ["build_proposed", "proposal_approved", "temporary_registered", "insight_built"],
    );
    assert.deepEqual((await getInsight(db, "INS-REQ-S01-1"))?.results, insight.results);
  });

  it("the requester cannot approve their own build; reject needs a reason and builds nothing", async () => {
    await proposeBuild(db, { requestId: "REQ-S01", requesterId: "OWN-R" }, DAY);
    const id = "PRP-INS-REQ-S01-1";
    await assert.rejects(decideBuild(db, { proposalId: id, actor: "OWN-R", action: "approve" }, DAY), /not a required approver/);
    await assert.rejects(decideBuild(db, { proposalId: id, actor: "OWN-1", action: "reject" }, DAY), /reason/);
    const r = await decideBuild(db, { proposalId: id, actor: "OWN-1", action: "reject", reason: "Covered by Q4 review" }, DAY);
    assert.deepEqual([r.proposal.status, r.insight], ["rejected", null]);
    assert.equal(await getAssetState(db, "INS-REQ-S01-1"), null);
  });

  it("lifecycle decide() refuses build proposals", async () => {
    await proposeBuild(db, { requestId: "REQ-S01", requesterId: "OWN-R" }, DAY);
    await assert.rejects(
      decide(db, { proposalId: "PRP-INS-REQ-S01-1", actor: "OWN-1", action: "approve" }, DAY),
      /build service/,
    );
  });
});

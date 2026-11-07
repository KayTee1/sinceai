// Build step (step 4) against the team-authored fact fixture (tests/fixtures/facts.ts).
// REQ-S01 reaches build_proposal there: Alphazol, EMEA (DE, FR); KPI-004 growth
// DE 25 % / FR -20 %, KPI-042 variance DE 2.5 / FR -1.0 (fixture header).
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
import { FACT_SHEETS } from "./fixtures/facts";

// Our copy of the fixture with a requester, a Lead and a steward in EMEA.
const OWNERS: ParsedSheet = {
  sheet: "Owners",
  data: [
    ["owner_id", "owner_name", "role", "scope", "status"],
    ["OWN-1", "Fixture Lead", "Commercial Lead", "EMEA", "active"],
    ["OWN-R", "Fixture Requester", "Analyst", "EMEA", "active"],
    ["OWN-S", "Fixture Steward", "Data Steward", "EMEA", "active"],
  ],
};
const SHEETS = FACT_SHEETS.map((s) => (s.sheet === "Owners" ? OWNERS : s));
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

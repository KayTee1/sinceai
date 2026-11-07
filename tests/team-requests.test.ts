// Team-authored demo requests (F1): loaded after the pack's requests, always
// labelled as ours, and (on the real pack) reaching a build proposal.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import readXlsxFile from "read-excel-file/node";
import { importWorkbook } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { analyzeRequest } from "../src/services/steward/analyze";
import { loadRequest, requestSource } from "../src/services/steward/requests";
import { TEAM_REQUEST_SHEET } from "../src/services/steward/team-requests";
import { FIXTURE_EXPECTED, FIXTURE_SHEETS } from "./fixtures/catalog";

describe("team-authored requests (fixture)", () => {
  let dir: string;
  let db: Client;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "team-req-"));
    const dest = join(dir, "fixture.db");
    await importWorkbook({ sheets: FIXTURE_SHEETS, dest, expected: FIXTURE_EXPECTED });
    db = openDb(dest);
  });
  after(() => {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads a team request when the pack has none with that ID, labelled as ours", async () => {
    const r = await loadRequest(db, " team-req-01 ");
    assert.equal(r?.request_id, "TEAM-REQ-01");
    assert.deepEqual(requestSource(r!), { sheet: TEAM_REQUEST_SHEET, row: 1, id: "TEAM-REQ-01" });
  });

  it("keeps pack requests first and never writes team requests into Business_Requests", async () => {
    const pack = await loadRequest(db, "REQ-T02");
    assert.equal(requestSource(pack!).sheet, "Business_Requests");
    const n = await db.execute(`SELECT COUNT(*) AS n FROM Business_Requests WHERE request_id LIKE 'TEAM-%'`);
    assert.equal(Number(n.rows[0].n), 0);
  });
  it("labels a request by the sheet it was loaded from, not by its ID (F5)", async () => {
    // A workbook row whose ID equals a team request ID is still workbook data.
    const d = mkdtempSync(join(tmpdir(), "team-req-collide-"));
    const sheets = FIXTURE_SHEETS.map((s) =>
      s.sheet === "Business_Requests"
        ? { sheet: s.sheet, data: [...s.data, ["TEAM-REQ-01", ...s.data[1].slice(1)]] }
        : s,
    );
    const expected = { ...FIXTURE_EXPECTED, Business_Requests: FIXTURE_EXPECTED.Business_Requests + 1 };
    await importWorkbook({ sheets, dest: join(d, "collide.db"), expected });
    const other = openDb(join(d, "collide.db"));
    try {
      const r = await loadRequest(other, "TEAM-REQ-01");
      const row = Number((await other.execute(`SELECT _source_row FROM Business_Requests WHERE request_id = 'TEAM-REQ-01'`)).rows[0]._source_row);
      assert.deepEqual(requestSource(r!), { sheet: "Business_Requests", row, id: "TEAM-REQ-01" });
      assert.deepEqual((await analyzeRequest(other, "TEAM-REQ-01")).request.source.sheet, "Business_Requests");
    } finally {
      other.close();
      rmSync(d, { recursive: true, force: true });
    }
  });
});

const PACK = process.env.PACK_XLSX;
const skip = !PACK || !existsSync(PACK) ? "PACK_XLSX not set to an existing workbook" : false;

describe("TEAM-REQ-01 on the Bayer pack (local)", { skip }, () => {
  let dir: string;
  let db: Client;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "team-req-pack-"));
    const dest = join(dir, "pack.db");
    await importWorkbook({ sheets: await readXlsxFile(PACK!), dest });
    db = openDb(dest);
  });
  after(() => {
    db?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("reaches a build proposal: Forecast Variance has no asset, both KPIs compute for US and CA", async () => {
    const a = await analyzeRequest(db, "TEAM-REQ-01");
    assert.equal(a.request.source.sheet, TEAM_REQUEST_SHEET);
    assert.equal(a.clarification.needed, false);
    assert.equal(a.recommendation.kind, "build_proposal");
    const gap = a.metricCoverage.find((m) => m.canonicalMetric === "Forecast Variance");
    assert.deepEqual(gap?.assetIds, []);
    for (const c of a.computability) {
      assert.equal(c.status, "computable", c.kpiId);
      assert.deepEqual(c.probe?.byMarket.map((m) => m.marketId).sort(), ["CA", "US"]);
    }
  });
});

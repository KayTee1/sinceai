// Local-only check against the real Bayer workbook. Skipped unless PACK_XLSX
// points to it. Imports into a disposable temp directory; nothing is committed
// or sent anywhere. Expected values come from docs/DATA_SOURCES.md and SCOPE.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import readXlsxFile from "read-excel-file/node";
import { EXPECTED_ROW_COUNTS } from "../src/db/expected";
import { importWorkbook } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { analyzeRequest } from "../src/services/steward/analyze";

const PACK = process.env.PACK_XLSX;
const skip = !PACK || !existsSync(PACK) ? "PACK_XLSX not set to an existing workbook" : false;

describe("Bayer pack (local)", { skip }, () => {
  let dir: string;
  let db: Client;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "steward-pack-"));
    const dest = join(dir, "pack.db");
    await importWorkbook({ sheets: await readXlsxFile(PACK!), dest });
    db = openDb(dest);
  });
  after(() => {
    db?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("imports every table sheet with the documented row counts", async () => {
    for (const [sheet, count] of Object.entries(EXPECTED_ROW_COUNTS)) {
      const r = await db.execute(`SELECT count(*) AS n, min(_source_row) AS lo, max(_source_row) AS hi FROM "${sheet}"`);
      assert.deepEqual([Number(r.rows[0].n), Number(r.rows[0].lo), Number(r.rows[0].hi)], [count, 2, count + 1], sheet);
    }
  });

  it("preserves blanks, value_type and decoded dates", async () => {
    const blank = await db.execute(`SELECT count(*) AS n FROM Analytics_Assets WHERE owner_id IS NULL`);
    assert.equal(Number(blank.rows[0].n), 21);
    const vt = await db.execute(`SELECT value_type, count(*) AS n FROM Product_Market_Monthly GROUP BY 1 ORDER BY 1`);
    assert.deepEqual(
      vt.rows.map((r) => [r.value_type, Number(r.n)]),
      [
        ["actual_like_synthetic", 491],
        ["forecast_like_synthetic", 489],
      ],
    );
    const months = await db.execute(`SELECT min(month) AS lo, max(month) AS hi FROM Product_Market_Monthly`);
    assert.deepEqual([months.rows[0].lo, months.rows[0].hi], ["2026-01-01", "2026-10-01"]);
  });

  it("REQ-0001: asks which scope is meant (Business_Requests row 2)", async () => {
    const a = await analyzeRequest(db, "REQ-0001");
    assert.equal(a.recommendation.kind, "clarify");
    assert.deepEqual(a.request.source, { sheet: "Business_Requests", row: 2, id: "REQ-0001" });
    assert.deepEqual(a.clarification.options, [
      { from: "context", product: "Beyonttra", market: "EMEA" },
      { from: "text", product: "Nubeqa", market: "Global" },
    ]);
  });

  it("REQ-0001: flags KPI-004 vs. KPI-005 and the other requested metrics", async () => {
    const a = await analyzeRequest(db, "REQ-0001", { product: "Nubeqa", market: "Global" });
    assert.deepEqual(
      a.kpiChecks.map((k) => [k.canonicalMetric, k.approved?.id]),
      [
        ["Net Sales Growth", "KPI-004"],
        ["Forecast Variance", "KPI-042"],
        ["Market Access Coverage", "KPI-027"],
      ],
    );
    const growth = a.kpiChecks[0];
    assert.deepEqual(
      growth.variants.map((v) => v.id),
      ["KPI-005"],
    );
    assert.equal(growth.conflict, true);
    for (const c of a.candidates) {
      assert.equal(c.score, Object.values(c.scoreParts).reduce((s, v) => s + v, 0));
      assert.ok(c.coverage.unknown.length > 0);
    }
    assert.notEqual(a.recommendation.kind, "clarify");
  });
});

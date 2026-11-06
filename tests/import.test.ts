// Importer safety: validation, provenance, and failure paths that must leave
// the destination untouched and no temporary files behind.
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importWorkbook, ImportError, validateSheets, type ParsedSheet } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { FIXTURE_EXPECTED, FIXTURE_SHEETS } from "./fixtures/catalog";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "steward-import-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const clone = (): ParsedSheet[] => FIXTURE_SHEETS.map((s) => ({ sheet: s.sheet, data: s.data.map((r) => [...r]) }));
const sheetOf = (sheets: ParsedSheet[], name: string) => sheets.find((s) => s.sheet === name)!;

describe("validateSheets", () => {
  it("accepts the fixture", () => {
    assert.deepEqual(validateSheets(FIXTURE_SHEETS, FIXTURE_EXPECTED), []);
  });

  it("reports missing, unexpected and miscounted sheets", () => {
    const sheets = clone().filter((s) => s.sheet !== "Owners");
    sheets.push({ sheet: "Extra", data: [["a"]] });
    sheetOf(sheets, "Products").data.pop();
    const errors = validateSheets(sheets, FIXTURE_EXPECTED);
    assert.ok(errors.includes("Missing sheet: Owners"));
    assert.ok(errors.includes("Unexpected sheet: Extra"));
    assert.ok(errors.includes("Products: expected 2 data rows, found 1"));
  });

  it("reports bad headers", () => {
    const sheets = clone();
    sheetOf(sheets, "Products").data[0] = ["product_id", "product_id"];
    sheetOf(sheets, "Markets").data[0] = ["market_id", "", 'bad"name'];
    sheetOf(sheets, "Owners").data[0][0] = "_source_row";
    const errors = validateSheets(sheets, FIXTURE_EXPECTED);
    assert.ok(errors.includes("Products: duplicate header product_id"));
    assert.ok(errors.includes("Markets: empty header in column 2"));
    assert.ok(errors.includes('Markets: header not a plain identifier: bad"name'));
    assert.ok(errors.includes("Owners: header uses reserved name _source_row"));
  });
});

describe("importWorkbook", () => {
  it("imports with exact source rows and preserved blanks", async () => {
    const dest = join(dir, "ok.db");
    const res = await importWorkbook({ sheets: FIXTURE_SHEETS, dest, expected: FIXTURE_EXPECTED });
    assert.equal(res.tables.find((t) => t.name === "Analytics_Assets")?.rows, 6);
    const db = openDb(dest);
    try {
      const r = await db.execute(`SELECT asset_id, owner_id, _source_row FROM Analytics_Assets ORDER BY _source_row`);
      assert.deepEqual(
        r.rows.map((x) => [x.asset_id, x._source_row]),
        [
          ["AST-1", 2],
          ["AST-2", 3],
          ["AST-3", 4],
          ["AST-4", 5],
          ["AST-5", 6],
          ["AST-6", 7],
        ],
      );
      assert.equal(r.rows[1].owner_id, null);
      const tables = await db.execute(`SELECT name FROM sqlite_master WHERE type = 'table'`);
      assert.ok(!tables.rows.some((t) => t.name === "START_HERE"));
    } finally {
      db.close();
    }
    assert.deepEqual(readdirSync(dir), ["ok.db"]);
  });

  it("refuses to overwrite an existing destination and leaves it byte-identical", async () => {
    const dest = join(dir, "existing.db");
    writeFileSync(dest, "pre-existing app state");
    await assert.rejects(importWorkbook({ sheets: FIXTURE_SHEETS, dest, expected: FIXTURE_EXPECTED }), (e: unknown) => {
      assert.ok(e instanceof ImportError);
      assert.match(e.message, /Refusing to overwrite/);
      return true;
    });
    assert.equal(readFileSync(dest, "utf8"), "pre-existing app state");
    assert.deepEqual(readdirSync(dir), ["existing.db"]);
  });

  it("writes nothing for an invalid workbook", async () => {
    const dest = join(dir, "bad.db");
    const sheets = clone();
    sheetOf(sheets, "KPI_Catalog").data[0][1] = "kpi_id"; // duplicate header
    await assert.rejects(importWorkbook({ sheets, dest, expected: FIXTURE_EXPECTED }), /failed validation; nothing written/);
    assert.deepEqual(readdirSync(dir), []);
  });

  it("removes the temporary file when writing fails midway", async () => {
    const dest = join(dir, "midway.db");
    const sheets = clone();
    // Passes validation but breaks the INSERT: a value SQLite cannot bind.
    sheetOf(sheets, "Owners").data[1][1] = { not: "bindable" };
    await assert.rejects(importWorkbook({ sheets, dest, expected: FIXTURE_EXPECTED }));
    assert.deepEqual(readdirSync(dir), []);
  });
});

describe("required columns (review F3)", () => {
  it("rejects a renamed required column before publishing anything", async () => {
    const sheets = clone();
    const kpi = sheetOf(sheets, "KPI_Catalog");
    kpi.data[0] = kpi.data[0].map((c) => (c === "canonical_metric" ? "canonical_metric_v2" : c));
    const assets = sheetOf(sheets, "Analytics_Assets");
    assets.data[0] = assets.data[0].map((c) => (c === "workspace_id" ? "workspace" : c));
    const errors = validateSheets(sheets, FIXTURE_EXPECTED);
    assert.ok(errors.includes("KPI_Catalog: missing required column canonical_metric"));
    assert.ok(errors.includes("Analytics_Assets: missing required column workspace_id"));

    const dest = join(dir, "renamed.db");
    await assert.rejects(importWorkbook({ sheets, dest, expected: FIXTURE_EXPECTED }), /missing required column canonical_metric/);
    assert.deepEqual(readdirSync(dir), []);
  });

  it("rejects a missing value_type column", () => {
    const sheets: ParsedSheet[] = [
      ...clone(),
      { sheet: "Product_Market_Monthly", data: [["product_id", "market_id", "month"], ["P-ALP", "DE", "2026-01-01"]] },
    ];
    const errors = validateSheets(sheets, { ...FIXTURE_EXPECTED, Product_Market_Monthly: 1 });
    assert.ok(errors.includes("Product_Market_Monthly: missing required column value_type"));
  });
});

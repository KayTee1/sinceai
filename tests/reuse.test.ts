// T21: the requester confirms a reuse candidate from chat ("Use this", Miro step 6).
// Fixture: the T15 facts plus a KPI-042 mapping on AST-1, so REQ-S01
// (Alphazol / EMEA) is fully covered by AST-1 and recommends reuse.
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook, type ParsedSheet } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { confirmReuse } from "../src/services/build";
import { LifecycleError, getAssetAudit, resetLifecycle } from "../src/services/lifecycle";
import { analyzeRequest } from "../src/services/steward/analyze";
import { FACT_SHEETS } from "./fixtures/facts";

const OWNERS: ParsedSheet = {
  sheet: "Owners",
  data: [
    ["owner_id", "owner_name", "role", "scope", "status"],
    ["OWN-1", "Fixture Lead", "Commercial Lead", "EMEA", "active"],
    ["OWN-R", "Fixture Requester", "Analyst", "EMEA", "active"],
  ],
};
const SHEETS = FACT_SHEETS.map((s) =>
  s.sheet === "Owners" ? OWNERS : s.sheet === "Asset_KPI_Map" ? { sheet: s.sheet, data: [...s.data, ["AST-1", "KPI-042", "secondary"]] } : s,
);
const EXPECTED = Object.fromEntries(SHEETS.filter((s) => s.sheet !== "START_HERE").map((s) => [s.sheet, s.data.length - 1]));
const DAY = "2026-11-03";

const dir = mkdtempSync(join(tmpdir(), "reuse-test-"));
let db: Client;
let imported = false;

beforeEach(async () => {
  if (!imported) {
    const dest = join(dir, "reuse.db");
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

async function appOpens(assetId: string, userId: string) {
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM usage_events WHERE asset_id = ? AND user_id = ? AND origin = 'app'`,
    args: [assetId, userId],
  });
  return Number(r.rows[0].n);
}

describe("confirmReuse", () => {
  it("fixture: REQ-S01 recommends reusing AST-1", async () => {
    const a = await analyzeRequest(db, "REQ-S01");
    assert.equal(a.recommendation.kind, "reuse_candidates");
    assert.ok(a.candidates.some((c) => c.assetId === "AST-1" && c.coversAllMetrics));
  });

  it("logs an app use for the mapped requester and an audit entry", async () => {
    const r = await confirmReuse(db, { requestId: "REQ-S01", assetId: "AST-1" }, DAY);
    assert.deepEqual([r.requestId, r.assetId, r.requesterId, r.requesterSource], ["REQ-S01", "AST-1", "OWN-R", "team_mapping"]);
    assert.equal(await appOpens("AST-1", "OWN-R"), 1);
    const audit = await getAssetAudit(db, "AST-1");
    const entry = audit.find((e) => e.action === "reuse_confirmed");
    assert.ok(entry, "audit records the confirmation");
    assert.equal(entry.actor, "OWN-R");
  });

  it("refuses an asset that is not one of the request's reuse candidates", async () => {
    await assert.rejects(confirmReuse(db, { requestId: "REQ-S01", assetId: "AST-2" }, DAY), LifecycleError);
    assert.equal(await appOpens("AST-2", "OWN-R"), 0);
  });

  it("refuses when the analysis does not recommend reuse", async () => {
    await assert.rejects(confirmReuse(db, { requestId: "REQ-S03", assetId: "AST-2" }, DAY), LifecycleError);
  });
});

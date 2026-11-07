// Duplicate scan (T20) against the team-authored lifecycle fixture, where
// AST-LOW and AST-DEP show the same metrics in the same scope.
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import {
  dismissFinding,
  listFindings,
  listScanRuns,
  nextScanDate,
  proposeMerge,
  runDuplicateScan,
  standInFingerprinter,
} from "../src/services/duplicates";
import {
  controlClock,
  decide,
  getAssetAudit,
  getAssetState,
  getPortfolioCounts,
  listPendingProposals,
  resetLifecycle,
} from "../src/services/lifecycle";
import { LIFECYCLE_EXPECTED, LIFECYCLE_SHEETS } from "./fixtures/lifecycle";

const dir = mkdtempSync(join(tmpdir(), "dup-test-"));
let db: Client;
let imported = false;

beforeEach(async () => {
  if (!imported) {
    const dest = join(dir, "dup.db");
    await importWorkbook({ sheets: LIFECYCLE_SHEETS, dest, expected: LIFECYCLE_EXPECTED });
    db = openDb(dest);
    imported = true;
  }
  await resetLifecycle(db, 0);
});

after(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

const advance = (days: number) => controlClock(db, { action: "advance", days }, "test", 0);

describe("stand-in fingerprint", () => {
  it("treats KPI variants of one metric as the same feature and scores Jaccard over bits", () => {
    const [a, b, c] = standInFingerprinter.build([
      { assetId: "A", productScope: "P", marketScope: "DE", canonicalMetrics: ["Net Sales", "OTIF"] },
      { assetId: "B", productScope: "P", marketScope: "DE", canonicalMetrics: ["OTIF", "Net Sales", "Net Sales"] },
      { assetId: "C", productScope: "P", marketScope: "FR", canonicalMetrics: ["Coverage"] },
    ]);
    assert.equal(standInFingerprinter.similarity(a, b), 1);
    assert.equal(a.key, b.key);
    assert.equal(standInFingerprinter.similarity(a, c), 1 / 6); // shares only product
    assert.match(a.hex, /^[0-9a-f]+$/);
  });
});

describe("scheduled duplicate scan", () => {
  it("runs every 10 simulated days and records the duplicate group as an open finding", async () => {
    assert.equal(await nextScanDate(db), "2026-11-02");
    await advance(1);
    const [f] = await listFindings(db);
    assert.deepEqual([f.assetIds, f.similarity, f.status], [["AST-DEP", "AST-LOW"], 1, "open"]);
    assert.ok(f.evidence.shared.includes("metric:Net Sales"));
    assert.equal(await nextScanDate(db), "2026-11-12");
    await advance(10);
    assert.equal((await listScanRuns(db)).length, 2);
    const again = await listFindings(db);
    assert.equal(again.length, 1); // refreshed, not duplicated
    assert.equal(again[0].lastSeen, "2026-11-12");
  });

  it("changes nothing by itself: no proposals, no archives", async () => {
    await advance(1);
    assert.equal((await listPendingProposals(db)).length, 0);
    assert.equal((await getAssetState(db, "AST-DEP"))?.status, "active");
  });

  it("does not raise a dismissed group again while its fingerprints are unchanged", async () => {
    await advance(1);
    const [f] = await listFindings(db);
    await assert.rejects(dismissFinding(db, { findingId: f.id, actor: "OWN-S" }, "2026-11-02"), /reason/);
    await dismissFinding(db, { findingId: f.id, actor: "OWN-S", reason: "Legitimate regional variant" }, "2026-11-02");
    await runDuplicateScan(db, "2026-11-03", "OWN-S");
    const all = await listFindings(db);
    assert.deepEqual(all.map((x) => x.status), ["dismissed"]);
  });
});

describe("merge from a finding", () => {
  it("proposes one merge per merged-away dashboard; the owner's approval archives it", async () => {
    await advance(1);
    const [f] = await listFindings(db);
    const { proposalIds } = await proposeMerge(db, { findingId: f.id, targetId: "AST-LOW", actor: "OWN-S" }, "2026-11-02");
    assert.equal(proposalIds.length, 1);
    const p = (await listPendingProposals(db)).find((x) => x.type === "merge")!;
    assert.deepEqual([p.assetIds, p.requiredApprovers, p.status], [["AST-DEP"], ["OWN-1"], "open"]);
    assert.equal((await listFindings(db))[0].status, "proposed");

    await decide(db, { proposalId: p.id, actor: "OWN-1", action: "approve" }, "2026-11-03");
    assert.equal((await getAssetState(db, "AST-DEP"))?.status, "archived");
    assert.ok((await getAssetAudit(db, "AST-DEP")).some((a) => a.action === "merged"));
    assert.equal((await getPortfolioCounts(db)).changes.merged, 1);

    await runDuplicateScan(db, "2026-11-04"); // archived dashboards are not scanned
    assert.equal((await listFindings(db)).filter((x) => x.status === "open").length, 0);
  });
});

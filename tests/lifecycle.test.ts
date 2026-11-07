// Lifecycle engine against the team-authored lifecycle fixture.
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import {
  controlClock,
  decide,
  getPortfolioCounts,
  getAssetAudit,
  getAssetState,
  listPendingProposals,
  readClock,
  recordUsage,
  registerTemporary,
  resetLifecycle,
  restore,
  seededLeaseEnd,
  tick,
} from "../src/services/lifecycle";
import { LIFECYCLE_EXPECTED, LIFECYCLE_SHEETS } from "./fixtures/lifecycle";

const dir = mkdtempSync(join(tmpdir(), "lifecycle-test-"));
const dest = join(dir, "lifecycle.db");
let db: Client;
let imported = false;

beforeEach(async () => {
  if (!imported) {
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
const actions = async (assetId: string) => (await getAssetAudit(db, assetId)).map((a) => a.action);

describe("seeding", () => {
  it("spreads imported leases by whole 90-day periods after last_modified (D13)", () => {
    assert.equal(seededLeaseEnd("2026-08-10", "2026-11-01"), "2026-11-08");
    assert.equal(seededLeaseEnd("2025-11-15", "2026-11-01"), "2026-11-10");
    assert.equal(seededLeaseEnd(null, "2026-11-01"), "2027-01-30");
  });

  it("maps endorsement to tier and starts the clock paused on 2026-11-01", async () => {
    assert.equal((await getAssetState(db, "AST-HIGH"))?.tier, "certified");
    assert.equal((await getAssetState(db, "AST-DEP"))?.tier, "team");
    assert.equal((await getAssetState(db, "AST-LOW"))?.leaseEnd, "2026-11-08");
    const c = await readClock(db);
    assert.deepEqual([c.date, c.running], ["2026-11-01", false]);
  });
});

describe("lease review", () => {
  it("opens a retire review for a barely used asset with evidence", async () => {
    await advance(7); // 2026-11-08
    const [p] = (await listPendingProposals(db)).filter((x) => x.assetIds[0] === "AST-LOW");
    assert.equal(p.type, "retire");
    assert.equal(p.dueOn, "2026-11-22");
    assert.deepEqual(p.requiredApprovers, ["OWN-1"]);
    assert.equal(p.evidence.avgMonthlyUsers, 2);
    assert.equal((await getAssetState(db, "AST-LOW"))?.status, "lease_due");
  });

  it("never archives on silence: escalates to the region steward (D16)", async () => {
    await advance(30);
    for (const id of ["AST-LOW", "AST-HIGH", "AST-DEP", "AST-INACT"]) {
      assert.equal((await getAssetState(db, id))?.status, "lease_due", id);
    }
    const audit = await getAssetAudit(db, "AST-LOW");
    const escalated = audit.find((a) => a.action === "review_escalated");
    assert.deepEqual([escalated?.actor, escalated?.policyVersion, escalated?.simDate], ["policy", "lifecycle-v2", "2026-11-22"]);
    assert.ok(!audit.some((a) => a.action.startsWith("archived")));

    const byAsset = new Map((await listPendingProposals(db)).map((p) => [p.assetIds[0], p]));
    assert.equal(byAsset.get("AST-LOW")?.status, "escalated");
    assert.deepEqual(byAsset.get("AST-LOW")?.requiredApprovers, ["OWN-1", "OWN-S"]); // EMEA steward joins
    assert.deepEqual(byAsset.get("AST-NOOWN")?.requiredApprovers, ["OWN-G"]); // no owner -> Global steward
  });

  it("archives only on an approved proposal, then restores", async () => {
    await advance(30);
    const p = (await listPendingProposals(db)).find((x) => x.assetIds[0] === "AST-LOW")!;
    await decide(db, { proposalId: p.id, actor: "OWN-S", action: "approve" }, "2026-12-01");
    assert.equal((await getAssetState(db, "AST-LOW"))?.status, "archived");

    const r = await restore(db, { assetId: "AST-LOW", actor: "OWN-1" }, "2026-12-02");
    assert.deepEqual([r.status, r.tier, r.leaseEnd], ["active", "personal", "2027-03-02"]);
    assert.deepEqual(await actions("AST-LOW"), [
      "lease_review_opened",
      "review_escalated",
      "proposal_approved",
      "retired",
      "restored",
    ]);
  });

  it("renews on owner approval and keeps the tier (D12)", async () => {
    await advance(9); // 2026-11-10
    const p = (await listPendingProposals(db)).find((x) => x.assetIds[0] === "AST-HIGH")!;
    assert.equal(p.type, "renew");
    await decide(db, { proposalId: p.id, actor: "OWN-1", action: "approve" }, "2026-11-12");
    const s = await getAssetState(db, "AST-HIGH");
    assert.deepEqual([s?.status, s?.tier, s?.leaseEnd], ["active", "certified", "2027-02-10"]);
  });

  it("requires a reason to reject, and rejecting retire renews (D14)", async () => {
    await advance(7);
    const p = (await listPendingProposals(db)).find((x) => x.assetIds[0] === "AST-LOW")!;
    await assert.rejects(decide(db, { proposalId: p.id, actor: "OWN-1", action: "reject" }, "2026-11-09"), /reason/);
    await decide(db, { proposalId: p.id, actor: "OWN-1", action: "reject", reason: "Used in Q4 close" }, "2026-11-09");
    const s = await getAssetState(db, "AST-LOW");
    assert.deepEqual([s?.status, s?.leaseEnd], ["active", "2027-02-07"]);
    await advance(30); // silence later cannot archive a decided review
    assert.equal((await getAssetState(db, "AST-LOW"))?.status, "active");
  });

  it("only the required approver may decide (Rule 11)", async () => {
    await advance(7);
    const p = (await listPendingProposals(db)).find((x) => x.assetIds[0] === "AST-LOW")!;
    await assert.rejects(
      decide(db, { proposalId: p.id, actor: "OWN-3", action: "approve" }, "2026-11-09"),
      /not a required approver/,
    );
  });
});

describe("temporary insights", () => {
  it("expire after the 30-day TTL and restore with a fresh TTL (D14)", async () => {
    await registerTemporary(db, { assetId: "INS-1", name: "Q3 sales", ownerId: "OWN-1", approvedBy: "OWN-3" }, "2026-11-01");
    await advance(29);
    assert.equal((await getAssetState(db, "INS-1"))?.status, "active");
    await advance(1);
    assert.equal((await getAssetState(db, "INS-1"))?.status, "archived");
    const r = await restore(db, { assetId: "INS-1", actor: "OWN-1" }, "2026-12-05");
    assert.deepEqual([r.tier, r.ttlEnd, r.leaseEnd], ["temporary", "2027-01-04", null]);
    assert.deepEqual(await actions("INS-1"), ["temporary_registered", "ttl_expired", "restored"]);
  });

  it("become Personal when the owner uses them again (D14)", async () => {
    await registerTemporary(db, { assetId: "INS-2", name: "EMEA check", ownerId: "OWN-1", approvedBy: "OWN-3" }, "2026-11-01");
    await recordUsage(db, { assetId: "INS-2", userId: "OWN-3" }, "2026-11-02");
    assert.equal((await getAssetState(db, "INS-2"))?.tier, "temporary");
    await recordUsage(db, { assetId: "INS-2", userId: "OWN-1" }, "2026-11-03");
    const s = await getAssetState(db, "INS-2");
    assert.deepEqual([s?.tier, s?.ttlEnd, s?.leaseEnd], ["personal", null, "2027-02-01"]);
  });
});

describe("clock and audit", () => {
  it("runs at 1 simulated day per real second and pauses", async () => {
    await controlClock(db, { action: "resume" }, "test", 0);
    assert.equal((await tick(db, 3_500)).date, "2026-11-04");
    await controlClock(db, { action: "pause" }, "test", 3_500);
    assert.equal((await tick(db, 60_000)).date, "2026-11-04");
  });

  it("jumps to the next due event", async () => {
    const r = await controlClock(db, { action: "next_due" }, "test", 0);
    assert.equal(r.clock.date, "2026-11-08");
    assert.ok(r.processed >= 1);
  });

  it("keeps the audit log append-only and the pack tables untouched", async () => {
    await advance(30);
    await assert.rejects(db.execute(`UPDATE audit_log SET actor = 'x'`), /append-only/);
    await assert.rejects(db.execute(`DELETE FROM audit_log`), /append-only/);
    const pack = await db.execute(`SELECT endorsement, lifecycle_status FROM Analytics_Assets WHERE asset_id = 'AST-LOW'`);
    assert.deepEqual([pack.rows[0].endorsement, pack.rows[0].lifecycle_status], ["none", "active"]);
  });
});

describe("portfolio counts", () => {
  it("compares the seeded state with now and counts applied changes", async () => {
    const start = await getPortfolioCounts(db);
    assert.deepEqual(start.before, start.now);
    assert.deepEqual(start.before, { certified: 1, team: 1, personal: 4, temporary: 0, archived: 0, underReview: 0 });

    await advance(7); // AST-LOW review opens
    const p = (await listPendingProposals(db)).find((x) => x.assetIds[0] === "AST-LOW")!;
    await decide(db, { proposalId: p.id, actor: "OWN-1", action: "approve" }, "2026-11-08");
    await registerTemporary(db, { assetId: "INS-9", name: "Check", ownerId: "OWN-1", approvedBy: "OWN-3" }, "2026-11-08");

    const c = await getPortfolioCounts(db);
    assert.deepEqual(c.before, start.before);
    assert.deepEqual([c.now.personal, c.now.archived, c.now.temporary], [3, 1, 1]);
    assert.deepEqual([c.changes.retired, c.changes.built], [1, 1]);
  });
});


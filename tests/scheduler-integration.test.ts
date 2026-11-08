// T25 integration (B1 + B2 + B3): the seams between periodic reassessment
// (B2) and finding proposals (B3), and schema upgrades from each branch's
// database shape. Same team-authored fixture as tests/scheduler-proposals.test.ts
// in its own disposable database. No LLM, no network, no Bayer data.
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook, type ParsedSheet } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { proposeMerge } from "../src/services/estate";
import {
  decide,
  getAssetState,
  getProposal,
  proposeRetire,
  readClock,
  resetLifecycle,
  restore,
  type MergeEvidence,
} from "../src/services/lifecycle";
import {
  B1_FINDINGS_DDL,
  dismissFinding,
  previewFindingProposal,
  SchedulerError,
  ensureScheduler,
  getFinding,
  listFindings,
  raiseFindingProposal,
  runIncremental,
  runReassessment,
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

const dir = mkdtempSync(join(tmpdir(), "scheduler-integration-test-"));
const DB_PATH = join(dir, "integration.db");
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

const raise = (f: Finding, over: Partial<Parameters<typeof raiseFindingProposal>[1]> = {}, c: Client = db, compare?: Comparator) =>
  raiseFindingProposal(
    c,
    { findingId: f.findingId, actor: "manager", action: "merge", sourceId: "AST-2", targetId: "AST-3", expectedFingerprint: f.fingerprint, ...over },
    { compare },
  );

const noOverlap: Comparator = async () => ({ total: 0, suggestions: [], note: "fixture: overlap gone" });
const tableSql = async (name: string) =>
  (await db.execute({ sql: `SELECT sql FROM sqlite_master WHERE name = ?`, args: [name] })).rows[0]?.sql as string | undefined;

describe("B2 x B3: reassessment sees the derived proposal link", () => {
  it("a periodic run that resolves a finding reports its raised proposal as linked, and leaves it open", async () => {
    const f = await betavexFinding();
    const { link } = await raise(f);
    assert.equal((await getFinding(db, f.findingId))?.proposalId, link.proposalId);
    const r = await runReassessment(db, { actor: "manager", compare: noOverlap });
    const stale = r.summary!.reassessment!.staleProposals.filter((s) => s.proposalId === link.proposalId);
    assert.deepEqual(stale.map((s) => [s.relation, s.findingOutcome, s.findingId]), [["linked", "resolved", f.findingId]]);
    assert.equal((await getProposal(db, link.proposalId))?.status, "open", "the scheduler never decides proposals");
    const now = (await getFinding(db, f.findingId))!;
    assert.deepEqual([now.status, now.proposal?.outcome], ["resolved", "pending"]);
  });

  it("after a rejection the finding shows the rejected outcome on read, and a reassessment no longer calls it linked", async () => {
    const f = await betavexFinding();
    const { link } = await raise(f);
    await decide(db, { proposalId: link.proposalId, actor: "OWN-R", action: "reject", reason: "Fixture: keep both." }, await today());
    const read = (await listFindings(db, { assetId: "AST-2" })).findings.find((x) => x.findingId === f.findingId)!;
    assert.deepEqual([read.proposalId, read.proposal?.outcome], [null, "rejected"]);
    const r = await runReassessment(db, { actor: "manager", compare: noOverlap });
    assert.deepEqual(r.summary!.reassessment!.staleProposals.filter((s) => s.proposalId === link.proposalId), []);
  });
});

describe("schema upgrades across branch shapes", () => {
  it("B1-only database (old findings table, no writer index, no link table) upgrades in place; idempotent", async () => {
    await ensureScheduler(db);
    await db.execute(`DROP TABLE scheduler_finding_proposals`);
    await db.execute(`DROP INDEX scheduler_runs_one_finding_writer`);
    await db.execute(`DROP TABLE scheduler_findings`);
    await db.execute(B1_FINDINGS_DDL);
    await db.execute(`INSERT INTO scheduler_findings (finding_id, dedup_key, rule_id, rule_version, asset_ids, status, evidence, fingerprint,
                        first_seen_at, first_seen_sim_date, first_run_id, last_seen_at, last_seen_sim_date, last_run_id, observations)
                      VALUES ('FND-b1', 'active_overlap:A|B', 'active_overlap', 'overlap-v2', '["A","B"]', 'open', '{}', 'fp',
                        't', '2026-11-01', 'SCH-1', 't', '2026-11-01', 'SCH-1', 1)`);
    await ensureScheduler(db);
    assert.match((await tableSql("scheduler_findings"))!, /resolution TEXT, dismissed_evidence TEXT/);
    assert.ok(await tableSql("scheduler_finding_proposals"));
    assert.ok(await tableSql("scheduler_runs_one_finding_writer"));
    assert.equal((await getFinding(db, "FND-b1"))?.status, "open");
    await ensureScheduler(db);
    assert.equal((await listFindings(db, {})).total, 1);
  });

  it("B3-style database (B1 findings table plus links) keeps its links through the findings rebuild", async () => {
    const f = await betavexFinding();
    const { link } = await raise(f);
    // Recreate the B3 branch shape: B1 findings definition, link table present.
    const cols = "finding_id, dedup_key, rule_id, rule_version, asset_ids, status, evidence, fingerprint, first_seen_at, first_seen_sim_date, first_run_id, last_seen_at, last_seen_sim_date, last_run_id, observations, dismissed_by, dismissed_reason, dismissed_at, dismissed_sim_date, dismissed_fingerprint, proposal_id";
    await db.execute(`CREATE TABLE findings_keep AS SELECT ${cols} FROM scheduler_findings`);
    await db.execute(`DROP TABLE scheduler_findings`);
    await db.execute(B1_FINDINGS_DDL);
    await db.execute(`INSERT INTO scheduler_findings (${cols}) SELECT ${cols} FROM findings_keep`);
    await db.execute(`DROP TABLE findings_keep`);
    await ensureScheduler(db);
    const now = (await getFinding(db, f.findingId))!;
    assert.deepEqual([now.status, now.proposalId, now.proposal?.outcome], ["open", link.proposalId, "pending"]);
  });

  it("demo reset clears every scheduler table including links, and the next ensure recreates them empty", async () => {
    const f = await betavexFinding();
    await raise(f);
    await resetLifecycle(db, 0);
    await ensureScheduler(db);
    for (const t of ["scheduler_runs", "scheduler_checkpoints", "scheduler_findings", "scheduler_finding_proposals"]) {
      assert.equal(Number((await db.execute(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n), 0, t);
    }
    assert.equal(Number((await db.execute(`SELECT COUNT(*) AS n FROM proposals WHERE type = 'merge'`)).rows[0].n), 0);
  });
});

describe("shared merge approvers (estate/merge.ts; MERGE-APPROVERS)", () => {
  async function withOwners(inactive: string[], fn: () => Promise<void>) {
    const ids = inactive.map(() => "?").join(", ");
    await db.execute({ sql: `UPDATE Owners SET status = 'inactive' WHERE owner_id IN (${ids})`, args: inactive });
    try {
      await fn();
    } finally {
      await db.execute({ sql: `UPDATE Owners SET status = 'active' WHERE owner_id IN (${ids})`, args: inactive });
    }
  }

  it("two active owners: both must approve (existing semantics)", async () => {
    const p = await proposeMerge(db, { sourceId: "AST-2", targetId: "AST-3" }, DAY);
    assert.deepEqual([...p.requiredApprovers].sort(), ["OWN-1", "OWN-R"]);
  });

  it("inactive source owner with an active region steward: the steward represents the source", async () => {
    await withOwners(["OWN-R"], async () => {
      const p = await proposeMerge(db, { sourceId: "AST-2", targetId: "AST-3" }, DAY);
      assert.deepEqual([...p.requiredApprovers].sort(), ["OWN-1", "OWN-S"]);
    });
  });

  const count = async (sql: string) => Number((await db.execute(sql)).rows[0].n);
  const snapshot = async () => ({
    proposals: await count(`SELECT COUNT(*) AS n FROM proposals`),
    audit: await count(`SELECT COUNT(*) AS n FROM audit_log`),
    decisions: await count(`SELECT COUNT(*) AS n FROM decisions`),
  });

  for (const [what, inactive, side] of [
    ["the source (owner and steward inactive)", ["OWN-R", "OWN-S"], /source AST-2/],
    ["the target (owner and steward inactive)", ["OWN-1", "OWN-S"], /target AST-3/],
    ["both sides", ["OWN-R", "OWN-1", "OWN-S"], /source AST-2 and the target AST-3/],
  ] as const) {
    it(`no active approver for ${what}: creation is refused and nothing is written`, async () => {
      await withOwners([...inactive], async () => {
        const before = await snapshot();
        await assert.rejects(proposeMerge(db, { sourceId: "AST-2", targetId: "AST-3" }, DAY), (e: unknown) => {
          assert.ok(e instanceof Error);
          assert.match(e.message, side);
          assert.match(e.message, /no merge proposal was created/);
          return true;
        });
        assert.deepEqual(await snapshot(), before);
        assert.equal((await getAssetState(db, "AST-2"))?.status, "active");
      });
    });
  }

  it("one steward legitimately represents both sides: a single approval merges", async () => {
    await withOwners(["OWN-R", "OWN-1"], async () => {
      const p = await proposeMerge(db, { sourceId: "AST-2", targetId: "AST-3" }, DAY);
      assert.deepEqual(p.requiredApprovers, ["OWN-S"]);
      const ev = p.evidence as MergeEvidence;
      assert.deepEqual([ev.sourceApprover, ev.targetApprover], ["OWN-S", "OWN-S"]);
      await decide(db, { proposalId: p.id, actor: "OWN-S", action: "approve" }, DAY);
      assert.equal((await getAssetState(db, "AST-2"))?.status, "archived");
    });
  });

  it("two active owners: the first approval waits, the second merges", async () => {
    const p = await proposeMerge(db, { sourceId: "AST-2", targetId: "AST-3" }, DAY);
    await decide(db, { proposalId: p.id, actor: "OWN-1", action: "approve" }, DAY);
    assert.equal((await getAssetState(db, "AST-2"))?.status, "active");
    await decide(db, { proposalId: p.id, actor: "OWN-R", action: "approve" }, DAY);
    assert.equal((await getAssetState(db, "AST-2"))?.status, "archived");
    assert.equal((await getProposal(db, p.id))?.status, "approved");
  });

  for (const [what, sourceApprover] of [
    ["names no source approver", null],
    ["leaves the source approver out of required_approvers", "OWN-R"],
  ] as const) {
    it(`a legacy pending merge that ${what} cannot archive the source; it stays as stored and can be rejected`, async () => {
      const p = await proposeMerge(db, { sourceId: "AST-2", targetId: "AST-3" }, DAY);
      // Rewrite it into the shape the pre-fix service could store: target-only.
      const legacy = { ...(p.evidence as MergeEvidence), sourceApprover };
      await db.execute({
        sql: `UPDATE proposals SET evidence = ?, required_approvers = '["OWN-1"]' WHERE id = ?`,
        args: [JSON.stringify(legacy), p.id],
      });
      const stored = await db.execute({ sql: `SELECT evidence, required_approvers, status FROM proposals WHERE id = ?`, args: [p.id] });
      const before = await snapshot();
      await assert.rejects(decide(db, { proposalId: p.id, actor: "OWN-1", action: "approve" }, DAY), /cannot be approved/);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(
        (await db.execute({ sql: `SELECT evidence, required_approvers, status FROM proposals WHERE id = ?`, args: [p.id] })).rows,
        stored.rows,
        "row not rewritten",
      );
      assert.equal((await getAssetState(db, "AST-2"))?.status, "active");
      await decide(db, { proposalId: p.id, actor: "OWN-1", action: "reject", reason: "Legacy proposal without a source approver." }, DAY);
      assert.equal((await getProposal(db, p.id))?.status, "rejected");
      assert.equal((await getAssetState(db, "AST-2"))?.status, "active");
    });
  }
});

describe("combined reset and migration (B1 + B2 + B3 schema together)", () => {
  const n = async (sql: string) => Number((await db.execute(sql)).rows[0].n);

  it("a reset during a periodic run with a raised proposal commits nothing and releases the writer exclusion", async () => {
    const f = await betavexFinding();
    await raise(f);
    await assert.rejects(
      runReassessment(db, { actor: "manager", compare: noOverlap, beforeCommit: () => resetLifecycle(db, 0) }),
      (e: unknown) => e instanceof SchedulerError && e.code === "conflict",
    );
    await ensureScheduler(db);
    for (const t of ["scheduler_runs", "scheduler_checkpoints", "scheduler_findings", "scheduler_finding_proposals"]) {
      assert.equal(await n(`SELECT COUNT(*) AS n FROM ${t}`), 0, t);
    }
    assert.equal(await n(`SELECT COUNT(*) AS n FROM proposals WHERE type = 'merge'`), 0);
    // Neither finding-writing job is left blocked by the interrupted run.
    assert.equal((await runIncremental(db, { actor: "manager" })).status, "succeeded");
    assert.equal((await runReassessment(db, { actor: "manager" })).status, "succeeded");
  });

  it("one ensureScheduler upgrades a B1 database with concurrent running writers, a dismissed finding and no link table", async () => {
    await ensureScheduler(db);
    await db.execute(`DROP TABLE scheduler_finding_proposals`);
    await db.execute(`DROP INDEX scheduler_runs_one_finding_writer`);
    await db.execute(`DROP TABLE scheduler_findings`);
    await db.execute(B1_FINDINGS_DDL);
    await db.execute(`INSERT INTO scheduler_findings (finding_id, dedup_key, rule_id, rule_version, asset_ids, status, evidence, fingerprint,
                        first_seen_at, first_seen_sim_date, first_run_id, last_seen_at, last_seen_sim_date, last_run_id, observations,
                        dismissed_by, dismissed_reason, dismissed_at, dismissed_sim_date, dismissed_fingerprint)
                      VALUES ('FND-d', 'active_overlap:A|B', 'active_overlap', 'overlap-v2', '["A","B"]', 'dismissed', '{"verdict":"merge"}', 'fp',
                        't', '2026-11-01', 'SCH-1', 't', '2026-11-01', 'SCH-1', 2, 'manager', 'known', 't', '2026-11-01', 'fp')`);
    for (const [id, job, at] of [["SCH-old", "incremental_overlap", "2026-11-07T10:00:00Z"], ["SCH-new", "periodic_reassessment", "2026-11-07T10:05:00Z"]]) {
      await db.execute({
        sql: `INSERT INTO scheduler_runs (run_id, job_id, mode, trigger, actor, sim_date, status, started_at, from_audit_id, to_audit_id, rules, policy_version)
              VALUES (?, ?, 'manual', 'manual', 'manager', '2026-11-07', 'running', ?, 0, 0, '[]', 'p')`,
        args: [id, job, at],
      });
    }
    await ensureScheduler(db);
    const runs = (await db.execute(`SELECT run_id, status, error FROM scheduler_runs ORDER BY run_id`)).rows;
    assert.deepEqual(runs.map((r) => [r.run_id, r.status]), [["SCH-new", "failed"], ["SCH-old", "running"]], "oldest writer kept");
    assert.match(String(runs[0].error), /abandoned/);
    const f = (await getFinding(db, "FND-d"))!;
    assert.deepEqual([f.status, f.dismissal?.reason, f.dismissal?.evidence, f.proposal, f.resolution], ["dismissed", "known", { verdict: "merge" }, null, null]);
    assert.ok(await tableSql("scheduler_finding_proposals"));
    await assert.rejects(
      db.execute(`INSERT INTO scheduler_runs (run_id, job_id, mode, trigger, actor, sim_date, status, started_at, from_audit_id, to_audit_id, rules, policy_version)
                  VALUES ('SCH-x', 'periodic_reassessment', 'manual', 'manual', 'manager', '2026-11-07', 'running', 't', 0, 0, '[]', 'p')`),
      /UNIQUE/,
    );
    const before = await db.execute(`SELECT * FROM scheduler_runs ORDER BY run_id`);
    await ensureScheduler(db);
    assert.deepEqual((await db.execute(`SELECT * FROM scheduler_runs ORDER BY run_id`)).rows, before.rows, "idempotent");
  });
});

describe("imported catalog data", () => {
  const CATALOG = ["Analytics_Assets", "Asset_KPI_Map", "Owners", "Asset_Usage", "Lineage_Edges"];
  const snapshot = async () =>
    Object.fromEntries(await Promise.all(CATALOG.map(async (t) => [t, (await db.execute(`SELECT * FROM ${t} ORDER BY rowid`)).rows] as const)));

  it("a full scheduler cycle (incremental, raise, preview, periodic, dismiss) leaves the imported sheets unchanged", async () => {
    const f = await betavexFinding();
    const before = await snapshot();
    await previewFindingProposal(db, { findingId: f.findingId });
    await raise(f);
    await runReassessment(db, { actor: "manager" });
    await runIncremental(db, { actor: "manager" });
    const open = (await listFindings(db, { status: "open" })).findings;
    for (const x of open) await dismissFinding(db, { findingId: x.findingId, actor: "manager", reason: "Fixture: known overlap." });
    assert.deepEqual(await snapshot(), before);
  });
});

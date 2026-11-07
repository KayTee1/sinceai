// Scheduler-owned tables (T24). Created on demand; never part of the pack.
//
// Reset safety: resetLifecycle drops these tables in the same write batch as
// audit_log (they are listed in lifecycle/schema.ts APP_TABLES). Audit IDs
// restart at 1 after a reset, so a checkpoint, a run or a finding from before
// the reset must not survive it; dropping them together is the generation
// boundary. A run that was in flight during a reset cannot commit afterwards:
// its run row no longer exists (see runs.ts commitRun).
import type { Client, Transaction } from "@libsql/client";
import { writeTx } from "./db";
import type { JobId } from "./types";

export const SCHEDULER_TABLES = ["scheduler_runs", "scheduler_checkpoints", "scheduler_findings", "scheduler_finding_proposals"] as const;

/**
 * Jobs that write findings (incremental observes, periodic resolves). They
 * must not run concurrently (Codex B2-F1): an incremental run that evaluated
 * an overlap before an asset was archived could otherwise commit after a
 * periodic run resolved that finding, and reopen it on stale evidence.
 * Serialising them is enough for the prototype.
 */
export const FINDING_WRITER_JOBS: readonly JobId[] = ["incremental_overlap", "periodic_reassessment"];

/**
 * Database-enforced exclusion: a unique index on `status` over running runs of
 * finding-writing jobs. Every indexed row has status 'running', so the index
 * admits one row: a second running finding writer violates it whatever path
 * inserted it. A run that ends (succeeded, failed, abandoned) leaves the index,
 * which releases the exclusion.
 */
export const FINDING_WRITER_INDEX = "scheduler_runs_one_finding_writer";
const FINDING_WRITER_INDEX_DDL = `CREATE UNIQUE INDEX IF NOT EXISTS ${FINDING_WRITER_INDEX} ON scheduler_runs (status)
  WHERE status = 'running' AND job_id IN (${FINDING_WRITER_JOBS.map((j) => `'${j}'`).join(", ")})`;

const DDL = [
  `CREATE TABLE IF NOT EXISTS scheduler_runs (
     run_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, mode TEXT NOT NULL, trigger TEXT NOT NULL, actor TEXT NOT NULL,
     sim_date TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
     started_at TEXT NOT NULL, completed_at TEXT, from_audit_id INTEGER NOT NULL, to_audit_id INTEGER NOT NULL,
     rules TEXT NOT NULL, policy_version TEXT NOT NULL, summary TEXT, error TEXT)`,
  // At most one running run per job: the database refuses a second claim.
  `CREATE UNIQUE INDEX IF NOT EXISTS scheduler_runs_one_running ON scheduler_runs (job_id) WHERE status = 'running'`,
  // Codex B2-F1: at most one running run across ALL finding-writing jobs (see FINDING_WRITER_INDEX).
  FINDING_WRITER_INDEX_DDL,
  `CREATE INDEX IF NOT EXISTS scheduler_runs_started ON scheduler_runs (started_at)`,
  `CREATE TABLE IF NOT EXISTS scheduler_checkpoints (
     job_id TEXT PRIMARY KEY, last_audit_id INTEGER NOT NULL, run_id TEXT, updated_at TEXT NOT NULL)`,
  findingsDdl("scheduler_findings"),
  // B3: proposals raised from findings (proposals.ts). Outcome is a cache of the proposals table, written by syncFindingProposals.
  `CREATE TABLE IF NOT EXISTS scheduler_finding_proposals (
     link_id TEXT PRIMARY KEY, finding_id TEXT NOT NULL, proposal_id TEXT NOT NULL UNIQUE,
     action TEXT NOT NULL CHECK (action IN ('merge')), source_id TEXT NOT NULL, target_id TEXT NOT NULL, actor TEXT NOT NULL,
     created_at TEXT NOT NULL, sim_date TEXT NOT NULL, fingerprint TEXT NOT NULL, evidence TEXT NOT NULL,
     outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'approved', 'rejected', 'expired', 'missing')), outcome_synced_at TEXT)`,
  // At most one pending proposal per finding.
  `CREATE UNIQUE INDEX IF NOT EXISTS scheduler_finding_proposals_one_pending ON scheduler_finding_proposals (finding_id) WHERE outcome = 'pending'`,
];

// B2 (Mode 3): statuses resolved / superseded and the `resolution` column
// (JSON FindingResolution, set while resolved). B1 databases have the old
// status CHECK, which CREATE TABLE IF NOT EXISTS keeps, so ensureScheduler
// rebuilds that table (rows preserved) when it finds the old definition.
// B2-F2: `dismissed_evidence` (JSON OverlapEvidence) keeps the evidence a
// finding was dismissed on, apart from `evidence`, which every observation
// refreshes. Added by ALTER TABLE to a B2 table without it, and backfilled
// (see backfillDismissedEvidence).
function findingsDdl(name: string, ifNotExists = true) {
  return `CREATE TABLE ${ifNotExists ? "IF NOT EXISTS " : ""}${name} (
     finding_id TEXT PRIMARY KEY, dedup_key TEXT NOT NULL UNIQUE, rule_id TEXT NOT NULL, rule_version TEXT NOT NULL,
     asset_ids TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('open', 'dismissed', 'resolved', 'superseded')),
     evidence TEXT NOT NULL, fingerprint TEXT NOT NULL,
     first_seen_at TEXT NOT NULL, first_seen_sim_date TEXT NOT NULL, first_run_id TEXT NOT NULL,
     last_seen_at TEXT NOT NULL, last_seen_sim_date TEXT NOT NULL, last_run_id TEXT NOT NULL,
     observations INTEGER NOT NULL,
     dismissed_by TEXT, dismissed_reason TEXT, dismissed_at TEXT, dismissed_sim_date TEXT, dismissed_fingerprint TEXT,
     proposal_id TEXT, resolution TEXT, dismissed_evidence TEXT)`;
}

/** B1 columns, copied as they are when an old findings table is rebuilt. */
const B1_FINDING_COLUMNS = [
  "finding_id", "dedup_key", "rule_id", "rule_version", "asset_ids", "status", "evidence", "fingerprint",
  "first_seen_at", "first_seen_sim_date", "first_run_id", "last_seen_at", "last_seen_sim_date", "last_run_id",
  "observations", "dismissed_by", "dismissed_reason", "dismissed_at", "dismissed_sim_date", "dismissed_fingerprint", "proposal_id",
].join(", ");

/** The stored findings table predates B2 (old status CHECK or no resolution column). */
const isOldFindings = (sql: string | undefined) => !!sql && (!/'resolved'/.test(sql) || !/\bresolution\b/.test(sql));
/** The stored findings table lacks the B2-F2 dismissed_evidence column (rebuilt B1 tables get it from findingsDdl). */
const lacksDismissedEvidence = (sql: string | undefined) => !!sql && !/\bdismissed_evidence\b/.test(sql);

async function findingsSql(db: Client | Transaction): Promise<string | undefined> {
  const r = await db.execute(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'scheduler_findings'`);
  return (r.rows[0]?.sql as string | undefined) ?? undefined;
}

/**
 * Creates the scheduler tables if missing and upgrades a B1 findings table.
 * Safe to call on every request; writes only when a table is missing or old.
 */
export async function ensureScheduler(db: Client): Promise<void> {
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN (${SCHEDULER_TABLES.map(() => "?").join(", ")})`,
    args: [...SCHEDULER_TABLES],
  });
  const current = await findingsSql(db);
  if (Number(r.rows[0]?.n) === SCHEDULER_TABLES.length && !isOldFindings(current) && !lacksDismissedEvidence(current) && (await hasWriterIndex(db))) {
    return;
  }
  await writeTx(db, async (tx) => {
    // Checked again inside the write transaction: another connection may have upgraded it meanwhile.
    const sql = await findingsSql(tx);
    if (isOldFindings(sql)) await rebuildFindings(tx);
    else if (lacksDismissedEvidence(sql)) await tx.execute(`ALTER TABLE scheduler_findings ADD COLUMN dismissed_evidence TEXT`);
    if (sql && (isOldFindings(sql) || lacksDismissedEvidence(sql))) await backfillDismissedEvidence(tx);
    if (!(await hasWriterIndex(tx))) await releaseConcurrentWriters(tx);
    for (const ddl of DDL) await tx.execute(ddl);
  });
}

/**
 * Upgrade step for B2-F2. Before it, a dismissed finding's `evidence` was
 * never refreshed while it stayed dismissed or resolved, so for every row that
 * still carries a dismissal it IS the evidence it was dismissed on.
 */
async function backfillDismissedEvidence(tx: Transaction) {
  await tx.execute(`UPDATE scheduler_findings SET dismissed_evidence = evidence WHERE dismissed_by IS NOT NULL AND dismissed_evidence IS NULL`);
}

async function hasWriterIndex(db: Client | Transaction): Promise<boolean> {
  const r = await db.execute({ sql: `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?`, args: [FINDING_WRITER_INDEX] });
  return r.rows.length > 0;
}

/**
 * Upgrade step for the finding-writer index (B2-F1). A database from before it
 * may hold running runs of both finding-writing jobs, which would make the
 * unique index fail to build (and every request with it). All but the oldest
 * are abandoned here, so their late commit is refused like any abandoned run's.
 * No audit row (table setup must not depend on the lifecycle tables); the
 * run's error records who and why.
 */
async function releaseConcurrentWriters(tx: Transaction) {
  const runs = await tx.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scheduler_runs'`);
  if (!runs.rows.length) return;
  const nowIso = new Date().toISOString();
  const error = JSON.stringify({
    code: "abandoned",
    stage: "recovery",
    message: "Abandoned by the scheduler upgrade: finding-writing jobs no longer run concurrently (Codex B2-F1).",
    at: nowIso,
    actor: "scheduler",
  });
  const jobs = FINDING_WRITER_JOBS.map(() => "?").join(", ");
  await tx.execute({
    sql: `UPDATE scheduler_runs SET status = 'failed', completed_at = ?, error = ?
          WHERE status = 'running' AND job_id IN (${jobs})
            AND rowid <> (SELECT rowid FROM scheduler_runs WHERE status = 'running' AND job_id IN (${jobs}) ORDER BY started_at, rowid LIMIT 1)`,
    args: [nowIso, error, ...FINDING_WRITER_JOBS, ...FINDING_WRITER_JOBS],
  });
}

/** Rebuilds a B1 findings table with the current definition, keeping every row (one write transaction; all or nothing). */
async function rebuildFindings(tx: Transaction) {
  await tx.execute(`DROP TABLE IF EXISTS scheduler_findings_b2`);
  await tx.execute(findingsDdl("scheduler_findings_b2", false));
  await tx.execute(`INSERT INTO scheduler_findings_b2 (${B1_FINDING_COLUMNS}) SELECT ${B1_FINDING_COLUMNS} FROM scheduler_findings`);
  await tx.execute(`DROP TABLE scheduler_findings`);
  await tx.execute(`ALTER TABLE scheduler_findings_b2 RENAME TO scheduler_findings`);
}

/** Tests only: the B1 findings definition, to check the upgrade. */
export const B1_FINDINGS_DDL = `CREATE TABLE scheduler_findings (
     finding_id TEXT PRIMARY KEY, dedup_key TEXT NOT NULL UNIQUE, rule_id TEXT NOT NULL, rule_version TEXT NOT NULL,
     asset_ids TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('open', 'dismissed')),
     evidence TEXT NOT NULL, fingerprint TEXT NOT NULL,
     first_seen_at TEXT NOT NULL, first_seen_sim_date TEXT NOT NULL, first_run_id TEXT NOT NULL,
     last_seen_at TEXT NOT NULL, last_seen_sim_date TEXT NOT NULL, last_run_id TEXT NOT NULL,
     observations INTEGER NOT NULL,
     dismissed_by TEXT, dismissed_reason TEXT, dismissed_at TEXT, dismissed_sim_date TEXT, dismissed_fingerprint TEXT,
     proposal_id TEXT)`;

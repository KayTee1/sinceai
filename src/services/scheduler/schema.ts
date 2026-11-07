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

export const SCHEDULER_TABLES = ["scheduler_runs", "scheduler_checkpoints", "scheduler_findings"] as const;

const DDL = [
  `CREATE TABLE IF NOT EXISTS scheduler_runs (
     run_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, mode TEXT NOT NULL, trigger TEXT NOT NULL, actor TEXT NOT NULL,
     sim_date TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
     started_at TEXT NOT NULL, completed_at TEXT, from_audit_id INTEGER NOT NULL, to_audit_id INTEGER NOT NULL,
     rules TEXT NOT NULL, policy_version TEXT NOT NULL, summary TEXT, error TEXT)`,
  // At most one running run per job: the database refuses a second claim.
  `CREATE UNIQUE INDEX IF NOT EXISTS scheduler_runs_one_running ON scheduler_runs (job_id) WHERE status = 'running'`,
  `CREATE INDEX IF NOT EXISTS scheduler_runs_started ON scheduler_runs (started_at)`,
  `CREATE TABLE IF NOT EXISTS scheduler_checkpoints (
     job_id TEXT PRIMARY KEY, last_audit_id INTEGER NOT NULL, run_id TEXT, updated_at TEXT NOT NULL)`,
  findingsDdl("scheduler_findings"),
];

// B2 (Mode 3): statuses resolved / superseded and the `resolution` column
// (JSON FindingResolution, set while resolved). B1 databases have the old
// status CHECK, which CREATE TABLE IF NOT EXISTS keeps, so ensureScheduler
// rebuilds that table (rows preserved) when it finds the old definition.
function findingsDdl(name: string, ifNotExists = true) {
  return `CREATE TABLE ${ifNotExists ? "IF NOT EXISTS " : ""}${name} (
     finding_id TEXT PRIMARY KEY, dedup_key TEXT NOT NULL UNIQUE, rule_id TEXT NOT NULL, rule_version TEXT NOT NULL,
     asset_ids TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('open', 'dismissed', 'resolved', 'superseded')),
     evidence TEXT NOT NULL, fingerprint TEXT NOT NULL,
     first_seen_at TEXT NOT NULL, first_seen_sim_date TEXT NOT NULL, first_run_id TEXT NOT NULL,
     last_seen_at TEXT NOT NULL, last_seen_sim_date TEXT NOT NULL, last_run_id TEXT NOT NULL,
     observations INTEGER NOT NULL,
     dismissed_by TEXT, dismissed_reason TEXT, dismissed_at TEXT, dismissed_sim_date TEXT, dismissed_fingerprint TEXT,
     proposal_id TEXT, resolution TEXT)`;
}

/** B1 columns, copied as they are when an old findings table is rebuilt. */
const B1_FINDING_COLUMNS = [
  "finding_id", "dedup_key", "rule_id", "rule_version", "asset_ids", "status", "evidence", "fingerprint",
  "first_seen_at", "first_seen_sim_date", "first_run_id", "last_seen_at", "last_seen_sim_date", "last_run_id",
  "observations", "dismissed_by", "dismissed_reason", "dismissed_at", "dismissed_sim_date", "dismissed_fingerprint", "proposal_id",
].join(", ");

/** The stored findings table predates B2 (old status CHECK or no resolution column). */
const isOldFindings = (sql: string | undefined) => !!sql && (!/'resolved'/.test(sql) || !/\bresolution\b/.test(sql));

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
  if (Number(r.rows[0]?.n) === SCHEDULER_TABLES.length && !isOldFindings(await findingsSql(db))) return;
  await writeTx(db, async (tx) => {
    // Checked again inside the write transaction: another connection may have upgraded it meanwhile.
    if (isOldFindings(await findingsSql(tx))) await rebuildFindings(tx);
    for (const sql of DDL) await tx.execute(sql);
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

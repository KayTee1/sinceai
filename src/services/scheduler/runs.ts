// Run lifecycle: claim -> (read-only evaluation, elsewhere) -> commit or fail.
//
// Each step is its own short transaction; no write transaction is held while
// the estate is compared.
//
// - claimRun: one write transaction reads the checkpoint, fixes the window's
//   upper bound (MAX(audit_log.id)) and inserts the running row. Because it is
//   a write transaction, no other writer is mid-flight, so no audit row with a
//   lower ID can appear after the bound is read. A partial unique index allows
//   one running run per job; a second claim is refused (conflict).
// - commitRun: one write transaction marks the run succeeded only if it is
//   still running, advances the checkpoint only if it still equals the run's
//   window start (compare-and-set), and writes findings via `apply`. Any
//   failure rolls all of it back.
// - failRun: marks a running run failed; a no-op if it is no longer running.
// - abandonRun: recovery after a crash. No automatic stale timeout: the
//   prototype has no heartbeat to tell a crashed run from a slow one, so a
//   manager abandons it explicitly (audited). A run that was in fact still
//   alive then fails at commit, because it is no longer running.
import { randomUUID } from "node:crypto";
import type { Client, Transaction } from "@libsql/client";
import { POLICY_VERSION, appendAudit, readClock } from "../lifecycle";
import { writeOne, writeTx } from "./db";
import { ensureScheduler } from "./schema";
import {
  SchedulerError,
  type ChangeWindow,
  type JobId,
  type RuleRef,
  type RunError,
  type RunStatus,
  type RunSummary,
  type SchedulerMode,
  type SchedulerRun,
  type TriggerSource,
} from "./types";

type Row = Record<string, unknown>;

const parse = <T>(v: unknown): T | null => (typeof v === "string" && v ? (JSON.parse(v) as T) : null);

function toRun(r: Row): SchedulerRun {
  return {
    runId: r.run_id as string,
    jobId: r.job_id as JobId,
    mode: r.mode as SchedulerMode,
    trigger: r.trigger as TriggerSource,
    actor: r.actor as string,
    simDate: r.sim_date as string,
    status: r.status as RunStatus,
    startedAt: r.started_at as string,
    completedAt: (r.completed_at as string | null) ?? null,
    window: { fromAuditId: Number(r.from_audit_id), toAuditId: Number(r.to_audit_id) },
    rules: parse<RuleRef[]>(r.rules) ?? [],
    policyVersion: r.policy_version as string,
    summary: parse<RunSummary>(r.summary),
    error: parse<RunError>(r.error),
  };
}

async function runningRun(db: Client | Transaction, jobId: JobId): Promise<SchedulerRun | null> {
  const r = await db.execute({ sql: `SELECT * FROM scheduler_runs WHERE job_id = ? AND status = 'running'`, args: [jobId] });
  return r.rows[0] ? toRun(r.rows[0] as Row) : null;
}

export type ClaimInput = { jobId: JobId; mode: SchedulerMode; trigger: TriggerSource; actor: string; rules: RuleRef[] };

/** Starts a run, or refuses with `conflict` while another run of the job is running. */
export async function claimRun(db: Client, input: ClaimInput, nowIso = new Date().toISOString()): Promise<SchedulerRun> {
  const actor = input.actor.trim();
  if (!actor) throw new SchedulerError("actor is required", "invalid");
  await ensureScheduler(db);
  try {
    const runId = await writeTx(db, async (tx) => {
      const running = await runningRun(tx, input.jobId);
      if (running) {
        throw new SchedulerError(`Run ${running.runId} is still running`, "conflict", { runningRunId: running.runId });
      }
      const clock = await readClock(tx);
      const cp = await tx.execute({ sql: `SELECT last_audit_id FROM scheduler_checkpoints WHERE job_id = ?`, args: [input.jobId] });
      let from = 0;
      if (cp.rows[0]) from = Number(cp.rows[0].last_audit_id);
      else {
        // First run since the scheduler tables were created (or since a reset): start at the beginning of this audit log.
        await tx.execute({
          sql: `INSERT INTO scheduler_checkpoints (job_id, last_audit_id, run_id, updated_at) VALUES (?, 0, NULL, ?)`,
          args: [input.jobId, nowIso],
        });
      }
      const max = await tx.execute(`SELECT COALESCE(MAX(id), 0) AS m FROM audit_log`);
      const to = Number(max.rows[0]?.m ?? 0);
      if (from > to) {
        // Cannot happen when reset drops scheduler tables with the audit log; refuse rather than skip changes.
        throw new SchedulerError(
          `Checkpoint ${from} is ahead of the audit log (${to}); the audit log was replaced without resetting the scheduler`,
          "conflict",
        );
      }
      const id = `SCH-${randomUUID()}`;
      await tx.execute({
        sql: `INSERT INTO scheduler_runs (run_id, job_id, mode, trigger, actor, sim_date, status, started_at, from_audit_id, to_audit_id, rules, policy_version)
              VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
        args: [id, input.jobId, input.mode, input.trigger, actor, clock.date, nowIso, from, to, JSON.stringify(input.rules), POLICY_VERSION],
      });
      return id;
    });
    return (await getRun(db, runId))!;
  } catch (err) {
    if (/UNIQUE constraint failed: scheduler_runs\.job_id/i.test(String((err as Error).message))) {
      throw new SchedulerError("Another run of this job started at the same time", "conflict");
    }
    throw err;
  }
}

/**
 * Commits a run's results atomically: findings (via `apply`), the run as
 * succeeded and the checkpoint moved to the window's end. Refuses (and
 * changes nothing) if the run is no longer running or the checkpoint moved.
 */
export async function commitRun(
  db: Client,
  run: SchedulerRun,
  apply: (tx: Transaction) => Promise<RunSummary>,
  nowIso = new Date().toISOString(),
): Promise<SchedulerRun> {
  await writeTx(db, async (tx) => {
    const summary = await apply(tx);
    const done = await tx.execute({
      sql: `UPDATE scheduler_runs SET status = 'succeeded', completed_at = ?, summary = ? WHERE run_id = ? AND status = 'running'`,
      args: [nowIso, JSON.stringify(summary), run.runId],
    });
    if (done.rowsAffected !== 1) {
      throw new SchedulerError(`Run ${run.runId} is no longer running (abandoned, already finished or reset)`, "conflict");
    }
    const cp = await tx.execute({
      sql: `UPDATE scheduler_checkpoints SET last_audit_id = ?, run_id = ?, updated_at = ? WHERE job_id = ? AND last_audit_id = ?`,
      args: [run.window.toAuditId, run.runId, nowIso, run.jobId, run.window.fromAuditId],
    });
    if (cp.rowsAffected !== 1) {
      throw new SchedulerError(`Checkpoint for ${run.jobId} moved during run ${run.runId}`, "conflict");
    }
  });
  return (await getRun(db, run.runId))!;
}

/** Records a failure. Returns false (and changes nothing) if the run is not running. Never moves the checkpoint. */
export async function failRun(db: Client, runId: string, error: Omit<RunError, "at">, nowIso = new Date().toISOString()): Promise<boolean> {
  const r = await writeOne(db, {
    sql: `UPDATE scheduler_runs SET status = 'failed', completed_at = ?, error = ? WHERE run_id = ? AND status = 'running'`,
    args: [nowIso, JSON.stringify({ ...error, at: nowIso }), runId],
  });
  return r.rowsAffected === 1;
}

/** Manual recovery for a run left running by a crash (audited). Its later commit, if any, is refused. */
export async function abandonRun(
  db: Client,
  input: { runId: string; actor: string; reason: string },
  nowIso = new Date().toISOString(),
): Promise<SchedulerRun> {
  const actor = input.actor.trim();
  const reason = input.reason.trim();
  if (!actor) throw new SchedulerError("actor is required", "invalid");
  if (!reason) throw new SchedulerError("A reason is required to abandon a run", "invalid");
  await ensureScheduler(db);
  await writeTx(db, async (tx) => {
    const error: RunError = { code: "abandoned", stage: "recovery", message: reason, at: nowIso, actor };
    const r = await tx.execute({
      sql: `UPDATE scheduler_runs SET status = 'failed', completed_at = ?, error = ? WHERE run_id = ? AND status = 'running'`,
      args: [nowIso, JSON.stringify(error), input.runId],
    });
    if (r.rowsAffected !== 1) {
      const exists = await tx.execute({ sql: `SELECT status FROM scheduler_runs WHERE run_id = ?`, args: [input.runId] });
      if (!exists.rows[0]) throw new SchedulerError(`Unknown run ${input.runId}`, "not_found");
      throw new SchedulerError(`Run ${input.runId} is not running (${exists.rows[0].status})`, "conflict");
    }
    await appendAudit(tx, {
      simDate: (await readClock(tx)).date,
      actor,
      action: "scheduler_run_abandoned",
      policyVersion: POLICY_VERSION,
      rationale: `Scheduler run ${input.runId} abandoned: ${reason}. Its checkpoint was not advanced.`,
      evidence: { runId: input.runId },
    });
  });
  return (await getRun(db, input.runId))!;
}

export async function getRun(db: Client, runId: string): Promise<SchedulerRun | null> {
  await ensureScheduler(db);
  const r = await db.execute({ sql: `SELECT * FROM scheduler_runs WHERE run_id = ?`, args: [runId] });
  return r.rows[0] ? toRun(r.rows[0] as Row) : null;
}

/** Newest first. */
export async function listRuns(db: Client, input: { jobId?: JobId; limit?: number } = {}): Promise<SchedulerRun[]> {
  await ensureScheduler(db);
  const limit = Math.min(Math.max(1, Math.floor(input.limit ?? 20)), 200);
  const r = input.jobId
    ? await db.execute({ sql: `SELECT * FROM scheduler_runs WHERE job_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?`, args: [input.jobId, limit] })
    : await db.execute({ sql: `SELECT * FROM scheduler_runs ORDER BY started_at DESC, rowid DESC LIMIT ?`, args: [limit] });
  return r.rows.map((x) => toRun(x as Row));
}

export type RunCounts = Record<RunStatus, number> & { total: number };

export async function countRuns(db: Client, jobId?: JobId): Promise<RunCounts> {
  await ensureScheduler(db);
  const r = jobId
    ? await db.execute({ sql: `SELECT status, COUNT(*) AS n FROM scheduler_runs WHERE job_id = ? GROUP BY status`, args: [jobId] })
    : await db.execute(`SELECT status, COUNT(*) AS n FROM scheduler_runs GROUP BY status`);
  const out: RunCounts = { running: 0, succeeded: 0, failed: 0, total: 0 };
  for (const x of r.rows) {
    out[x.status as RunStatus] = Number(x.n);
    out.total += Number(x.n);
  }
  return out;
}

export async function getCheckpoint(db: Client, jobId: JobId): Promise<{ lastAuditId: number; runId: string | null; updatedAt: string } | null> {
  await ensureScheduler(db);
  const r = await db.execute({ sql: `SELECT * FROM scheduler_checkpoints WHERE job_id = ?`, args: [jobId] });
  const x = r.rows[0];
  return x ? { lastAuditId: Number(x.last_audit_id), runId: (x.run_id as string | null) ?? null, updatedAt: x.updated_at as string } : null;
}

export type { ChangeWindow };

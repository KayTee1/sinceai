// B5 (T26): run the governance jobs when they are due at the SIMULATED date.
//
// There is no cron and no background worker. `runSimulatedTriggers` is called
// at explicit moments: after a manager clock action (advance, next event,
// pause, resume; app/api/clock/shared.ts, only with SCHEDULER_SIM_TRIGGER=1
// and SCHEDULER_DEMO_ACTIONS=1) and from the Scheduler tab's "Check due jobs"
// action. It reads the stored clock date and never ticks or changes the clock
// (real-time semantics stay as they were). While the clock runs freely
// (1 day/s), nothing runs until the next clock action or check.
//
// Per job, in order (incremental first, so a change seen today is a finding
// before the reassessment looks at known findings):
//   already_processed  a run this job started from the simulated clock already
//                      SUCCEEDED at this simulated date: nothing runs (idempotent
//                      for repeated triggers of the same day). A failed run does
//                      not count, so the next trigger retries it (recovery).
//   deferred           another finding-writing run is in progress (manual or
//                      simulated), or the claim lost a race: nothing runs; the
//                      next trigger looks again. Runs never overlap (runs.ts).
//   not_due            incremental: no watched estate change since the
//                      checkpoint. periodic: reassessmentDue() says no.
//   ran                the job ran through runIncremental / runReassessment
//                      (unchanged B1 / B2 logic) with trigger simulated_clock;
//                      the run is succeeded or failed (failure recorded on it).
//
// "Due" is state-based, with no cadence: incremental is due when there are
// watched changes to evaluate, periodic when reassessmentDue() says the date
// moved past the last successful reassessment. The optional demo cadence
// (SCHEDULER_SIM_REASSESS_DAYS) only spaces out periodic reassessments for a
// demo; it is unset by default and is not a production policy. It has nothing
// to do with the 90-day usage window or the 30-day Temporary TTL.
//
// New changes after a successful simulated incremental run on the same date
// wait for the next simulated date (or a manual run). No proposal is ever
// raised, decided, merged or retired here (B3 stays disabled).
import type { Client } from "@libsql/client";
import { readClock } from "../lifecycle";
import { addDays } from "../lifecycle/policy";
import { writeTx } from "./db";
import { INCREMENTAL_JOB, WATCHED_ACTIONS, runIncremental } from "./incremental";
import { PERIODIC_JOB, readReassessmentDueState, reassessmentDue, runReassessment } from "./reassessment";
import { getRun } from "./runs";
import { FINDING_WRITER_JOBS, ensureScheduler } from "./schema";
import { SchedulerError, type JobId, type SchedulerRun } from "./types";
import type { Comparator } from "./overlap";

export const SIM_TRIGGER_ENV = "SCHEDULER_SIM_TRIGGER";
export const SIM_REASSESS_DAYS_ENV = "SCHEDULER_SIM_REASSESS_DAYS";
/** Actor recorded on runs the simulated clock starts. */
export const SIM_ACTOR = "simulated-clock";

export type SimTriggerSource = "clock_action" | "manual_check";
export type SimDecisionKind = "ran" | "not_due" | "already_processed" | "deferred";

export type SimDecision = {
  jobId: JobId;
  decision: SimDecisionKind;
  reason: string;
  /** The run started now (ran), the one that already covered this date (already_processed), or the one in the way (deferred, if known). */
  run: SchedulerRun | null;
};

export type SimTriggerResult = { simDate: string; source: SimTriggerSource; decisions: SimDecision[] };

export type SimJobState = {
  jobId: JobId;
  /** Last simulated date this job was evaluated at by a simulated trigger, and the outcome. Null before the first. */
  last: { simDate: string; decision: SimDecisionKind; reason: string; runId: string | null; source: SimTriggerSource; updatedAt: string } | null;
  /** Read-only preview at the current stored date. */
  due: { due: boolean; reason: string };
};

export type SimSettings = {
  /** Clock actions trigger due jobs (SCHEDULER_SIM_TRIGGER=1 and the demo action gate). */
  autoOnClock: boolean;
  /** Demo-only minimum days between simulated periodic reassessments; null = no cadence (default). */
  reassessEveryDays: number | null;
};

export type SimStatus = { simDate: string; settings: SimSettings; jobs: SimJobState[] };

/** Reads the demo settings from the environment. Invalid cadence values are ignored (no cadence). */
export function simSettings(env: Record<string, string | undefined> = process.env): SimSettings {
  const raw = env[SIM_REASSESS_DAYS_ENV]?.trim();
  const n = raw ? Number(raw) : NaN;
  return {
    autoOnClock: env[SIM_TRIGGER_ENV] === "1" && env.SCHEDULER_DEMO_ACTIONS === "1",
    reassessEveryDays: Number.isInteger(n) && n >= 1 && n <= 365 ? n : null,
  };
}

export type SimOptions = {
  source: SimTriggerSource;
  /** Demo cadence for periodic reassessment (see simSettings); omit for none. */
  reassessEveryDays?: number | null;
  /** Tests only: replaces suggestMerge in both jobs. */
  compare?: Comparator;
  /** Tests only: called between evaluation and commit of each job run. */
  beforeCommit?: (jobId: JobId) => Promise<void>;
};

/** Watched estate changes the incremental job has not read yet. Read-only. */
async function pendingWatchedChanges(db: Client): Promise<number> {
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM audit_log
          WHERE id > COALESCE((SELECT last_audit_id FROM scheduler_checkpoints WHERE job_id = ?), 0)
            AND asset_id IS NOT NULL AND action IN (${WATCHED_ACTIONS.map(() => "?").join(", ")})`,
    args: [INCREMENTAL_JOB.jobId, ...WATCHED_ACTIONS],
  });
  return Number(r.rows[0]?.n ?? 0);
}

/** Is `jobId` due at the stored date? Read-only; same answer the trigger acts on. */
export async function jobDue(db: Client, jobId: JobId, reassessEveryDays: number | null = null): Promise<{ due: boolean; reason: string }> {
  if (jobId === INCREMENTAL_JOB.jobId) {
    const n = await pendingWatchedChanges(db);
    return n > 0
      ? { due: true, reason: `${n} watched estate change(s) (${WATCHED_ACTIONS.join(", ")}) since the last checkpoint.` }
      : { due: false, reason: "No watched estate change since the last checkpoint." };
  }
  const state = await readReassessmentDueState(db);
  const base = reassessmentDue(state);
  if (!base.due || !reassessEveryDays || !state.lastSucceededSimDate) return base;
  const next = addDays(state.lastSucceededSimDate, reassessEveryDays);
  if (state.simDate < next) {
    return { due: false, reason: `Demo cadence: every ${reassessEveryDays} simulated day(s); next on ${next} (last ${state.lastSucceededSimDate}).` };
  }
  return base;
}

async function succeededSimRunAt(db: Client, jobId: JobId, simDate: string): Promise<SchedulerRun | null> {
  const r = await db.execute({
    sql: `SELECT run_id FROM scheduler_runs WHERE job_id = ? AND trigger = 'simulated_clock' AND sim_date = ? AND status = 'succeeded'
          ORDER BY started_at DESC, rowid DESC LIMIT 1`,
    args: [jobId, simDate],
  });
  const id = r.rows[0]?.run_id as string | undefined;
  return id ? getRun(db, id) : null;
}

async function runningWriter(db: Client): Promise<SchedulerRun | null> {
  const r = await db.execute({
    sql: `SELECT run_id FROM scheduler_runs WHERE status = 'running' AND job_id IN (${FINDING_WRITER_JOBS.map(() => "?").join(", ")}) LIMIT 1`,
    args: [...FINDING_WRITER_JOBS],
  });
  const id = r.rows[0]?.run_id as string | undefined;
  return id ? getRun(db, id) : null;
}

async function record(db: Client, simDate: string, source: SimTriggerSource, d: SimDecision) {
  await writeTx(db, async (tx) => {
    await tx.execute({
      sql: `INSERT INTO scheduler_sim_state (job_id, sim_date, decision, reason, run_id, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (job_id) DO UPDATE SET sim_date = excluded.sim_date, decision = excluded.decision, reason = excluded.reason,
              run_id = excluded.run_id, source = excluded.source, updated_at = excluded.updated_at`,
      args: [d.jobId, simDate, d.decision, d.reason, d.run?.runId ?? null, source, new Date().toISOString()],
    });
  });
}

async function decideJob(db: Client, jobId: JobId, simDate: string, opts: SimOptions): Promise<SimDecision> {
  const done = await succeededSimRunAt(db, jobId, simDate);
  if (done) return { jobId, decision: "already_processed", reason: `Already ran from the simulated clock at ${simDate} (run ${done.runId}).`, run: done };
  const busy = await runningWriter(db);
  if (busy) {
    return { jobId, decision: "deferred", reason: `Run ${busy.runId} (${busy.jobId}, ${busy.trigger}) is in progress; finding-writing jobs run one at a time. Checked again at the next trigger.`, run: busy };
  }
  const due = await jobDue(db, jobId, opts.reassessEveryDays ?? null);
  if (!due.due) return { jobId, decision: "not_due", reason: due.reason, run: null };
  const common = {
    actor: SIM_ACTOR,
    trigger: "simulated_clock" as const,
    compare: opts.compare,
    beforeCommit: opts.beforeCommit ? () => opts.beforeCommit!(jobId) : undefined,
  };
  try {
    const run = jobId === INCREMENTAL_JOB.jobId ? await runIncremental(db, common) : await runReassessment(db, common);
    const reason =
      run.status === "succeeded"
        ? `Due: ${due.reason}`
        : `Due: ${due.reason} The run failed (${run.error?.code ?? "unknown"}); the next trigger at this date retries.`;
    return { jobId, decision: "ran", reason, run };
  } catch (err) {
    if (err instanceof SchedulerError && err.code === "conflict") {
      return { jobId, decision: "deferred", reason: `${err.message}. Checked again at the next trigger.`, run: null };
    }
    throw err;
  }
}

/**
 * Evaluates every job at the stored simulated date and runs the due ones,
 * one after another. Returns what was decided per job. Throws only for
 * unexpected errors (a run's own failure is recorded on the run and returned).
 */
export async function runSimulatedTriggers(db: Client, opts: SimOptions): Promise<SimTriggerResult> {
  await ensureScheduler(db);
  const { date } = await readClock(db); // stored date; never ticks
  const decisions: SimDecision[] = [];
  for (const jobId of [INCREMENTAL_JOB.jobId, PERIODIC_JOB.jobId] as JobId[]) {
    const d = await decideJob(db, jobId, date, opts);
    await record(db, date, opts.source, d);
    decisions.push(d);
  }
  return { simDate: date, source: opts.source, decisions };
}

/** Read-only status for the Scheduler tab: settings, last evaluation per job, due preview. */
export async function simulatedStatus(db: Client, settings: SimSettings = simSettings()): Promise<SimStatus> {
  await ensureScheduler(db);
  const { date } = await readClock(db);
  const rows = await db.execute(`SELECT * FROM scheduler_sim_state`);
  const jobs = await Promise.all(
    [INCREMENTAL_JOB.jobId, PERIODIC_JOB.jobId].map(async (jobId): Promise<SimJobState> => {
      const r = rows.rows.find((x) => x.job_id === jobId);
      return {
        jobId: jobId as JobId,
        last: r
          ? {
              simDate: r.sim_date as string,
              decision: r.decision as SimDecisionKind,
              reason: r.reason as string,
              runId: (r.run_id as string | null) ?? null,
              source: r.source as SimTriggerSource,
              updatedAt: r.updated_at as string,
            }
          : null,
        due: await jobDue(db, jobId as JobId, settings.reassessEveryDays),
      };
    }),
  );
  return { simDate: date, settings, jobs };
}

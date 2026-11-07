// One read for a future Scheduler tab: the job, its checkpoint, run counts,
// the latest run and finding counts. Read-only apart from creating the
// scheduler tables if missing.
import type { Client } from "@libsql/client";
import { listFindings } from "./findings";
import { INCREMENTAL_JOB } from "./incremental";
import { countRuns, getCheckpoint, listRuns, type RunCounts } from "./runs";
import type { FindingStatus, JobDescriptor, SchedulerRun } from "./types";

export type SchedulerOverview = {
  jobs: {
    job: JobDescriptor;
    checkpoint: { lastAuditId: number; runId: string | null; updatedAt: string } | null;
    /** Audit rows written since the checkpoint (any action); an upper bound on what the next run will read. */
    pendingAuditRows: number;
    runs: RunCounts;
    latestRun: SchedulerRun | null;
    running: SchedulerRun | null;
  }[];
  findings: Record<FindingStatus, number>;
};

export async function schedulerOverview(db: Client): Promise<SchedulerOverview> {
  const job = INCREMENTAL_JOB;
  const [checkpoint, runs, recent, findings] = await Promise.all([
    getCheckpoint(db, job.jobId),
    countRuns(db, job.jobId),
    listRuns(db, { jobId: job.jobId, limit: 1 }),
    listFindings(db, { limit: 1 }),
  ]);
  const pending = await db.execute({ sql: `SELECT COUNT(*) AS n FROM audit_log WHERE id > ?`, args: [checkpoint?.lastAuditId ?? 0] });
  const latest = recent[0] ?? null;
  return {
    jobs: [
      {
        job,
        checkpoint,
        pendingAuditRows: Number(pending.rows[0]?.n ?? 0),
        runs,
        latestRun: latest,
        running: latest?.status === "running" ? latest : null,
      },
    ],
    findings: findings.counts,
  };
}

// One read for the Scheduler tab: each job, its checkpoint, run counts, the
// latest run, and finding counts. Read-only apart from creating the
// scheduler tables if missing.
import type { Client } from "@libsql/client";
import { listFindings } from "./findings";
import { JOBS } from "./jobs";
import { countRuns, getCheckpoint, listRuns, usesCheckpoint, type RunCounts } from "./runs";
import type { FindingStatus, JobDescriptor, SchedulerRun } from "./types";

export type SchedulerOverview = {
  jobs: {
    job: JobDescriptor;
    /** Null for a job that does not read the audit log from a checkpoint (periodic reassessment), or before its first run. */
    checkpoint: { lastAuditId: number; runId: string | null; updatedAt: string } | null;
    /** Audit rows written since the checkpoint (any action); an upper bound on what the next run will read. Always 0 for a job without a checkpoint. */
    pendingAuditRows: number;
    runs: RunCounts;
    latestRun: SchedulerRun | null;
    running: SchedulerRun | null;
  }[];
  findings: Record<FindingStatus, number>;
};

export async function schedulerOverview(db: Client): Promise<SchedulerOverview> {
  const findings = await listFindings(db, { limit: 1 });
  const jobs = await Promise.all(
    JOBS.map(async (job) => {
      const checkpointed = usesCheckpoint(job.jobId);
      const [checkpoint, runs, recent] = await Promise.all([
        checkpointed ? getCheckpoint(db, job.jobId) : Promise.resolve(null),
        countRuns(db, job.jobId),
        listRuns(db, { jobId: job.jobId, limit: 1 }),
      ]);
      const pending = checkpointed
        ? Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM audit_log WHERE id > ?`, args: [checkpoint?.lastAuditId ?? 0] })).rows[0]?.n ?? 0)
        : 0;
      const latest = recent[0] ?? null;
      return { job, checkpoint, pendingAuditRows: pending, runs, latestRun: latest, running: latest?.status === "running" ? latest : null };
    }),
  );
  return { jobs, findings: findings.counts };
}

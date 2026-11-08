// Job registry (T24, B2): which jobs exist and how to run one by ID. Used by
// the runs route (`jobId`), the overview and the CLI.
import type { Client } from "@libsql/client";
import { INCREMENTAL_JOB, runIncremental } from "./incremental";
import { PERIODIC_JOB, runReassessment } from "./reassessment";
import { SchedulerError, type JobDescriptor, type JobId, type SchedulerRun } from "./types";

export const JOBS: readonly JobDescriptor[] = [INCREMENTAL_JOB, PERIODIC_JOB];
export const DEFAULT_JOB_ID: JobId = INCREMENTAL_JOB.jobId;

/** Optional job filter (GET ?jobId=): absent/empty => undefined (all jobs); unknown => SchedulerError("invalid"). */
export function parseJobFilter(value: unknown): JobId | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const job = typeof value === "string" ? JOBS.find((j) => j.jobId === value) : undefined;
  if (!job) throw new SchedulerError(`Unknown jobId; expected one of ${JOBS.map((j) => j.jobId).join(", ")}`, "invalid");
  return job.jobId;
}

/** Job to run (POST { jobId? }): absent/empty => incremental_overlap; unknown => SchedulerError("invalid"). */
export function parseJobId(value: unknown): JobId {
  return parseJobFilter(value) ?? DEFAULT_JOB_ID;
}

/** Runs one job manually. Same outcomes and errors as runIncremental / runReassessment. */
export function runJob(db: Client, input: { jobId: JobId; actor: string }): Promise<SchedulerRun> {
  return input.jobId === "periodic_reassessment" ? runReassessment(db, { actor: input.actor }) : runIncremental(db, { actor: input.actor });
}

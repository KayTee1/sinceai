// Mode 2, incremental governance (T24): evaluate only assets the app changed
// since the last committed checkpoint.
//
// Change source: the append-only audit_log. The app writes an audit row in
// the same transaction as each state change it makes, so audit IDs up to the
// claimed bound are a complete record of app-made changes in this database
// generation. Watched actions are those that put an asset (back) into the
// active estate or change its standing:
//   temporary_registered / insight_built  a new app-built insight
//   restored                              an archived asset is active again
//   promoted                              tier change of an app insight
// Other actions (renewals, proposals, decisions, clock, retire/merge/expiry,
// scheduler_* rows) do not introduce an active asset and are skipped.
//
// Not observable (reported as limitations, never as healthy): the imported
// catalog, KPI definitions and business facts are read-only at runtime, so
// external catalog changes have no change record to read.
import type { Client } from "@libsql/client";
import { readClock } from "../lifecycle";
import { suggestMerge } from "../estate";
import { withReadClient } from "./db";
import { emptyCounts, applyObservations } from "./findings";
import { OVERLAP_RULE, assessAsset, loadRunEstate, type Comparator, type Observation } from "./overlap";
import { claimRun, commitRun, settleFailure } from "./runs";
import { ensureScheduler } from "./schema";
import {
  type AssetAssessment,
  type ChangeTrigger,
  type ChangeWindow,
  type JobDescriptor,
  type RunSummary,
  type SchedulerRun,
} from "./types";

export const WATCHED_ACTIONS = ["temporary_registered", "insight_built", "restored", "promoted"] as const;

export const LIMITATIONS = [
  "Imported catalog assets, KPI mappings and KPI definitions cannot change at runtime and have no change record; changes made outside the app (a new workbook import) are not detected.",
  "Changes are read from the app's audit log only; writes that do not audit (usage events, chat drafts, pipeline runs) are not change triggers.",
  "Assets that map no KPIs, or app assets without a built insight, are reported as unsupported: overlap is unknown, not absent.",
  "Open findings are not closed automatically when an overlap disappears (retire, merge, expiry); that needs periodic reassessment (Mode 3).",
];

export const INCREMENTAL_JOB: JobDescriptor = {
  jobId: "incremental_overlap",
  mode: "incremental",
  title: "Incremental overlap check",
  description:
    "Checks assets built, restored or promoted since the last run for overlap with active assets, using the estate's merge rules. Records findings; never proposes, merges or archives.",
  triggers: ["manual"],
  rules: [OVERLAP_RULE],
  watchedActions: [...WATCHED_ACTIONS],
  limitations: LIMITATIONS,
};

const isSchedulerAction = (action: string) => action.startsWith("scheduler_");

/** Reads the window and groups watched changes by asset (oldest first). Read-only. */
export async function readChanges(db: Client, window: ChangeWindow) {
  const r = await db.execute({
    sql: `SELECT id, action, asset_id, sim_date FROM audit_log WHERE id > ? AND id <= ? ORDER BY id`,
    args: [window.fromAuditId, window.toAuditId],
  });
  const byAsset = new Map<string, ChangeTrigger[]>();
  let relevant = 0;
  let schedulerEvents = 0;
  for (const row of r.rows) {
    const action = row.action as string;
    if (isSchedulerAction(action)) {
      schedulerEvents++;
      continue;
    }
    const assetId = row.asset_id as string | null;
    if (!assetId || !(WATCHED_ACTIONS as readonly string[]).includes(action)) continue;
    relevant++;
    const t: ChangeTrigger = { auditId: Number(row.id), action, simDate: row.sim_date as string };
    byAsset.set(assetId, [...(byAsset.get(assetId) ?? []), t]);
  }
  return { eventsRead: r.rows.length, relevantEvents: relevant, ignoredSchedulerEvents: schedulerEvents, byAsset };
}

/**
 * One comparison per asset per run (C2): a changed asset's own comparison and
 * the reverse comparisons of the assets it covers can ask about the same
 * asset more than once; the answer cannot change within one evaluation, so
 * it is reused. Matching itself is suggestMerge's, unchanged. Each distinct
 * comparison still loads the estate inside suggestMerge (follow-up).
 */
function memoized(compare: Comparator): Comparator {
  const seen = new Map<string, ReturnType<Comparator>>();
  return (db, input, date) => {
    const key = `${input.assetId}|${input.limit ?? ""}|${date}`;
    let r = seen.get(key);
    if (!r) seen.set(key, (r = compare(db, input, date)));
    return r;
  };
}

/** Read-only evaluation of one claimed run. */
export async function evaluate(
  db: Client,
  run: SchedulerRun,
  compare?: Comparator,
): Promise<{ summary: Omit<RunSummary, "findings">; observations: Observation[] }> {
  const changes = await readChanges(db, run.window);
  const assessments: AssetAssessment[] = [];
  const observations = new Map<string, Observation>();
  if (changes.byAsset.size > 0) {
    // The estate is read only when something changed: no sweep on an empty window.
    const estate = await loadRunEstate(db);
    const memo = memoized(compare ?? suggestMerge);
    for (const [assetId, triggers] of changes.byAsset) {
      const r = await assessAsset(db, { assetId, triggers, estate, date: run.simDate, compare: memo });
      assessments.push(r.assessment);
      // The same pair seen from both changed assets is one observation (the first one keeps its triggers).
      for (const o of r.observations) if (!observations.has(o.dedupKey)) observations.set(o.dedupKey, o);
    }
  }
  return {
    summary: {
      window: run.window,
      eventsRead: changes.eventsRead,
      relevantEvents: changes.relevantEvents,
      ignoredSchedulerEvents: changes.ignoredSchedulerEvents,
      assessments,
      limitations: LIMITATIONS,
    },
    observations: [...observations.values()],
  };
}

export type RunOptions = {
  actor: string;
  /** Tests only: replaces suggestMerge. */
  compare?: Comparator;
  /** Tests only: called between evaluation and commit. */
  beforeCommit?: () => Promise<void>;
};

/**
 * Manually triggered incremental run: claim, evaluate (no transaction held,
 * on a scheduler-owned read client), commit findings and checkpoint together.
 * A failure leaves the checkpoint and findings untouched and is recorded on
 * the run: returns the finished run (succeeded, or failed with
 * `error.code` evaluation_failed / commit_failed). Throws
 * SchedulerError("conflict") when another run is in progress, the database
 * stayed locked at claim time, or the failure could not be settled as a
 * failed run (abandoned, reset, or the failure itself could not be recorded;
 * `detail.outcome`, `detail.runId` and `detail.failure` say which). See
 * runs.ts settleFailure.
 */
export async function runIncremental(db: Client, opts: RunOptions): Promise<SchedulerRun> {
  await ensureScheduler(db);
  await readClock(db); // lifecycle must be initialised; the scheduler never ticks the clock (no lifecycle writes).
  const run = await claimRun(db, {
    jobId: INCREMENTAL_JOB.jobId,
    mode: INCREMENTAL_JOB.mode,
    trigger: "manual",
    actor: opts.actor,
    rules: INCREMENTAL_JOB.rules,
  });

  let result: Awaited<ReturnType<typeof evaluate>>;
  try {
    result = await withReadClient(db, (reader) => evaluate(reader, run, opts.compare));
  } catch (err) {
    return settleFailure(db, run, { code: "evaluation_failed", stage: "evaluate", message: errorMessage(err) });
  }

  try {
    await opts.beforeCommit?.();
    const nowIso = new Date().toISOString();
    return await commitRun(
      db,
      run,
      async (tx) => ({
        ...result.summary,
        findings: result.observations.length
          ? await applyObservations(tx, result.observations, { runId: run.runId, simDate: run.simDate, nowIso })
          : emptyCounts(),
      }),
      nowIso,
    );
  } catch (err) {
    return settleFailure(db, run, { code: "commit_failed", stage: "commit", message: errorMessage(err) });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

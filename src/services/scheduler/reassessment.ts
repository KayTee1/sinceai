// Mode 3, periodic reassessment (T24, B2): re-checks KNOWN governance issues
// (open and dismissed scheduler findings), not the whole estate.
//
// For each finding the same rule as incremental runs (overlap.ts, i.e.
// suggestMerge unchanged) is asked about the finding's own asset pair at the
// stored clock date. Only the assets named by findings in scope are compared.
//   still "merge", same fingerprint      -> unchanged (open) / suppressed (dismissed)
//   still "merge", new fingerprint       -> updated (open) / reopened (dismissed, audited)
//   a side archived                      -> resolved, asset_inactive
//   a side has no record                 -> resolved, asset_unknown
//   no pair (scope no longer covers, no shared KPI) -> resolved, no_overlap
//   pair verdict keep_both / partial     -> resolved, verdict_changed
//   a side exists but cannot be compared -> indeterminate (left as is; unknown is not healthy)
// A resolved finding is not reassessed again; if a later incremental run
// observes the same pair as a merge again, it reopens (findings.ts recur).
// "superseded" is never produced (see types.ts FindingStatus).
//
// The run never evaluates leases, TTLs, usage expiry, promotion or
// retirement, and never creates, decides or expires proposals: an archived
// side only means the overlap is gone. Pending proposals touching a changed
// finding's assets are reported in the run summary (read-only).
//
// runReassessment is the execution boundary a later simulated-clock trigger
// can call: it takes a database client and options only, ticks nothing and
// uses the same claim / evaluate / commit / settleFailure steps as
// runIncremental (runs.ts).
import type { Client, Transaction } from "@libsql/client";
import { listPendingProposals, readClock, type MergeEvidence } from "../lifecycle";
import { suggestMerge, type EstateAsset, type MergeSuggestion, type MergeVerdict } from "../estate";
import { withReadClient } from "./db";
import { applyReassessment, listReassessable, type ReassessmentDecision } from "./findings";
import { memoized } from "./incremental";
import { OVERLAP_RULE, dedupKeyFor, loadRunEstate, observe, type Comparator } from "./overlap";
import { claimRun, commitRun, settleFailure } from "./runs";
import { ensureScheduler } from "./schema";
import type {
  Finding,
  FindingReassessment,
  JobDescriptor,
  ReassessmentSummary,
  ResolutionEvidence,
  ResolvedAssetState,
  RunSummary,
  SchedulerRun,
  StaleProposal,
  TriggerSource,
} from "./types";

export const REASSESSMENT_LIMITATIONS = [
  "Reassesses only open and dismissed findings, and compares only the assets they name; it is not a full-estate audit and finds no new overlaps.",
  "Resolved findings are not reassessed; a later incremental run that sees the same overlap again reopens them (audited).",
  "The window is a reference only (audit rows written since the previous successful reassessment); this job reads no audit rows.",
  "Pending proposals resting on changed evidence are reported, never decided, expired or changed.",
  "Leases, TTLs, usage expiry, promotion and retirement are not evaluated: an archived asset only resolves the overlap.",
];

export const PERIODIC_JOB: JobDescriptor = {
  jobId: "periodic_reassessment",
  mode: "reassessment",
  title: "Periodic reassessment",
  description:
    "Re-checks open and dismissed findings against the current estate with the same merge rule. Resolves findings whose overlap no longer holds, refreshes changed evidence, and reports pending proposals that rest on changed evidence. Never proposes, merges, archives or changes proposals.",
  triggers: ["manual", "simulated_clock"],
  rules: [OVERLAP_RULE],
  watchedActions: [],
  limitations: REASSESSMENT_LIMITATIONS,
};

const RANK: Record<MergeVerdict, number> = { merge: 0, keep_both: 1, partial: 2 };

type SideState = { assetId: string; asset: EstateAsset | null; kind: "comparable" | "inactive" | "unknown" | "unsupported"; state: ResolvedAssetState };

async function sideState(db: Client, assetId: string, estate: EstateAsset[]): Promise<SideState> {
  const a = estate.find((x) => x.assetId === assetId) ?? null;
  if (a) {
    const state = { assetId, status: a.status, product: a.product, market: a.market, tier: a.tier, kpiIds: [...a.kpiIds] };
    const kind = a.status === "archived" ? "inactive" : a.kpiIds.length === 0 ? "unsupported" : "comparable";
    return { assetId, asset: a, kind, state };
  }
  const r = await db.execute({ sql: `SELECT status, tier FROM asset_state WHERE asset_id = ?`, args: [assetId] });
  const row = r.rows[0];
  if (!row) return { assetId, asset: null, kind: "unknown", state: { assetId, status: "unknown", product: null, market: null, tier: null, kpiIds: [] } };
  const status = row.status as string;
  return {
    assetId,
    asset: null,
    kind: status === "archived" ? "inactive" : "unsupported",
    state: { assetId, status, product: null, market: null, tier: (row.tier as string | null) ?? null, kpiIds: [] },
  };
}

/** Read-only: what the rule says about one finding's pair now. */
export async function reassessFinding(
  db: Client,
  f: Finding,
  input: { estate: EstateAsset[]; date: string; compare: Comparator; compared: Set<string> },
): Promise<ReassessmentDecision> {
  if (f.ruleId !== OVERLAP_RULE.ruleId) {
    return { kind: "indeterminate", finding: f, message: `Rule ${f.ruleId} is not reassessed by this job.` };
  }
  const sides = await Promise.all(f.assetIds.map((id) => sideState(db, id, input.estate)));
  const evidence = (verdict: MergeVerdict | null, s?: MergeSuggestion): ResolutionEvidence => ({
    assets: sides.map((x) => x.state),
    verdict,
    suggestionReason: s?.reason ?? null,
    sharedKpis: s ? [...s.sharedKpis] : [],
    previousFingerprint: f.fingerprint,
  });
  const inactive = sides.filter((x) => x.kind === "inactive").map((x) => x.assetId);
  if (inactive.length) {
    return { kind: "resolved", finding: f, reason: "asset_inactive", message: `${inactive.join(" and ")} archived now; the overlap no longer holds.`, evidence: evidence(null) };
  }
  const unknown = sides.filter((x) => x.kind === "unknown").map((x) => x.assetId);
  if (unknown.length) {
    return { kind: "resolved", finding: f, reason: "asset_unknown", message: `No lifecycle or catalog record for ${unknown.join(" and ")} any more.`, evidence: evidence(null) };
  }
  const unsupported = sides.filter((x) => x.kind === "unsupported").map((x) => x.assetId);
  if (unsupported.length) {
    return {
      kind: "indeterminate",
      finding: f,
      message: `${unsupported.join(" and ")} has no built insight or maps no KPIs, so the overlap cannot be assessed; left as it was.`,
    };
  }

  const limit = input.estate.length;
  let note = "";
  let best: MergeSuggestion | undefined;
  // The pair as suggestMerge reports it from either side; a merge in either direction wins (as overlap.ts assessAsset).
  for (const id of f.assetIds) {
    const r = await input.compare(db, { assetId: id, limit }, input.date);
    input.compared.add(id);
    note = r.note;
    for (const s of r.suggestions) {
      if (dedupKeyFor([s.mergeAway.assetId, s.keep.assetId]) !== f.dedupKey) continue;
      if (!best || RANK[s.verdict] < RANK[best.verdict]) best = s;
    }
  }
  if (!best) {
    return {
      kind: "resolved",
      finding: f,
      reason: "no_overlap",
      message: `Neither ${f.assetIds.join(" nor ")} covers the other's scope with a shared KPI any more.`,
      evidence: evidence(null),
    };
  }
  if (best.verdict !== "merge") {
    return {
      kind: "resolved",
      finding: f,
      reason: "verdict_changed",
      message: `The pair still overlaps but the merge rule now says ${best.verdict}: ${best.reason}`,
      evidence: evidence(best.verdict, best),
    };
  }
  // Same perspective as the stored evidence; no audit row triggered this observation.
  const changed = f.assetIds.includes(f.evidence.changedAssetId) ? f.evidence.changedAssetId : f.assetIds[0];
  return { kind: "observed", finding: f, observation: observe(best, changed, [], note) };
}

/** Read-only evaluation of one claimed periodic run. */
export async function evaluateReassessment(
  db: Client,
  run: SchedulerRun,
  compare?: Comparator,
): Promise<{ decisions: ReassessmentDecision[]; scope: ReassessmentSummary["scope"]; assetsCompared: string[] }> {
  const findings = await listReassessable(db);
  const scope = { open: findings.filter((f) => f.status === "open").length, dismissed: findings.filter((f) => f.status === "dismissed").length };
  if (findings.length === 0) return { decisions: [], scope, assetsCompared: [] };
  const estate = await loadRunEstate(db);
  const memo = memoized(compare ?? suggestMerge);
  const compared = new Set<string>();
  const decisions: ReassessmentDecision[] = [];
  for (const f of findings) decisions.push(await reassessFinding(db, f, { estate, date: run.simDate, compare: memo, compared }));
  return { decisions, scope, assetsCompared: [...compared].sort() };
}

const mergeSides = (e: MergeEvidence) => [e.sourceId, e.targetId].filter((x): x is string => typeof x === "string");

/**
 * Pending proposals (open / escalated) that touch a finding whose evidence
 * changed or no longer holds. Read-only; proposals are never changed.
 */
export async function staleProposals(db: Client | Transaction, results: FindingReassessment[], linked: Map<string, string | null>): Promise<StaleProposal[]> {
  const changed = results.filter((r) => r.outcome === "updated" || r.outcome === "reopened" || r.outcome === "resolved");
  if (changed.length === 0) return [];
  const pending = await listPendingProposals(db);
  const out: StaleProposal[] = [];
  for (const r of changed) {
    for (const p of pending) {
      // A merge proposal stores only its source in assetIds; its target is in the evidence.
      const named = new Set([...p.assetIds, ...(p.type === "merge" ? mergeSides(p.evidence as MergeEvidence) : [])]);
      const shared = r.assetIds.filter((id) => named.has(id));
      const isLinked = linked.get(r.findingId) === p.id;
      if (!isLinked && shared.length === 0) continue;
      const relation = isLinked ? "linked" : shared.length === r.assetIds.length ? "same_pair" : "shares_asset";
      const what =
        r.outcome === "resolved"
          ? `the overlap no longer holds (${r.resolution?.reason ?? "resolved"})`
          : r.outcome === "updated"
            ? "the overlap's scope, KPIs or tier changed"
            : "the overlap's evidence changed since it was dismissed";
      out.push({
        proposalId: p.id,
        type: p.type,
        status: p.status,
        assetIds: [...named],
        findingId: r.findingId,
        relation,
        findingOutcome: r.outcome as StaleProposal["findingOutcome"],
        reason: `${p.type} proposal ${p.id} names ${shared.join(", ") || "the finding"}; finding ${r.findingId}: ${what}. Review before deciding; the scheduler does not change proposals.`,
      });
    }
  }
  return out;
}

export type ReassessmentOptions = {
  actor: string;
  trigger?: TriggerSource;
  /** B5: the simulated date the run must start at; the claim is refused (clock_moved) if the clock moved. */
  expectedSimDate?: string;
  /** Tests only: replaces suggestMerge. */
  compare?: Comparator;
  /** Tests only: called between evaluation and commit. */
  beforeCommit?: () => Promise<void>;
};

/**
 * Periodic reassessment run: claim, evaluate known findings (no transaction
 * held, on a scheduler-owned read client), commit every finding change in one
 * transaction with the run. Same outcomes and errors as runIncremental:
 * returns the finished run (succeeded, or failed with evaluation_failed /
 * commit_failed, nothing of it committed); throws SchedulerError("conflict")
 * while another finding-writing run (periodic or incremental) is running,
 * when the lock stayed taken at claim,
 * or when the failure could not be settled (detail.outcome).
 */
export async function runReassessment(db: Client, opts: ReassessmentOptions): Promise<SchedulerRun> {
  await ensureScheduler(db);
  await readClock(db); // lifecycle must be initialised; the scheduler never ticks the clock.
  const run = await claimRun(db, {
    jobId: PERIODIC_JOB.jobId,
    mode: PERIODIC_JOB.mode,
    trigger: opts.trigger ?? "manual",
    actor: opts.actor,
    rules: PERIODIC_JOB.rules,
    expectedSimDate: opts.expectedSimDate,
  });

  let result: Awaited<ReturnType<typeof evaluateReassessment>>;
  try {
    result = await withReadClient(db, (reader) => evaluateReassessment(reader, run, opts.compare));
  } catch (err) {
    return settleFailure(db, run, { code: "evaluation_failed", stage: "evaluate", message: errorMessage(err) });
  }

  try {
    await opts.beforeCommit?.();
    const nowIso = new Date().toISOString();
    return await commitRun(
      db,
      run,
      async (tx): Promise<RunSummary> => {
        const { counts, results } = await applyReassessment(tx, result.decisions, { runId: run.runId, simDate: run.simDate, nowIso });
        const linked = new Map(result.decisions.map((d) => [d.finding.findingId, d.finding.proposalId]));
        return {
          window: run.window,
          eventsRead: 0,
          relevantEvents: 0,
          ignoredSchedulerEvents: 0,
          assessments: [],
          findings: {
            created: 0,
            updated: counts.updated,
            unchanged: counts.unchanged,
            reopened: counts.reopened,
            suppressed: counts.suppressed,
            resolved: counts.resolved,
          },
          limitations: REASSESSMENT_LIMITATIONS,
          reassessment: {
            scope: result.scope,
            assetsCompared: result.assetsCompared,
            counts,
            results,
            staleProposals: await staleProposals(tx, results, linked),
          },
        };
      },
      nowIso,
    );
  } catch (err) {
    return settleFailure(db, run, { code: "commit_failed", stage: "commit", message: errorMessage(err) });
  }
}

/** What the due check looks at. Observable state only; no cadence. */
export type ReassessmentDueState = {
  /** Stored simulated clock date. */
  simDate: string;
  /** simDate of the latest succeeded periodic run, or null if none. */
  lastSucceededSimDate: string | null;
  /** Open + dismissed findings. */
  reassessableFindings: number;
  /** A periodic run is in progress. */
  running: boolean;
};

/**
 * Pure: is a periodic reassessment due? Yes when there are known findings to
 * re-check and the stored simulated date moved past the last successful
 * reassessment (or there was none). No cadence constant: "due" means
 * "something could have changed since". Not wired to the clock or to cron.
 */
export function reassessmentDue(s: ReassessmentDueState): { due: boolean; reason: string } {
  if (s.running) return { due: false, reason: "A periodic reassessment is running." };
  if (s.reassessableFindings === 0) return { due: false, reason: "No open or dismissed findings to reassess." };
  if (s.lastSucceededSimDate === null) return { due: true, reason: "Findings exist and none has been reassessed yet." };
  if (s.simDate > s.lastSucceededSimDate) {
    return { due: true, reason: `The simulated date moved from ${s.lastSucceededSimDate} to ${s.simDate} since the last reassessment.` };
  }
  return { due: false, reason: `Already reassessed at ${s.lastSucceededSimDate}.` };
}

/**
 * Reads the state reassessmentDue needs. Read-only. `simDate` (B5): evaluate
 * at this date instead of reading the clock again, so a trigger's due check
 * and its run use the same date.
 */
export async function readReassessmentDueState(db: Client, simDate?: string): Promise<ReassessmentDueState> {
  await ensureScheduler(db);
  const [clock, last, n, running] = await Promise.all([
    simDate !== undefined ? { date: simDate } : readClock(db),
    db.execute({
      sql: `SELECT sim_date FROM scheduler_runs WHERE job_id = ? AND status = 'succeeded' ORDER BY started_at DESC, rowid DESC LIMIT 1`,
      args: [PERIODIC_JOB.jobId],
    }),
    db.execute(`SELECT COUNT(*) AS n FROM scheduler_findings WHERE status IN ('open', 'dismissed')`),
    db.execute({ sql: `SELECT 1 FROM scheduler_runs WHERE job_id = ? AND status = 'running'`, args: [PERIODIC_JOB.jobId] }),
  ]);
  return {
    simDate: clock.date,
    lastSucceededSimDate: (last.rows[0]?.sim_date as string | undefined) ?? null,
    reassessableFindings: Number(n.rows[0]?.n ?? 0),
    running: running.rows.length > 0,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

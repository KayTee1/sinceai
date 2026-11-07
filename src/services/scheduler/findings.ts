// Findings (T24): stored apart from governance proposals. One row per
// dedup key (rule + sorted asset pair); repeated observations update it.
//
// Re-observation rules (tested in tests/scheduler.test.ts):
// - open, same fingerprint      -> stays open; current evidence refreshed, last seen + count updated ("unchanged")
// - open, new fingerprint       -> stays open; evidence replaced ("updated")
// - dismissed, fingerprint it was dismissed on -> stays dismissed; current evidence refreshed,
//   dismissal evidence kept, last seen + count updated ("suppressed")
// - dismissed, new fingerprint  -> open again, dismissal cleared, audited ("reopened")
// Current evidence (`evidence`) always shows the latest observation (Codex
// B2-F2), so usage counters, merge direction and descriptive text stay
// current; only the fingerprint (material basis) decides suppression. The
// evidence a dismissal was based on is kept apart (`dismissed_evidence`,
// Finding.dismissal.evidence) until the dismissal is cleared.
// - resolved / superseded (Mode 3, B2): the overlap is back. If the finding
//   was dismissed before it was resolved and the evidence is the one it was
//   dismissed on, it goes back to dismissed ("suppressed"); otherwise it
//   opens again with the dismissal cleared ("reopened"). Both audited.
// Only reassessment (Mode 3, reassessment.ts + applyReassessment) resolves a
// finding; incremental runs never close one.
import { randomUUID } from "node:crypto";
import type { Client, Transaction } from "@libsql/client";
import { POLICY_VERSION, appendAudit, readClock } from "../lifecycle";
import type { Observation } from "./overlap";
import { OVERLAP_RULE } from "./overlap";
import { writeTx } from "./db";
import { ensureScheduler } from "./schema";
import {
  FINDING_STATUSES,
  SchedulerError,
  type Finding,
  type FindingCounts,
  type FindingReassessment,
  type FindingResolution,
  type FindingStatus,
  type OverlapEvidence,
  type ReassessmentCounts,
  type ResolutionEvidence,
  type ResolutionReason,
} from "./types";

type Row = Record<string, unknown>;

function toFinding(r: Row): Finding {
  return {
    findingId: r.finding_id as string,
    dedupKey: r.dedup_key as string,
    ruleId: r.rule_id as string,
    ruleVersion: r.rule_version as string,
    assetIds: JSON.parse(r.asset_ids as string) as string[],
    status: r.status as FindingStatus,
    evidence: JSON.parse(r.evidence as string) as OverlapEvidence,
    fingerprint: r.fingerprint as string,
    firstSeen: { at: r.first_seen_at as string, simDate: r.first_seen_sim_date as string, runId: r.first_run_id as string },
    lastSeen: { at: r.last_seen_at as string, simDate: r.last_seen_sim_date as string, runId: r.last_run_id as string },
    observations: Number(r.observations),
    dismissal: r.dismissed_by
      ? {
          actor: r.dismissed_by as string,
          reason: r.dismissed_reason as string,
          at: r.dismissed_at as string,
          simDate: r.dismissed_sim_date as string,
          fingerprint: r.dismissed_fingerprint as string,
          evidence: typeof r.dismissed_evidence === "string" && r.dismissed_evidence ? (JSON.parse(r.dismissed_evidence) as OverlapEvidence) : null,
        }
      : null,
    proposalId: (r.proposal_id as string | null) ?? null,
    resolution: typeof r.resolution === "string" && r.resolution ? (JSON.parse(r.resolution) as FindingResolution) : null,
  };
}

export const emptyCounts = (): FindingCounts => ({ created: 0, updated: 0, unchanged: 0, reopened: 0, suppressed: 0 });

/** Writes one run's observations inside the commit transaction. */
export async function applyObservations(
  tx: Transaction,
  observations: Observation[],
  ctx: { runId: string; simDate: string; nowIso: string },
): Promise<FindingCounts> {
  const counts = emptyCounts();
  for (const o of observations) {
    const r = await tx.execute({ sql: `SELECT * FROM scheduler_findings WHERE dedup_key = ?`, args: [o.dedupKey] });
    const seen = [ctx.nowIso, ctx.simDate, ctx.runId] as const;
    if (!r.rows[0]) {
      await tx.execute({
        sql: `INSERT INTO scheduler_findings (finding_id, dedup_key, rule_id, rule_version, asset_ids, status, evidence, fingerprint,
                first_seen_at, first_seen_sim_date, first_run_id, last_seen_at, last_seen_sim_date, last_run_id, observations)
              VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        args: [
          `FND-${randomUUID()}`,
          o.dedupKey,
          OVERLAP_RULE.ruleId,
          OVERLAP_RULE.version,
          JSON.stringify(o.assetIds),
          JSON.stringify(o.evidence),
          o.fingerprint,
          ...seen,
          ...seen,
        ],
      });
      counts.created++;
      continue;
    }
    const f = toFinding(r.rows[0] as Row);
    if (f.status === "resolved" || f.status === "superseded") {
      counts[await recur(tx, f, o, ctx)]++;
      continue;
    }
    if (f.status === "open") {
      const same = f.fingerprint === o.fingerprint;
      await tx.execute({
        sql: `UPDATE scheduler_findings SET evidence = ?, fingerprint = ?, rule_version = ?, last_seen_at = ?, last_seen_sim_date = ?,
                last_run_id = ?, observations = observations + 1 WHERE finding_id = ?`,
        args: [JSON.stringify(o.evidence), o.fingerprint, OVERLAP_RULE.version, ...seen, f.findingId],
      });
      counts[same ? "unchanged" : "updated"]++;
    } else if (f.dismissal && f.dismissal.fingerprint === o.fingerprint) {
      // Same material evidence it was dismissed on: stays dismissed. Current evidence is refreshed;
      // the evidence it was dismissed on stays in dismissed_evidence.
      await tx.execute({
        sql: `UPDATE scheduler_findings SET evidence = ?, rule_version = ?, last_seen_at = ?, last_seen_sim_date = ?, last_run_id = ?,
                observations = observations + 1 WHERE finding_id = ?`,
        args: [JSON.stringify(o.evidence), OVERLAP_RULE.version, ...seen, f.findingId],
      });
      counts.suppressed++;
    } else {
      await tx.execute({
        sql: `UPDATE scheduler_findings SET status = 'open', evidence = ?, fingerprint = ?, rule_version = ?, last_seen_at = ?,
                last_seen_sim_date = ?, last_run_id = ?, observations = observations + 1, dismissed_by = NULL, dismissed_reason = NULL,
                dismissed_at = NULL, dismissed_sim_date = NULL, dismissed_fingerprint = NULL, dismissed_evidence = NULL
              WHERE finding_id = ?`,
        args: [JSON.stringify(o.evidence), o.fingerprint, OVERLAP_RULE.version, ...seen, f.findingId],
      });
      await appendAudit(tx, {
        simDate: ctx.simDate,
        actor: "scheduler",
        action: "scheduler_finding_reopened",
        policyVersion: POLICY_VERSION,
        rationale:
          `Finding ${f.findingId} (${f.assetIds.join(" / ")}) reopened by run ${ctx.runId}: its evidence changed since it was ` +
          `dismissed by ${f.dismissal?.actor ?? "unknown"} ("${f.dismissal?.reason ?? ""}").`,
        evidence: { findingId: f.findingId, runId: ctx.runId, previousFingerprint: f.dismissal?.fingerprint ?? null, fingerprint: o.fingerprint },
      });
      counts.reopened++;
    }
  }
  return counts;
}

/**
 * A resolved (or superseded) finding observed again: back to dismissed when it
 * was dismissed on exactly this evidence, otherwise open. Audited either way.
 */
async function recur(tx: Transaction, f: Finding, o: Observation, ctx: { runId: string; simDate: string; nowIso: string }) {
  const seen = [ctx.nowIso, ctx.simDate, ctx.runId] as const;
  const was = f.resolution ? `${f.status} (${f.resolution.reason}, run ${f.resolution.runId})` : f.status;
  if (f.dismissal && f.dismissal.fingerprint === o.fingerprint) {
    // As a suppressed observation: current evidence refreshed, the dismissal (and its evidence) kept.
    await tx.execute({
      sql: `UPDATE scheduler_findings SET status = 'dismissed', resolution = NULL, evidence = ?, rule_version = ?, last_seen_at = ?,
              last_seen_sim_date = ?, last_run_id = ?, observations = observations + 1 WHERE finding_id = ?`,
      args: [JSON.stringify(o.evidence), OVERLAP_RULE.version, ...seen, f.findingId],
    });
    await appendAudit(tx, {
      simDate: ctx.simDate,
      actor: "scheduler",
      action: "scheduler_finding_recurred",
      policyVersion: POLICY_VERSION,
      rationale:
        `Finding ${f.findingId} (${f.assetIds.join(" / ")}) was ${was}; run ${ctx.runId} sees the overlap again with the evidence ` +
        `it was dismissed on by ${f.dismissal.actor} ("${f.dismissal.reason}"), so it is dismissed again.`,
      evidence: { findingId: f.findingId, runId: ctx.runId, fromStatus: f.status, toStatus: "dismissed", fingerprint: o.fingerprint },
    });
    return "suppressed" as const;
  }
  await tx.execute({
    sql: `UPDATE scheduler_findings SET status = 'open', resolution = NULL, evidence = ?, fingerprint = ?, rule_version = ?, last_seen_at = ?,
            last_seen_sim_date = ?, last_run_id = ?, observations = observations + 1, dismissed_by = NULL, dismissed_reason = NULL,
            dismissed_at = NULL, dismissed_sim_date = NULL, dismissed_fingerprint = NULL, dismissed_evidence = NULL
          WHERE finding_id = ?`,
    args: [JSON.stringify(o.evidence), o.fingerprint, OVERLAP_RULE.version, ...seen, f.findingId],
  });
  await appendAudit(tx, {
    simDate: ctx.simDate,
    actor: "scheduler",
    action: "scheduler_finding_reopened",
    policyVersion: POLICY_VERSION,
    rationale: `Finding ${f.findingId} (${f.assetIds.join(" / ")}) was ${was}; run ${ctx.runId} sees the overlap again, so it is open again.`,
    evidence: { findingId: f.findingId, runId: ctx.runId, fromStatus: f.status, previousFingerprint: f.fingerprint, fingerprint: o.fingerprint },
  });
  return "reopened" as const;
}

/** What a reassessment decided for one finding (evaluation result, applied by applyReassessment). */
export type ReassessmentDecision =
  | { kind: "observed"; finding: Finding; observation: Observation }
  | { kind: "resolved"; finding: Finding; reason: ResolutionReason; message: string; evidence: ResolutionEvidence }
  | { kind: "indeterminate"; finding: Finding; message: string };

export const emptyReassessmentCounts = (): ReassessmentCounts => ({
  unchanged: 0,
  updated: 0,
  suppressed: 0,
  reopened: 0,
  resolved: 0,
  indeterminate: 0,
  skipped: 0,
});

/**
 * Writes one reassessment's decisions inside the commit transaction. Each
 * finding is re-read first: if its status, fingerprint or last run changed
 * since evaluation (another run, a dismissal), it is skipped and left as is.
 * - open, same fingerprint: current evidence refreshed, last seen + count ("unchanged")
 * - open, new fingerprint: evidence replaced ("updated")
 * - dismissed: suppressed / reopened (audited) exactly as applyObservations
 * - overlap gone: status resolved with the reason and evidence (audited);
 *   a dismissed finding keeps its dismissal (see recur)
 */
export async function applyReassessment(
  tx: Transaction,
  decisions: ReassessmentDecision[],
  ctx: { runId: string; simDate: string; nowIso: string },
): Promise<{ counts: ReassessmentCounts; results: FindingReassessment[] }> {
  const counts = emptyReassessmentCounts();
  const results: FindingReassessment[] = [];
  const seen = [ctx.nowIso, ctx.simDate, ctx.runId] as const;
  for (const d of decisions) {
    const was = d.finding;
    const base = { findingId: was.findingId, dedupKey: was.dedupKey, assetIds: was.assetIds, fromStatus: was.status, previousFingerprint: was.fingerprint };
    const r = await tx.execute({ sql: `SELECT * FROM scheduler_findings WHERE finding_id = ?`, args: [was.findingId] });
    const now = r.rows[0] ? toFinding(r.rows[0] as Row) : null;
    if (!now || now.status !== was.status || now.fingerprint !== was.fingerprint || now.lastSeen.runId !== was.lastSeen.runId) {
      counts.skipped++;
      results.push({
        ...base,
        toStatus: now?.status ?? was.status,
        outcome: "skipped",
        reason: now ? `Changed while this run evaluated (now ${now.status}, last seen by ${now.lastSeen.runId}); left as it is.` : "No longer exists.",
        fingerprint: null,
      });
      continue;
    }
    if (d.kind === "indeterminate") {
      counts.indeterminate++;
      results.push({ ...base, toStatus: was.status, outcome: "indeterminate", reason: d.message, fingerprint: null });
      continue;
    }
    if (d.kind === "resolved") {
      const resolution: FindingResolution = {
        reason: d.reason,
        message: d.message,
        fromStatus: was.status as "open" | "dismissed",
        at: ctx.nowIso,
        simDate: ctx.simDate,
        runId: ctx.runId,
        evidence: d.evidence,
      };
      await tx.execute({
        // Last seen stays the last run that saw the overlap; the resolving run is in `resolution`.
        sql: `UPDATE scheduler_findings SET status = 'resolved', resolution = ? WHERE finding_id = ? AND status = ?`,
        args: [JSON.stringify(resolution), was.findingId, was.status],
      });
      await appendAudit(tx, {
        simDate: ctx.simDate,
        actor: "scheduler",
        action: "scheduler_finding_resolved",
        policyVersion: POLICY_VERSION,
        rationale: `Finding ${was.findingId} (${was.assetIds.join(" / ")}) resolved by run ${ctx.runId}: ${d.message}`,
        evidence: { findingId: was.findingId, runId: ctx.runId, fromStatus: was.status, reason: d.reason, verdict: d.evidence.verdict },
      });
      counts.resolved++;
      results.push({ ...base, toStatus: "resolved", outcome: "resolved", reason: d.message, fingerprint: null, resolution: { reason: d.reason, evidence: d.evidence } });
      continue;
    }
    const o = d.observation;
    if (was.status === "open") {
      const same = was.fingerprint === o.fingerprint;
      // Current evidence is refreshed either way (B2-F2); the fingerprint only decides unchanged vs updated.
      await tx.execute({
        sql: `UPDATE scheduler_findings SET evidence = ?, fingerprint = ?, rule_version = ?, last_seen_at = ?, last_seen_sim_date = ?,
                last_run_id = ?, observations = observations + 1 WHERE finding_id = ?`,
        args: [JSON.stringify(o.evidence), o.fingerprint, OVERLAP_RULE.version, ...seen, was.findingId],
      });
      counts[same ? "unchanged" : "updated"]++;
      results.push({
        ...base,
        toStatus: "open",
        outcome: same ? "unchanged" : "updated",
        reason: same ? "Still a merge overlap on the same material evidence; current evidence refreshed." : "Still a merge overlap; scope, KPIs or tier changed, evidence replaced.",
        fingerprint: o.fingerprint,
      });
      continue;
    }
    // Dismissed: B1's rules (applyObservations) for one observation.
    const c = await applyObservations(tx, [o], ctx);
    const outcome = c.suppressed ? "suppressed" : "reopened";
    counts[outcome]++;
    results.push({
      ...base,
      toStatus: outcome === "suppressed" ? "dismissed" : "open",
      outcome,
      reason: outcome === "suppressed" ? "Still a merge overlap on the material evidence it was dismissed on; stays dismissed (current evidence refreshed)." : "Still a merge overlap, but the evidence changed since it was dismissed; open again.",
      fingerprint: o.fingerprint,
    });
  }
  return { counts, results };
}

/** Open and dismissed findings, oldest first: what a reassessment looks at. */
export async function listReassessable(db: Client): Promise<Finding[]> {
  const r = await db.execute(`SELECT * FROM scheduler_findings WHERE status IN ('open', 'dismissed') ORDER BY first_seen_at, finding_id`);
  return r.rows.map((x) => toFinding(x as Row));
}

/** Dismisses an open finding. A reason is required; the dismissal is audited. */
export async function dismissFinding(
  db: Client,
  input: { findingId: string; actor: string; reason: string },
  nowIso = new Date().toISOString(),
): Promise<Finding> {
  const actor = input.actor.trim();
  const reason = input.reason.trim();
  if (!actor) throw new SchedulerError("actor is required", "invalid");
  if (!reason) throw new SchedulerError("A reason is required to dismiss a finding", "invalid");
  await ensureScheduler(db);
  await writeTx(db, async (tx) => {
    const r = await tx.execute({ sql: `SELECT * FROM scheduler_findings WHERE finding_id = ?`, args: [input.findingId] });
    if (!r.rows[0]) throw new SchedulerError(`Unknown finding ${input.findingId}`, "not_found");
    const f = toFinding(r.rows[0] as Row);
    if (f.status !== "open") throw new SchedulerError(`Finding ${f.findingId} is already ${f.status}`, "conflict");
    const simDate = (await readClock(tx)).date;
    await tx.execute({
      sql: `UPDATE scheduler_findings SET status = 'dismissed', dismissed_by = ?, dismissed_reason = ?, dismissed_at = ?,
              dismissed_sim_date = ?, dismissed_fingerprint = fingerprint, dismissed_evidence = evidence
            WHERE finding_id = ? AND status = 'open'`,
      args: [actor, reason, nowIso, simDate, f.findingId],
    });
    await appendAudit(tx, {
      simDate,
      actor,
      action: "scheduler_finding_dismissed",
      policyVersion: POLICY_VERSION,
      rationale: `Finding ${f.findingId} (${f.assetIds.join(" / ")}) dismissed: ${reason}`,
      evidence: { findingId: f.findingId, assetIds: f.assetIds, ruleId: f.ruleId, fingerprint: f.fingerprint },
    });
  });
  return (await getFinding(db, input.findingId))!;
}

export async function getFinding(db: Client, findingId: string): Promise<Finding | null> {
  await ensureScheduler(db);
  const r = await db.execute({ sql: `SELECT * FROM scheduler_findings WHERE finding_id = ?`, args: [findingId] });
  return r.rows[0] ? toFinding(r.rows[0] as Row) : null;
}

/** Newest observation first. */
export async function listFindings(
  db: Client,
  input: { status?: FindingStatus | "any"; assetId?: string; limit?: number } = {},
): Promise<{ total: number; counts: Record<FindingStatus, number>; findings: Finding[] }> {
  await ensureScheduler(db);
  const status = input.status ?? "any";
  if (status !== "any" && !FINDING_STATUSES.includes(status)) throw new SchedulerError(`status must be ${FINDING_STATUSES.join(", ")} or any`, "invalid");
  const limit = Math.min(Math.max(1, Math.floor(input.limit ?? 50)), 500);
  const where: string[] = [];
  const args: string[] = [];
  if (status !== "any") {
    where.push("status = ?");
    args.push(status);
  }
  if (input.assetId) {
    where.push("EXISTS (SELECT 1 FROM json_each(asset_ids) WHERE value = ?)");
    args.push(input.assetId.trim().toUpperCase());
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows, total, byStatus] = await Promise.all([
    db.execute({ sql: `SELECT * FROM scheduler_findings ${clause} ORDER BY last_seen_at DESC, finding_id LIMIT ?`, args: [...args, limit] }),
    db.execute({ sql: `SELECT COUNT(*) AS n FROM scheduler_findings ${clause}`, args }),
    db.execute(`SELECT status, COUNT(*) AS n FROM scheduler_findings GROUP BY status`),
  ]);
  const counts: Record<FindingStatus, number> = { open: 0, dismissed: 0, resolved: 0, superseded: 0 };
  for (const x of byStatus.rows) counts[x.status as FindingStatus] = Number(x.n);
  return { total: Number(total.rows[0]?.n ?? 0), counts, findings: rows.rows.map((x) => toFinding(x as Row)) };
}

// Findings (T24): stored apart from governance proposals. One row per
// dedup key (rule + sorted asset pair); repeated observations update it.
//
// Re-observation rules (tested in tests/scheduler.test.ts):
// - open, same fingerprint      -> stays open; last seen + count updated ("unchanged")
// - open, new fingerprint       -> stays open; evidence replaced ("updated")
// - dismissed, fingerprint it was dismissed on -> stays dismissed; last seen + count updated ("suppressed")
// - dismissed, new fingerprint  -> open again, dismissal cleared, audited ("reopened")
// A finding is never closed automatically in B1 (that is reassessment, Mode 3).
import { randomUUID } from "node:crypto";
import type { Client, Transaction } from "@libsql/client";
import { POLICY_VERSION, appendAudit, readClock } from "../lifecycle";
import type { Observation } from "./overlap";
import { OVERLAP_RULE } from "./overlap";
import { writeTx } from "./db";
import { ensureScheduler } from "./schema";
import { SchedulerError, type Finding, type FindingCounts, type FindingStatus, type OverlapEvidence } from "./types";

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
        }
      : null,
    proposalId: (r.proposal_id as string | null) ?? null,
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
    if (f.status === "open") {
      const same = f.fingerprint === o.fingerprint;
      await tx.execute({
        sql: `UPDATE scheduler_findings SET evidence = ?, fingerprint = ?, rule_version = ?, last_seen_at = ?, last_seen_sim_date = ?,
                last_run_id = ?, observations = observations + 1 WHERE finding_id = ?`,
        args: [JSON.stringify(o.evidence), o.fingerprint, OVERLAP_RULE.version, ...seen, f.findingId],
      });
      counts[same ? "unchanged" : "updated"]++;
    } else if (f.dismissal && f.dismissal.fingerprint === o.fingerprint) {
      // Same evidence it was dismissed on: stays dismissed; the stored evidence stays what was dismissed.
      await tx.execute({
        sql: `UPDATE scheduler_findings SET last_seen_at = ?, last_seen_sim_date = ?, last_run_id = ?, observations = observations + 1
              WHERE finding_id = ?`,
        args: [...seen, f.findingId],
      });
      counts.suppressed++;
    } else {
      await tx.execute({
        sql: `UPDATE scheduler_findings SET status = 'open', evidence = ?, fingerprint = ?, rule_version = ?, last_seen_at = ?,
                last_seen_sim_date = ?, last_run_id = ?, observations = observations + 1, dismissed_by = NULL, dismissed_reason = NULL,
                dismissed_at = NULL, dismissed_sim_date = NULL, dismissed_fingerprint = NULL
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
              dismissed_sim_date = ?, dismissed_fingerprint = fingerprint WHERE finding_id = ? AND status = 'open'`,
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
  if (status !== "any" && status !== "open" && status !== "dismissed") throw new SchedulerError("status must be open, dismissed or any", "invalid");
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
  const counts: Record<FindingStatus, number> = { open: 0, dismissed: 0 };
  for (const x of byStatus.rows) counts[x.status as FindingStatus] = Number(x.n);
  return { total: Number(total.rows[0]?.n ?? 0), counts, findings: rows.rows.map((x) => toFinding(x as Row)) };
}

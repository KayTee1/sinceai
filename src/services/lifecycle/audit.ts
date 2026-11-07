// Append-only audit writer. Called by the backend on every proposal, decision
// and state change; not exposed as an agent tool, so agents cannot skip it.
import type { AuditEntry, Db } from "./types";

export type AuditInput = {
  simDate: string;
  actor: string;
  action: string;
  rationale: string;
  assetId?: string | null;
  proposalId?: string | null;
  policyVersion?: string | null;
  evidence?: unknown;
};

export async function appendAudit(db: Db, e: AuditInput): Promise<void> {
  await db.execute({
    sql: `INSERT INTO audit_log (sim_date, actor, action, asset_id, proposal_id, policy_version, rationale, evidence, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      e.simDate,
      e.actor,
      e.action,
      e.assetId ?? null,
      e.proposalId ?? null,
      e.policyVersion ?? null,
      e.rationale,
      e.evidence === undefined ? null : JSON.stringify(e.evidence),
      new Date().toISOString(),
    ],
  });
}

type AuditRow = {
  id: number;
  sim_date: string;
  actor: string;
  action: string;
  asset_id: string | null;
  proposal_id: string | null;
  policy_version: string | null;
  rationale: string;
  evidence: string | null;
  created_at: string;
};

function toEntry(r: AuditRow): AuditEntry {
  return {
    id: Number(r.id),
    simDate: r.sim_date,
    actor: r.actor,
    action: r.action,
    assetId: r.asset_id,
    proposalId: r.proposal_id,
    policyVersion: r.policy_version,
    rationale: r.rationale,
    evidence: r.evidence ? JSON.parse(r.evidence) : null,
    createdAt: r.created_at,
  };
}

/** Per-asset timeline, oldest first. */
export async function getAssetAudit(db: Db, assetId: string): Promise<AuditEntry[]> {
  const r = await db.execute({ sql: `SELECT * FROM audit_log WHERE asset_id = ? ORDER BY id`, args: [assetId] });
  return (r.rows as unknown as AuditRow[]).map(toEntry);
}

/** Latest entries across the estate, newest first. */
export async function getRecentAudit(db: Db, limit = 50): Promise<AuditEntry[]> {
  const r = await db.execute({ sql: `SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`, args: [limit] });
  return (r.rows as unknown as AuditRow[]).map(toEntry);
}

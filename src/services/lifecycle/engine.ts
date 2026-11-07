// Lifecycle engine: deterministic state machine for TTL expiry, lease review,
// default archive on silence, decisions and restore. Never called by the LLM
// directly; every change writes one audit row.
import type { Client } from "@libsql/client";
import { appendAudit } from "./audit";
import {
  LEASE_DAYS,
  LOW_USAGE_USERS,
  POLICY_VERSION,
  REVIEW_WINDOW_DAYS,
  TTL_DAYS,
  USAGE_MONTHS,
  addDays,
} from "./policy";
import {
  LifecycleError,
  type AssetState,
  type Db,
  type Proposal,
  type ProposalStatus,
  type ReviewEvidence,
  type Tier,
} from "./types";

// ---------- reads ----------

type StateRow = {
  asset_id: string;
  origin: "pack" | "app";
  name: string | null;
  owner_id: string | null;
  tier: Tier;
  status: AssetState["status"];
  lease_end: string | null;
  ttl_end: string | null;
  prev_tier: Tier | null;
  source_endorsement: string | null;
};

function toState(r: StateRow): AssetState {
  return {
    assetId: r.asset_id,
    origin: r.origin,
    name: r.name,
    ownerId: r.owner_id,
    tier: r.tier,
    status: r.status,
    leaseEnd: r.lease_end,
    ttlEnd: r.ttl_end,
    prevTier: r.prev_tier,
    sourceEndorsement: r.source_endorsement,
  };
}

export async function getAssetState(db: Db, assetId: string): Promise<AssetState | null> {
  const r = await db.execute({ sql: `SELECT * FROM asset_state WHERE asset_id = ?`, args: [assetId] });
  return r.rows[0] ? toState(r.rows[0] as unknown as StateRow) : null;
}

export async function listAssetStates(db: Db): Promise<AssetState[]> {
  const r = await db.execute(`SELECT * FROM asset_state ORDER BY asset_id`);
  return (r.rows as unknown as StateRow[]).map(toState);
}

type ProposalRow = {
  id: string;
  version: number;
  type: Proposal["type"];
  asset_ids: string;
  rationale: string;
  evidence: string;
  required_approvers: string;
  status: ProposalStatus;
  created_on: string;
  due_on: string | null;
};

function toProposal(r: ProposalRow): Proposal {
  return {
    id: r.id,
    version: Number(r.version),
    type: r.type,
    assetIds: JSON.parse(r.asset_ids),
    rationale: r.rationale,
    evidence: JSON.parse(r.evidence),
    requiredApprovers: JSON.parse(r.required_approvers),
    status: r.status,
    createdOn: r.created_on,
    dueOn: r.due_on,
  };
}

export async function getProposal(db: Db, id: string): Promise<Proposal | null> {
  const r = await db.execute({ sql: `SELECT * FROM proposals WHERE id = ?`, args: [id] });
  return r.rows[0] ? toProposal(r.rows[0] as unknown as ProposalRow) : null;
}

/** Inbox: proposals waiting for a human (open or escalated), oldest due first. */
export async function listPendingProposals(db: Db): Promise<Proposal[]> {
  const r = await db.execute(
    `SELECT * FROM proposals WHERE status IN ('open', 'escalated') ORDER BY COALESCE(due_on, '9999'), id`,
  );
  return (r.rows as unknown as ProposalRow[]).map(toProposal);
}

// ---------- scheduler ----------

type DueEvent = { date: string; kind: "ttl" | "lease" | "review"; id: string };

/** Earliest due event on or before `until`, if any. */
export async function nextDueEvent(db: Db, until = "9999-12-31"): Promise<DueEvent | null> {
  const r = await db.execute({
    sql: `SELECT date, kind, id FROM (
            SELECT ttl_end AS date, 'ttl' AS kind, asset_id AS id FROM asset_state
              WHERE status = 'active' AND tier = 'temporary' AND ttl_end IS NOT NULL
            UNION ALL
            SELECT lease_end, 'lease', asset_id FROM asset_state
              WHERE status = 'active' AND tier != 'temporary' AND lease_end IS NOT NULL
            UNION ALL
            SELECT due_on, 'review', id FROM proposals WHERE status = 'open' AND due_on IS NOT NULL
          ) WHERE date <= ? ORDER BY date, kind, id LIMIT 1`,
    args: [until],
  });
  const row = r.rows[0];
  return row ? { date: row.date as string, kind: row.kind as DueEvent["kind"], id: row.id as string } : null;
}

/**
 * Processes every due event up to and including `until`, one at a time in
 * date order (D14), each in its own transaction. Returns the number processed.
 */
export async function processDue(db: Client, until: string): Promise<number> {
  let processed = 0;
  for (;;) {
    const ev = await nextDueEvent(db, until);
    if (!ev) return processed;
    const tx = await db.transaction("write");
    try {
      if (ev.kind === "ttl") await expireTemporary(tx, ev.id, ev.date);
      else if (ev.kind === "lease") await openLeaseReview(tx, ev.id, ev.date);
      else await applyReviewDefault(tx, ev.id, ev.date);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    } finally {
      tx.close();
    }
    processed++;
  }
}

async function expireTemporary(tx: Db, assetId: string, date: string) {
  await archiveAsset(tx, assetId, date);
  await appendAudit(tx, {
    simDate: date,
    actor: "policy",
    action: "ttl_expired",
    assetId,
    policyVersion: POLICY_VERSION,
    rationale: `Temporary insight was not used again within ${TTL_DAYS} days; archived (restorable).`,
  });
}

async function ownerStatus(tx: Db, ownerId: string | null): Promise<ReviewEvidence["ownerStatus"]> {
  if (!ownerId) return "missing";
  const r = await tx.execute({ sql: `SELECT status FROM Owners WHERE owner_id = ?`, args: [ownerId] });
  if (!r.rows[0]) return "missing";
  return r.rows[0].status === "active" ? "active" : "inactive";
}

async function downstreamAssets(tx: Db, assetId: string): Promise<string[]> {
  const r = await tx.execute({
    sql: `SELECT DISTINCT target_id FROM Lineage_Edges WHERE source_id = ? AND edge_type = 'ASSET_TO_ASSET' ORDER BY target_id`,
    args: [assetId],
  });
  return r.rows.map((x) => x.target_id as string);
}

async function buildEvidence(tx: Db, state: AssetState, date: string): Promise<ReviewEvidence> {
  const usage = await tx.execute({
    sql: `SELECT month, unique_users FROM Asset_Usage WHERE asset_id = ? ORDER BY month DESC LIMIT ?`,
    args: [state.assetId, USAGE_MONTHS],
  });
  const users = usage.rows.map((u) => Number(u.unique_users));
  const opens = await tx.execute({
    sql: `SELECT COUNT(*) AS n FROM usage_events WHERE asset_id = ? AND sim_date > ?`,
    args: [state.assetId, addDays(date, -LEASE_DAYS)],
  });
  const source = await tx.execute({
    sql: `SELECT lifecycle_status FROM Analytics_Assets WHERE asset_id = ?`,
    args: [state.assetId],
  });
  return {
    avgMonthlyUsers: users.length ? Math.round(users.reduce((a, b) => a + b, 0) / users.length) : null,
    usageMonths: usage.rows.map((u) => String(u.month)),
    appOpens90d: Number(opens.rows[0]?.n ?? 0),
    sourceLifecycleStatus: (source.rows[0]?.lifecycle_status as string | undefined) ?? null,
    ownerStatus: await ownerStatus(tx, state.ownerId),
    downstreamAssets: await downstreamAssets(tx, state.assetId),
    source: [
      { sheet: "Asset_Usage", ids: [state.assetId] },
      { sheet: "Lineage_Edges", ids: [state.assetId] },
      ...(state.ownerId ? [{ sheet: "Owners", ids: [state.ownerId] }] : []),
    ],
  };
}

function reviewProposalType(ev: ReviewEvidence): { type: Proposal["type"]; rationale: string } {
  const lowUsage = (ev.avgMonthlyUsers ?? 0) < LOW_USAGE_USERS && ev.appOpens90d === 0;
  if (lowUsage) {
    return {
      type: "retire",
      rationale:
        `Lease ended. Average ${ev.avgMonthlyUsers ?? 0} monthly users over the last ${ev.usageMonths.length} months ` +
        `(below ${LOW_USAGE_USERS}) and no app opens in 90 days. Proposed: retire (archive, restorable).`,
    };
  }
  return {
    type: "renew",
    rationale:
      `Lease ended. Average ${ev.avgMonthlyUsers ?? 0} monthly users over the last ${ev.usageMonths.length} months` +
      `${ev.appOpens90d ? ` and ${ev.appOpens90d} app opens` : ""}. Proposed: renew for ${LEASE_DAYS} days.`,
  };
}

async function openLeaseReview(tx: Db, assetId: string, date: string) {
  const state = await getAssetState(tx, assetId);
  if (!state) return;
  const evidence = await buildEvidence(tx, state, date);
  const { type, rationale } = reviewProposalType(evidence);
  const id = `PRP-${assetId}-${date}`;
  const due = addDays(date, REVIEW_WINDOW_DAYS);
  await tx.execute({
    sql: `INSERT INTO proposals (id, version, type, asset_ids, rationale, evidence, required_approvers, status, created_on, due_on)
          VALUES (?, 1, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    args: [
      id,
      type,
      JSON.stringify([assetId]),
      rationale,
      JSON.stringify(evidence),
      // Owner review: the asset owner decides (Rule 11). No owner -> nobody can approve until one is assigned.
      JSON.stringify(state.ownerId ? [state.ownerId] : []),
      date,
      due,
    ],
  });
  await tx.execute({ sql: `UPDATE asset_state SET status = 'lease_due' WHERE asset_id = ?`, args: [assetId] });
  await appendAudit(tx, {
    simDate: date,
    actor: "scheduler",
    action: "lease_review_opened",
    assetId,
    proposalId: id,
    policyVersion: POLICY_VERSION,
    rationale: `${rationale} Owner has ${REVIEW_WINDOW_DAYS} days to decide; no response archives by default.`,
    evidence,
  });
}

async function applyReviewDefault(tx: Db, proposalId: string, date: string) {
  const p = await getProposal(tx, proposalId);
  if (!p || p.status !== "open") return;
  const assetId = p.assetIds[0];
  const state = await getAssetState(tx, assetId);
  // Re-check at the deadline: dependencies or ownership may have changed.
  const evidence = state ? await buildEvidence(tx, state, date) : p.evidence;
  const skip: string[] = [];
  if (evidence.downstreamAssets.length) skip.push(`${evidence.downstreamAssets.length} downstream assets depend on it`);
  if (evidence.ownerStatus !== "active") skip.push(`owner is ${evidence.ownerStatus}`);

  if (skip.length) {
    // Never auto-archived; stays in the inbox for a human (SCOPE mitigations, D13).
    await tx.execute({ sql: `UPDATE proposals SET status = 'escalated', due_on = NULL WHERE id = ?`, args: [proposalId] });
    await appendAudit(tx, {
      simDate: date,
      actor: "policy",
      action: "auto_archive_skipped",
      assetId,
      proposalId,
      policyVersion: POLICY_VERSION,
      rationale: `No response within ${REVIEW_WINDOW_DAYS} days, but not archived: ${skip.join("; ")}. Escalated for a human decision.`,
      evidence,
    });
    return;
  }

  await tx.execute({ sql: `UPDATE proposals SET status = 'expired', due_on = NULL WHERE id = ?`, args: [proposalId] });
  await archiveAsset(tx, assetId, date);
  await appendAudit(tx, {
    simDate: date,
    actor: "policy",
    action: "archived_by_policy",
    assetId,
    proposalId,
    policyVersion: POLICY_VERSION,
    rationale: `Policy applied, no response: owner did not answer the lease review within ${REVIEW_WINDOW_DAYS} days. Archived (restorable).`,
    evidence,
  });
}

async function archiveAsset(tx: Db, assetId: string, date: string) {
  const state = await getAssetState(tx, assetId);
  if (!state) throw new LifecycleError(`Unknown asset ${assetId}`, "not_found");
  await tx.execute({
    sql: `INSERT INTO archive_snapshots (asset_id, sim_date, snapshot) VALUES (?, ?, ?)`,
    args: [assetId, date, JSON.stringify(state)],
  });
  await tx.execute({
    sql: `UPDATE asset_state SET status = 'archived', prev_tier = tier WHERE asset_id = ?`,
    args: [assetId],
  });
}

// ---------- human actions ----------

export type DecisionInput = {
  proposalId: string;
  actor: string; // owner ID the manager is acting as (D12)
  action: "approve" | "reject";
  reason?: string;
};

/** Owner decision on a lease review. Any decision closes the review (D14). */
export async function decide(db: Client, input: DecisionInput, date: string): Promise<Proposal> {
  const tx = await db.transaction("write");
  try {
    const p = await getProposal(tx, input.proposalId);
    if (!p) throw new LifecycleError(`Unknown proposal ${input.proposalId}`, "not_found");
    if (p.status !== "open" && p.status !== "escalated") {
      throw new LifecycleError(`Proposal ${p.id} is already ${p.status}`, "invalid");
    }
    if (!p.requiredApprovers.includes(input.actor)) {
      throw new LifecycleError(
        `${input.actor} is not a required approver for ${p.id} (needs ${p.requiredApprovers.join(", ") || "an assigned owner"})`,
        "not_allowed",
      );
    }
    if ((await ownerStatus(tx, input.actor)) !== "active") {
      throw new LifecycleError(`${input.actor} is not an active owner`, "not_allowed");
    }
    const reason = input.reason?.trim() ?? "";
    if (input.action === "reject" && !reason) throw new LifecycleError("Reject requires a reason", "invalid");

    const assetId = p.assetIds[0];
    // approve renew / reject retire -> renew; approve retire / reject renew -> retire.
    const renew = (p.type === "renew") === (input.action === "approve");
    await tx.execute({
      sql: `UPDATE proposals SET status = ?, due_on = NULL WHERE id = ?`,
      args: [input.action === "approve" ? "approved" : "rejected", p.id],
    });
    await tx.execute({
      sql: `INSERT INTO decisions (proposal_id, version, actor, action, reason, sim_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [p.id, p.version, input.actor, input.action, reason || null, date, new Date().toISOString()],
    });
    await appendAudit(tx, {
      simDate: date,
      actor: input.actor,
      action: `proposal_${input.action === "approve" ? "approved" : "rejected"}`,
      assetId,
      proposalId: p.id,
      rationale: reason || `Approved ${p.type}.`,
    });

    if (renew) {
      const leaseEnd = addDays(date, LEASE_DAYS);
      await tx.execute({
        sql: `UPDATE asset_state SET status = 'active', lease_end = ? WHERE asset_id = ?`,
        args: [leaseEnd, assetId],
      });
      await appendAudit(tx, {
        simDate: date,
        actor: input.actor,
        action: "renewed",
        assetId,
        proposalId: p.id,
        policyVersion: POLICY_VERSION,
        rationale: `Lease renewed until ${leaseEnd}; tier unchanged (D12).`,
      });
    } else {
      await archiveAsset(tx, assetId, date);
      await appendAudit(tx, {
        simDate: date,
        actor: input.actor,
        action: "retired",
        assetId,
        proposalId: p.id,
        policyVersion: POLICY_VERSION,
        rationale: "Retired by the owner; archived (restorable).",
      });
    }
    await tx.commit();
    return (await getProposal(db, p.id))!;
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}

/** Restore an archived asset: previous tier with a new lease, or a fresh TTL for Temporary (D13, D14). */
export async function restore(
  db: Client,
  input: { assetId: string; actor: string; reason?: string },
  date: string,
): Promise<AssetState> {
  const tx = await db.transaction("write");
  try {
    const s = await getAssetState(tx, input.assetId);
    if (!s) throw new LifecycleError(`Unknown asset ${input.assetId}`, "not_found");
    if (s.status !== "archived") throw new LifecycleError(`${input.assetId} is not archived`, "invalid");
    const tier = s.prevTier ?? s.tier;
    const temporary = tier === "temporary";
    const end = addDays(date, temporary ? TTL_DAYS : LEASE_DAYS);
    await tx.execute({
      sql: `UPDATE asset_state SET status = 'active', tier = ?, prev_tier = NULL, lease_end = ?, ttl_end = ? WHERE asset_id = ?`,
      args: [tier, temporary ? null : end, temporary ? end : null, input.assetId],
    });
    await appendAudit(tx, {
      simDate: date,
      actor: input.actor,
      action: "restored",
      assetId: input.assetId,
      policyVersion: POLICY_VERSION,
      rationale: `${input.reason?.trim() || "Restored on request."} Back to ${tier}; ${temporary ? "TTL" : "lease"} until ${end}.`,
    });
    await tx.commit();
    return (await getAssetState(db, input.assetId))!;
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}

/** Registers an approved build as a Temporary insight with a 30-day TTL. Called by the build step. */
export async function registerTemporary(
  db: Client,
  input: { assetId: string; name: string; ownerId: string; approvedBy: string; proposalId?: string },
  date: string,
): Promise<AssetState> {
  const ttlEnd = addDays(date, TTL_DAYS);
  const tx = await db.transaction("write");
  try {
    await tx.execute({
      sql: `INSERT INTO asset_state (asset_id, origin, name, owner_id, tier, status, ttl_end)
            VALUES (?, 'app', ?, ?, 'temporary', 'active', ?)`,
      args: [input.assetId, input.name, input.ownerId, ttlEnd],
    });
    await appendAudit(tx, {
      simDate: date,
      actor: input.approvedBy,
      action: "temporary_registered",
      assetId: input.assetId,
      proposalId: input.proposalId ?? null,
      policyVersion: POLICY_VERSION,
      rationale: `Temporary insight "${input.name}" for ${input.ownerId}; expires ${ttlEnd} unless used again.`,
    });
    await tx.commit();
    return (await getAssetState(db, input.assetId))!;
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}

/**
 * Logs an app open (kept apart from imported usage). When the owner opens
 * their own Temporary insight again it becomes Personal automatically (D14).
 */
export async function recordUsage(
  db: Client,
  input: { assetId: string; userId: string },
  date: string,
): Promise<AssetState> {
  const tx = await db.transaction("write");
  try {
    const s = await getAssetState(tx, input.assetId);
    if (!s) throw new LifecycleError(`Unknown asset ${input.assetId}`, "not_found");
    await tx.execute({
      sql: `INSERT INTO usage_events (asset_id, user_id, sim_date, origin) VALUES (?, ?, ?, 'app')`,
      args: [input.assetId, input.userId, date],
    });
    if (s.status === "active" && s.tier === "temporary" && s.ownerId === input.userId) {
      const leaseEnd = addDays(date, LEASE_DAYS);
      await tx.execute({
        sql: `UPDATE asset_state SET tier = 'personal', ttl_end = NULL, lease_end = ? WHERE asset_id = ?`,
        args: [leaseEnd, input.assetId],
      });
      await appendAudit(tx, {
        simDate: date,
        actor: "policy",
        action: "promoted",
        assetId: input.assetId,
        policyVersion: POLICY_VERSION,
        rationale: `Owner used the Temporary insight again: promoted to Personal, lease until ${leaseEnd}.`,
      });
    }
    await tx.commit();
    return (await getAssetState(db, input.assetId))!;
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}

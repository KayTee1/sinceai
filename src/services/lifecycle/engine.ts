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
  TEAM_USERS,
  TTL_DAYS,
  USAGE_MONTHS,
  addDays,
} from "./policy";
import {
  LifecycleError,
  type AssetState,
  type Db,
  type Proposal,
  type PromoteEvidence,
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
                AND asset_id NOT IN (SELECT json_extract(asset_ids, '$[0]') FROM proposals
                                     WHERE type = 'promote' AND status IN ('open', 'escalated'))
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
      else await escalateOverdueReview(tx, ev.id, ev.date);
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
  // Pack telemetry counts only for months that start within the 90 days before
  // the review: the pack ends Oct 2026, so later reviews rely on app views only.
  const usage = await tx.execute({
    sql: `SELECT month, unique_users FROM Asset_Usage WHERE asset_id = ? AND month >= ? AND month <= ?
          ORDER BY month DESC LIMIT ?`,
    args: [state.assetId, addDays(date, -LEASE_DAYS), date, USAGE_MONTHS],
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

/** D21: used = any in-app view in the last 90 days, or pack telemetry at or above the usage threshold. */
function wasUsed(ev: ReviewEvidence): boolean {
  return ev.appOpens90d > 0 || (ev.avgMonthlyUsers ?? 0) >= LOW_USAGE_USERS;
}

function usageText(ev: ReviewEvidence): string {
  const telemetry = ev.usageMonths.length
    ? `average ${ev.avgMonthlyUsers ?? 0} monthly users in pack telemetry (${ev.usageMonths.length} months in the last 90 days)`
    : "no pack telemetry in the last 90 days (the pack ends Oct 2026)";
  return `${telemetry} and ${ev.appOpens90d} app views in the last 90 days`;
}

/**
 * Lease end (D21): a used asset with an active owner is renewed automatically,
 * with no human step. Only unused assets get a retire proposal for the owner;
 * silence escalates to the steward (D16). A used asset without an active owner
 * cannot be renewed automatically (Rule 8) and goes straight to the steward.
 */
async function openLeaseReview(tx: Db, assetId: string, date: string) {
  const state = await getAssetState(tx, assetId);
  if (!state) return;
  const evidence = await buildEvidence(tx, state, date);
  const used = wasUsed(evidence);

  if (used && evidence.ownerStatus === "active") {
    const leaseEnd = addDays(date, LEASE_DAYS);
    await tx.execute({
      sql: `UPDATE asset_state SET status = 'active', lease_end = ? WHERE asset_id = ?`,
      args: [leaseEnd, assetId],
    });
    await appendAudit(tx, {
      simDate: date,
      actor: "policy",
      action: "renewed",
      assetId,
      policyVersion: POLICY_VERSION,
      rationale: `Lease ended and the asset is in use (${usageText(evidence)}). Renewed automatically until ${leaseEnd}; tier unchanged.`,
      evidence,
    });
    return;
  }

  const id = `PRP-${assetId}-${date}`;
  const steward = used ? await regionSteward(tx, state.ownerId) : null;
  const type: Proposal["type"] = used ? "renew" : "retire";
  const rationale = used
    ? `Lease ended. In use (${usageText(evidence)}), but the owner is ${evidence.ownerStatus}, so it cannot renew ` +
      `automatically. Proposed: renew; the data steward confirms and assigns an owner.`
    : `Lease ended. Not used (${usageText(evidence)}; threshold ${LOW_USAGE_USERS} users). ` +
      `Proposed: retire (archive, restorable). The owner decides within ${REVIEW_WINDOW_DAYS} days; then it escalates to the data steward.`;
  await tx.execute({
    sql: `INSERT INTO proposals (id, version, type, asset_ids, rationale, evidence, required_approvers, status, created_on, due_on)
          VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      type,
      JSON.stringify([assetId]),
      rationale,
      JSON.stringify(evidence),
      // Unused: the owner decides (Rule 11). Used but ownerless: the steward (Rule 8).
      JSON.stringify(used ? (steward ? [steward] : []) : state.ownerId ? [state.ownerId] : []),
      used ? "escalated" : "open",
      date,
      used ? null : addDays(date, REVIEW_WINDOW_DAYS),
    ],
  });
  await tx.execute({ sql: `UPDATE asset_state SET status = 'lease_due' WHERE asset_id = ?`, args: [assetId] });
  await appendAudit(tx, {
    simDate: date,
    actor: "scheduler",
    action: used ? "review_escalated" : "lease_review_opened",
    assetId,
    proposalId: id,
    policyVersion: POLICY_VERSION,
    rationale,
    evidence,
  });
}

// Region data steward who takes over overdue reviews (D14: a team is an owner
// region; Global covers Asia Pacific, which has no active steward).
export async function regionSteward(tx: Db, ownerId: string | null): Promise<string | null> {
  const owner = ownerId
    ? (await tx.execute({ sql: `SELECT scope FROM Owners WHERE owner_id = ?`, args: [ownerId] })).rows[0]
    : undefined;
  const region = (owner?.scope as string | undefined) ?? "Global";
  for (const scope of region === "Global" ? ["Global"] : [region, "Global"]) {
    const r = await tx.execute({
      sql: `SELECT owner_id FROM Owners WHERE role = 'Data Steward' AND status = 'active' AND scope = ? ORDER BY owner_id LIMIT 1`,
      args: [scope],
    });
    if (r.rows[0]) return r.rows[0].owner_id as string;
  }
  return null;
}

// D16: silence never archives. An overdue review is escalated to the region's
// data steward, who may decide alongside the owner. Archiving always needs an
// approved proposal.
async function escalateOverdueReview(tx: Db, proposalId: string, date: string) {
  const p = await getProposal(tx, proposalId);
  if (!p || p.status !== "open") return;
  const assetId = p.assetIds[0];
  const state = await getAssetState(tx, assetId);
  const evidence = state ? await buildEvidence(tx, state, date) : (p.evidence as ReviewEvidence);
  const steward = await regionSteward(tx, state?.ownerId ?? null);
  const approvers = [...new Set([...p.requiredApprovers, ...(steward ? [steward] : [])])];
  const notes: string[] = [];
  if (evidence.ownerStatus !== "active") notes.push(`owner is ${evidence.ownerStatus}`);
  if (evidence.downstreamAssets.length) notes.push(`${evidence.downstreamAssets.length} downstream assets depend on it`);

  await tx.execute({
    sql: `UPDATE proposals SET status = 'escalated', due_on = NULL, required_approvers = ?, evidence = ? WHERE id = ?`,
    args: [JSON.stringify(approvers), JSON.stringify(evidence), proposalId],
  });
  await appendAudit(tx, {
    simDate: date,
    actor: "policy",
    action: "review_escalated",
    assetId,
    proposalId,
    policyVersion: POLICY_VERSION,
    rationale:
      `No response within ${REVIEW_WINDOW_DAYS} days. Escalated to ${steward ?? "a data steward (none active)"}; ` +
      `not archived, archiving needs an approved proposal.${notes.length ? ` Note: ${notes.join("; ")}.` : ""}`,
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

/** Shared checks for every decision: open proposal, required approver, active, reason on reject (Rules 5, 11). */
export async function validateDecision(tx: Db, input: DecisionInput): Promise<{ p: Proposal; reason: string }> {
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
  return { p, reason };
}

/** Closes the proposal and writes the decision row and its audit entry. */
export async function recordDecision(tx: Db, p: Proposal, input: DecisionInput, reason: string, date: string) {
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
    assetId: p.assetIds[0],
    proposalId: p.id,
    rationale: reason || `Approved ${p.type}.`,
  });
}

/** Owner decision on a lease review. Any decision closes the review (D14). */
export async function decide(db: Client, input: DecisionInput, date: string): Promise<Proposal> {
  const tx = await db.transaction("write");
  try {
    const { p, reason } = await validateDecision(tx, input);
    if (p.type === "build_temporary") {
      throw new LifecycleError("Build proposals are decided by the build service (decideBuild)", "invalid");
    }

    const assetId = p.assetIds[0];
    // approve renew / reject retire -> renew; approve retire / reject renew -> retire.
    const renew = (p.type === "renew") === (input.action === "approve");
    await recordDecision(tx, p, input, reason, date);

    if (p.type === "promote") {
      if (input.action === "approve") {
        const leaseEnd = addDays(date, LEASE_DAYS);
        await tx.execute({
          sql: `UPDATE asset_state SET tier = 'team', ttl_end = NULL, lease_end = ?, status = 'active' WHERE asset_id = ?`,
          args: [leaseEnd, assetId],
        });
        await appendAudit(tx, {
          simDate: date,
          actor: input.actor,
          action: "promoted",
          assetId,
          proposalId: p.id,
          policyVersion: POLICY_VERSION,
          rationale: `Promoted to Team after use across the team; lease until ${leaseEnd}. Owner unchanged (D14).`,
        });
      }
      // Rejected: nothing changes; a Temporary insight's 30-day expiry resumes.
      await tx.commit();
      return (await getProposal(db, p.id))!;
    }

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

/** Same as registerTemporary, inside a caller's transaction (used by the build step). */
export async function registerTemporaryTx(
  tx: Db,
  input: { assetId: string; name: string; ownerId: string; approvedBy: string; proposalId?: string },
  date: string,
): Promise<void> {
  const ttlEnd = addDays(date, TTL_DAYS);
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
}

/** Registers an approved build as a Temporary insight with a 30-day TTL. Called by the build step. */
export async function registerTemporary(
  db: Client,
  input: { assetId: string; name: string; ownerId: string; approvedBy: string; proposalId?: string },
  date: string,
): Promise<AssetState> {
  const tx = await db.transaction("write");
  try {
    await registerTemporaryTx(tx, input, date);
    await tx.commit();
    return (await getAssetState(db, input.assetId))!;
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}

// D17: once enough distinct people in the owner's region have opened a
// Temporary insight, a Lead in that region is asked to promote it to Team.
// The 30-day expiry is held while the proposal waits.
async function proposeTeamIfUsedByTeam(tx: Db, s: AssetState, date: string) {
  const pending = await tx.execute({
    sql: `SELECT 1 FROM proposals WHERE type = 'promote' AND status IN ('open', 'escalated') AND json_extract(asset_ids, '$[0]') = ?`,
    args: [s.assetId],
  });
  if (pending.rows.length) return;
  const owner = await tx.execute({ sql: `SELECT scope FROM Owners WHERE owner_id = ?`, args: [s.ownerId] });
  const region = owner.rows[0]?.scope as string | undefined;
  if (!region) return;
  const users = await tx.execute({
    sql: `SELECT DISTINCT u.user_id FROM usage_events u JOIN Owners o ON o.owner_id = u.user_id
          WHERE u.asset_id = ? AND o.scope = ? ORDER BY u.user_id`,
    args: [s.assetId, region],
  });
  const ids = users.rows.map((r) => r.user_id as string);
  if (ids.length < TEAM_USERS) return;
  // Any active Lead in the region except the owner (no self-approval); else the region's steward.
  const leads = await tx.execute({
    sql: `SELECT owner_id FROM Owners WHERE role LIKE '%Lead%' AND status = 'active' AND scope = ? AND owner_id != ? ORDER BY owner_id`,
    args: [region, s.ownerId],
  });
  const steward = leads.rows.length ? null : await regionSteward(tx, s.ownerId);
  const approvers = leads.rows.length ? leads.rows.map((r) => r.owner_id as string) : steward ? [steward] : [];
  const id = `PRP-${s.assetId}-team-${date}`;
  const evidence: PromoteEvidence = {
    kind: "team_use",
    region,
    users: ids,
    threshold: TEAM_USERS,
    ttlEnd: s.ttlEnd,
    source: [{ sheet: "usage_events (app)", ids: [s.assetId] }, { sheet: "Owners", ids }],
  };
  const rationale =
    `${ids.length} people in ${region} opened this Temporary insight (threshold ${TEAM_USERS}). ` +
    `Proposed: promote to Team. Its 30-day expiry is on hold while a Lead in ${region} decides.`;
  await tx.execute({
    sql: `INSERT INTO proposals (id, version, type, asset_ids, rationale, evidence, required_approvers, status, created_on, due_on)
          VALUES (?, 1, 'promote', ?, ?, ?, ?, 'open', ?, NULL)`,
    args: [id, JSON.stringify([s.assetId]), rationale, JSON.stringify(evidence), JSON.stringify(approvers), date],
  });
  await appendAudit(tx, {
    simDate: date,
    actor: "policy",
    action: "promotion_proposed",
    assetId: s.assetId,
    proposalId: id,
    policyVersion: POLICY_VERSION,
    rationale,
    evidence,
  });
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
    if (s.status === "active" && s.tier === "temporary" && s.ownerId && s.ownerId !== input.userId) {
      await proposeTeamIfUsedByTeam(tx, s, date);
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

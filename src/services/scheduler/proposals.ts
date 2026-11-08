// T24 (B3): from a scheduler finding to a governed merge proposal.
//
// Flow: a manager inspects an open overlap finding, chooses which asset is
// merged away and which is kept, and asks for a proposal. The backend
// re-runs the comparator, re-checks both assets and the chosen direction,
// and only then calls the existing proposeMerge (estate/merge.ts) as is: its
// D14 checks, its two-owner required approvers (an inactive owner replaced by
// the region's steward; a side with neither is refused, see MERGE-APPROVERS
// below) and its merge_proposed audit row. The proposal then
// waits in the existing Inbox and is decided there by the lifecycle engine.
// Nothing here approves, archives, changes KPI definitions or creates a
// proposal on its own: detection is not permission.
//
// Atomicity and concurrency: revalidation, proposeMerge, the link row, the
// finding's proposal_id and the scheduler audit row run in ONE scheduler
// write transaction (BEGIN IMMEDIATE, db.ts writeTx). proposeMerge and the
// estate readers only call `execute`, which the scheduler transaction
// provides; any other client method throws there, so a future change to them
// fails loudly instead of escaping the transaction. Concurrent raises are
// serialised by the write lock: the second sees the first's link and gets it
// back unchanged. A partial unique index allows one pending link per finding.
//
// Outcome (Codex B3-F1): the lifecycle `proposals` row is the only source of
// truth. Every scheduler read (getFinding / listFindings via findings.ts,
// previewFindingProposal, listFindingProposals, the raise itself) joins that
// row and derives pending (open / escalated) / approved / rejected / expired
// from it on the spot. A link whose proposal row is gone (`missing`, e.g. a
// partial cleanup) is stale: it is kept as history but never shown as the
// finding's proposal and never blocks a raise. A demo reset drops the link
// table together with proposals (lifecycle APP_TABLES), so no link outlives it.
// The decision path (lifecycle decide, Inbox) is not hooked or changed and
// never writes scheduler state, so an approval can never fail or look failed
// because of the scheduler.
// The stored link outcome and scheduler_findings.proposal_id are a cache that
// no read uses. They are refreshed only at explicit, idempotent scheduler
// write boundaries: at the start of every raise (inside its own transaction,
// so the one-pending-link index reflects live state) and by
// syncFindingProposals. An interrupted or skipped refresh changes nothing
// anyone sees.
//
// Direction (Codex B3-F2): the manager chooses which asset is merged away
// (source) and which is kept (target). That choice is what is checked, sent
// to proposeMerge, recorded on the link and stated in the proposal rationale.
// The comparator's own preferred direction (suggestMerge keeps the higher
// tier, then the more used side, for otherwise equal pairs; usage moves with
// the clock) is recorded separately as comparison evidence
// (comparatorPreferredDirection, againstComparator) and is never treated as
// authorisation: a direction is allowed only by the checks below. Note that
// proposeMerge's own evidence.reason is the comparator's wording and can
// describe the opposite direction; the rationale says so when it does.
//
// Tier policy: a Temporary insight never replaces a certified asset. Whether a
// Personal or Team asset may replace a Certified dashboard (and who would sign
// it off) is an unresolved product policy question (Codex B3-F4): such a
// direction is blocked with `certified_replacement_policy`, never authorised.
//
// Rejection suppression: a rejected or expired proposal blocks a new raise
// while the finding's fingerprint is the one it was raised on. Only a
// material evidence change (new fingerprint after a scheduler run) makes it
// eligible again.
//
// Gate: FINDING_PROPOSALS_ENABLED switches the HTTP POST route. See below.
import { randomUUID } from "node:crypto";
import type { Client, Transaction } from "@libsql/client";
import { loadEstate, proposeMerge, type EstateAsset } from "../estate";
import { LifecycleError, POLICY_VERSION, appendAudit, getProposal, readClock, type Db, type Proposal, type ProposalStatus } from "../lifecycle";
import { scopeFit } from "../steward/discovery";
import { withReadClient, writeTx } from "./db";
import { OVERLAP_RULE, assessAsset, type Comparator } from "./overlap";
import type {
  DirectionCheck,
  EligibilityReason,
  FindingProposalBlocker,
  FindingProposalBlockerId,
  FindingProposalAction,
  FindingProposalLink,
  FindingProposalOutcome,
  FindingProposalPreview,
  MergeDirection,
  RaiseFindingProposalInput,
  RaiseFindingProposalResult,
} from "./proposal-types";
import { ensureScheduler } from "./schema";
import { SchedulerError, type OverlapEvidence } from "./types";

/**
 * Switch for POST /api/scheduler/findings/[id]/proposal. OFF on purpose.
 *
 * Already met: B0 (lifecycle: archiving closes the asset's other open
 * proposals so a later reject cannot reactivate it; decide refuses renew /
 * retire / promote on an archived asset). It is on master since 16c868d (#36,
 * Viet; tests/estate.test.ts "proposal_closed") and in this branch's base.
 *
 * Turning it on still requires ALL of:
 * 1. MERGE-APPROVERS (Codex P1 on src/services/estate/merge.ts, Viet's code):
 *    proposeMerge used to drop a side with no active approver (inactive
 *    owner and no region steward) and still create the proposal. Fixed in
 *    the T25 integration: proposeMerge refuses unless both sides have an
 *    approver, and the engine refuses to approve a stored merge that does
 *    not require both (tests/scheduler-integration.test.ts). Not duplicated
 *    here. Still blocking until Viet, who owns merge.ts, has reviewed it.
 * 2. CODEX-REVIEW: a Codex review of this module with B0 and MERGE-APPROVERS in place.
 * Separate, unresolved product policy (not a switch condition; enforced as an
 * eligibility block): a Personal or Team asset replacing a Certified dashboard.
 * Not configurable from the environment by design; change it in code review.
 * The service functions below are usable (and tested) regardless.
 */
export const FINDING_PROPOSALS_ENABLED: boolean = false;

/** What the switch waits for, in order. IDs appear in the 409 and preview `blockedBy`. */
export const FINDING_PROPOSALS_BLOCKERS: readonly FindingProposalBlocker[] = [
  {
    id: "MERGE-APPROVERS",
    description: "proposeMerge refuses when either side has no active approver (fixed in T25); awaiting review by Viet, owner of estate/merge.ts",
  },
  { id: "CODEX-REVIEW", description: "Codex review of finding proposals with B0 and MERGE-APPROVERS in the base" },
];
export const FINDING_PROPOSALS_BLOCKED_BY: readonly FindingProposalBlockerId[] = FINDING_PROPOSALS_BLOCKERS.map((b) => b.id);

export const FINDING_PROPOSAL_ACTIONS: readonly FindingProposalAction[] = ["merge"];

type Row = Record<string, unknown>;

/** The scheduler transaction offers `execute` only; the estate readers and proposeMerge need no more (see header). */
const asClient = (r: Db) => r as unknown as Client;

type FindingRow = {
  findingId: string;
  dedupKey: string;
  ruleId: string;
  assetIds: string[];
  status: string;
  evidence: OverlapEvidence;
  fingerprint: string;
};

async function readFinding(r: Db, findingId: string): Promise<FindingRow | null> {
  const res = await r.execute({ sql: `SELECT * FROM scheduler_findings WHERE finding_id = ?`, args: [findingId] });
  const x = res.rows[0] as Row | undefined;
  if (!x) return null;
  return {
    findingId: x.finding_id as string,
    dedupKey: x.dedup_key as string,
    ruleId: x.rule_id as string,
    assetIds: JSON.parse(x.asset_ids as string) as string[],
    status: x.status as string,
    evidence: JSON.parse(x.evidence as string) as OverlapEvidence,
    fingerprint: x.fingerprint as string,
  };
}

export function outcomeOf(status: ProposalStatus | null | undefined): FindingProposalOutcome {
  if (status === "open" || status === "escalated") return "pending";
  if (status === "approved" || status === "rejected" || status === "expired") return status;
  return "missing";
}

/** Links for one finding (or all), oldest first, with the outcome read live from the proposals table. Read-only. */
async function readLinks(r: Db, findingId?: string): Promise<FindingProposalLink[]> {
  const res = await r.execute({
    sql: `SELECT l.*, p.status AS proposal_status FROM scheduler_finding_proposals l
          LEFT JOIN proposals p ON p.id = l.proposal_id
          ${findingId ? "WHERE l.finding_id = ?" : ""} ORDER BY l.created_at, l.link_id`,
    args: findingId ? [findingId] : [],
  });
  const out: FindingProposalLink[] = [];
  for (const x of res.rows as unknown as Row[]) {
    const d = await r.execute({
      sql: `SELECT actor, action, reason, sim_date FROM decisions WHERE proposal_id = ? ORDER BY rowid`,
      args: [x.proposal_id as string],
    });
    const evidence = JSON.parse(x.evidence as string) as OverlapEvidence;
    const preferred = preferredOf(evidence)!;
    out.push({
      linkId: x.link_id as string,
      findingId: x.finding_id as string,
      proposalId: x.proposal_id as string,
      action: x.action as FindingProposalAction,
      sourceId: x.source_id as string,
      targetId: x.target_id as string,
      actor: x.actor as string,
      createdAt: x.created_at as string,
      simDate: x.sim_date as string,
      comparatorPreferredDirection: preferred,
      againstComparator: preferred.sourceId !== x.source_id || preferred.targetId !== x.target_id,
      fingerprint: x.fingerprint as string,
      evidence,
      outcome: outcomeOf(x.proposal_status as ProposalStatus | null),
      storedOutcome: x.outcome as FindingProposalOutcome,
      outcomeSyncedAt: (x.outcome_synced_at as string | null) ?? null,
      decisions: (d.rows as unknown as Row[]).map((y) => ({
        actor: y.actor as string,
        action: y.action as string,
        reason: (y.reason as string | null) ?? null,
        simDate: y.sim_date as string,
      })),
    });
  }
  return out;
}

const covers = (outer: EstateAsset, inner: EstateAsset) =>
  scopeFit("product", inner.product, outer.product) !== null && scopeFit("market", inner.market, outer.market) !== null;

/** proposeMerge's proposal ID (estate/merge.ts); checked up front so a same-day re-raise gets a reason, not a constraint error. */
const mergeProposalId = (sourceId: string, targetId: string, date: string) => `PRP-MERGE-${sourceId}-INTO-${targetId}-${date}`;

const reason = (code: EligibilityReason["code"], message: string): EligibilityReason => ({ code, message });

type Evaluation = {
  general: EligibilityReason[];
  directions: DirectionCheck[];
  currentFingerprint: string | null;
  current: OverlapEvidence | null;
};

/**
 * Every check behind a raise, read-only. `general` applies to the finding
 * whatever the direction; `directions` holds each merge direction's own checks.
 */
async function evaluate(
  r: Db,
  f: FindingRow,
  links: FindingProposalLink[],
  opts: { expectedFingerprint?: string; date: string; compare?: Comparator },
): Promise<Evaluation> {
  const general: EligibilityReason[] = [];
  const [a, b] = f.assetIds;
  const directions: DirectionCheck[] = [
    { sourceId: a, targetId: b, allowed: false, reasons: [], comparatorPreferred: false },
    { sourceId: b, targetId: a, allowed: false, reasons: [], comparatorPreferred: false },
  ];
  let currentFingerprint: string | null = null;
  let current: OverlapEvidence | null = null;

  if (f.ruleId !== OVERLAP_RULE.ruleId) general.push(reason("unsupported_rule", `Rule ${f.ruleId} has no proposal action`));
  if (f.status !== "open") general.push(reason("finding_not_open", `Finding ${f.findingId} is ${f.status}; only an open finding can be raised`));

  const pending = links.find((l) => l.outcome === "pending");
  if (pending) general.push(reason("already_pending", `${pending.proposalId} from this finding is waiting in the Inbox`));
  // A `missing` link (its proposal row is gone) is stale and ignored.
  const done = links.filter((l) => l.fingerprint === f.fingerprint && l.outcome !== "pending" && l.outcome !== "missing");
  for (const l of done) {
    general.push(
      l.outcome === "approved"
        ? reason("already_approved", `${l.proposalId} was approved on this evidence`)
        : reason(
            "rejected_same_evidence",
            `${l.proposalId} was ${l.outcome} on this evidence; it can be raised again only after the evidence changes`,
          ),
    );
  }
  if (opts.expectedFingerprint !== undefined && opts.expectedFingerprint !== f.fingerprint) {
    general.push(reason("stale_client", "The finding changed since you looked at it; reload it before raising a proposal"));
  }

  const estate = await loadEstate(asClient(r));
  const assets = f.assetIds.map((id) => estate.find((x) => x.assetId === id));
  let assetsOk = true;
  f.assetIds.forEach((id, i) => {
    const x = assets[i];
    if (!x) {
      general.push(reason("asset_unknown", `${id} is no longer in the catalog or the built insights`));
      assetsOk = false;
    } else if (x.status !== "active") {
      general.push(reason("asset_not_active", `${id} is ${x.status}; both sides must be active`));
      assetsOk = false;
    } else if (x.kpiIds.length === 0) {
      general.push(reason("asset_no_kpis", `${id} maps no KPIs`));
      assetsOk = false;
    }
  });

  if (assetsOk && f.ruleId === OVERLAP_RULE.ruleId) {
    // Same comparator, same estate view as the scheduler run; triggers are irrelevant to the fingerprint.
    const changed = f.assetIds.includes(f.evidence.changedAssetId) ? f.evidence.changedAssetId : a;
    const { observations } = await assessAsset(asClient(r), { assetId: changed, triggers: [], estate, date: opts.date, compare: opts.compare });
    const obs = observations.find((o) => o.dedupKey === f.dedupKey);
    if (!obs) {
      general.push(reason("stale_evidence", "The comparator no longer reports a merge overlap for this pair; run the scheduler again"));
    } else {
      currentFingerprint = obs.fingerprint;
      current = obs.evidence;
      for (const d of directions) d.comparatorPreferred = d.sourceId === obs.evidence.mergeAway.assetId && d.targetId === obs.evidence.keep.assetId;
      if (obs.fingerprint !== f.fingerprint) {
        general.push(reason("stale_evidence", "The evidence changed since the last scheduler run; run it again before raising a proposal"));
      }
    }
  }

  if (assetsOk) {
    const open = await r.execute({
      sql: `SELECT id FROM proposals WHERE status IN ('open', 'escalated') AND (
              EXISTS (SELECT 1 FROM json_each(asset_ids) WHERE value IN (?, ?))
              OR (type = 'merge' AND json_extract(evidence, '$.targetId') IN (?, ?)))
            ORDER BY id`,
      args: [a, b, a, b],
    });
    // A pending link's own proposal is reported once, as already_pending.
    const others = (open.rows as unknown as Row[]).map((x) => x.id as string).filter((id) => id !== pending?.proposalId);
    if (others.length) general.push(reason("asset_under_review", `${a} or ${b} is already under review (${others.join(", ")})`));

    for (const d of directions) {
      const source = estate.find((x) => x.assetId === d.sourceId)!;
      const target = estate.find((x) => x.assetId === d.targetId)!;
      if (!covers(target, source)) {
        d.reasons.push(
          reason(
            "target_does_not_cover_scope",
            `${target.assetId} (${target.product} · ${target.market}) does not cover ${source.assetId}'s scope (${source.product} · ${source.market})`,
          ),
        );
      }
      const missing = source.kpiIds.filter((k) => !target.kpiIds.includes(k));
      if (missing.length) d.reasons.push(reason("target_lacks_kpis", `${target.assetId} lacks ${missing.join(", ")}; merging would drop them`));
      if (target.tier === "temporary" && source.tier === "certified") {
        d.reasons.push(
          reason("temporary_over_certified", `A Temporary insight (${target.assetId}) cannot replace a certified asset (${source.assetId})`),
        );
      } else if (source.tier === "certified" && target.tier !== "certified") {
        // Codex B3-F4: unresolved product policy. No rule says whether a Personal or Team (or
        // unknown-tier) asset may replace a Certified dashboard, or who would have to sign that off;
        // blocked rather than authorised by the two owners alone. No approver role or certification
        // exception is invented here.
        d.reasons.push(
          reason(
            "certified_replacement_policy",
            `Blocked by policy: whether a ${target.tier} asset (${target.assetId}) may replace a Certified dashboard ` +
              `(${source.assetId}) is an unresolved product policy question (no approver or certification rule exists yet)`,
          ),
        );
      }
      const id = mergeProposalId(source.assetId, target.assetId, opts.date);
      const taken = await r.execute({ sql: `SELECT status FROM proposals WHERE id = ?`, args: [id] });
      if (taken.rows[0] && !pending) {
        d.reasons.push(reason("proposal_id_taken", `${id} already exists (${taken.rows[0].status as string}); raise it on a later simulated day`));
      }
      d.allowed = d.reasons.length === 0;
    }
  }
  return { general, directions, currentFingerprint, current };
}

function verdict(ev: Evaluation, direction?: { sourceId: string; targetId: string }) {
  if (!direction) {
    const any = ev.directions.some((d) => d.allowed);
    const why = any ? [] : ev.directions.flatMap((d) => d.reasons);
    return { eligible: ev.general.length === 0 && any, reasons: [...ev.general, ...why] };
  }
  const d = ev.directions.find((x) => x.sourceId === direction.sourceId && x.targetId === direction.targetId);
  const why = d
    ? d.reasons
    : [reason("direction_not_in_finding", `${direction.sourceId} -> ${direction.targetId} is not a merge of this finding's two assets`)];
  return { eligible: ev.general.length === 0 && why.length === 0, reasons: [...ev.general, ...why] };
}

const preferredOf = (e: OverlapEvidence | null): MergeDirection | null =>
  e ? { sourceId: e.mergeAway.assetId, targetId: e.keep.assetId } : null;

const normId = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : "");

/**
 * Read-only eligibility preview for GET /api/scheduler/findings/[id]/proposal.
 * Writes nothing (the outcome is read live from the proposals table).
 */
export async function previewFindingProposal(
  db: Client,
  input: { findingId: string; sourceId?: string; targetId?: string; expectedFingerprint?: string },
  opts: { compare?: Comparator } = {},
): Promise<FindingProposalPreview> {
  await ensureScheduler(db);
  return withReadClient(db, async (r) => {
    const f = await readFinding(r, input.findingId);
    if (!f) throw new SchedulerError(`Unknown finding ${input.findingId}`, "not_found");
    const links = await readLinks(r, f.findingId);
    const date = (await readClock(r)).date;
    const ev = await evaluate(r, f, links, { expectedFingerprint: input.expectedFingerprint, date, compare: opts.compare });
    const direction = input.sourceId || input.targetId ? { sourceId: normId(input.sourceId), targetId: normId(input.targetId) } : undefined;
    const { eligible, reasons } = verdict(ev, direction);
    return {
      findingId: f.findingId,
      action: "merge",
      eligible,
      reasons,
      enabled: FINDING_PROPOSALS_ENABLED,
      ...(FINDING_PROPOSALS_ENABLED ? {} : { blockedBy: [...FINDING_PROPOSALS_BLOCKED_BY] }),
      findingFingerprint: f.fingerprint,
      currentFingerprint: ev.currentFingerprint,
      directions: ev.directions,
      comparatorPreferredDirection: preferredOf(ev.current),
      link: links.find((l) => l.outcome === "pending") ?? links.filter((l) => l.outcome !== "missing").at(-1) ?? null,
      links,
    };
  });
}

/**
 * Refreshes the cache: writes each link's live outcome to the link row; a
 * proposal closed without approval (rejected, expired, missing) also clears
 * the cached scheduler_findings.proposal_id (the link keeps the history).
 * Idempotent; returns how many links changed. No read depends on it.
 */
async function syncTx(tx: Transaction, nowIso: string, findingId?: string): Promise<number> {
  let changed = 0;
  for (const l of await readLinks(tx, findingId)) {
    if (l.outcome === l.storedOutcome) continue;
    await tx.execute({
      sql: `UPDATE scheduler_finding_proposals SET outcome = ?, outcome_synced_at = ? WHERE link_id = ?`,
      args: [l.outcome, nowIso, l.linkId],
    });
    if (l.outcome !== "pending" && l.outcome !== "approved") {
      await tx.execute({
        sql: `UPDATE scheduler_findings SET proposal_id = NULL WHERE finding_id = ? AND proposal_id = ?`,
        args: [l.findingId, l.proposalId],
      });
    }
    changed++;
  }
  return changed;
}

/** Refreshes the cached link outcomes from the proposals table in a scheduler write. Optional: reads never depend on it. */
export async function syncFindingProposals(db: Client, input: { findingId?: string } = {}, nowIso = new Date().toISOString()): Promise<{ changed: number }> {
  await ensureScheduler(db);
  return { changed: await writeTx(db, (tx) => syncTx(tx, nowIso, input.findingId)) };
}

/** Links for a finding, oldest first, outcome read live. Read-only. */
export async function listFindingProposals(db: Client, findingId: string): Promise<FindingProposalLink[]> {
  await ensureScheduler(db);
  return readLinks(db, findingId);
}

/**
 * Raises a merge proposal from an open overlap finding on a manager's
 * explicit choice of direction. Revalidates everything (see evaluate) inside
 * the write transaction, then calls proposeMerge unchanged. Idempotent: if an
 * open proposal already links the finding it is returned with created=false.
 * Throws SchedulerError: invalid (bad input), not_found, conflict (stale or
 * ineligible; detail carries `reasons`, `stale`, `currentFingerprint`).
 */
export async function raiseFindingProposal(
  db: Client,
  input: RaiseFindingProposalInput,
  opts: { compare?: Comparator; nowIso?: string } = {},
): Promise<RaiseFindingProposalResult> {
  const actor = typeof input.actor === "string" ? input.actor.trim() : "";
  if (!actor) throw new SchedulerError("actor is required", "invalid");
  if (!FINDING_PROPOSAL_ACTIONS.includes(input.action)) {
    throw new SchedulerError(`action must be one of ${FINDING_PROPOSAL_ACTIONS.join(", ")}`, "invalid");
  }
  const sourceId = normId(input.sourceId);
  const targetId = normId(input.targetId);
  if (!sourceId || !targetId) throw new SchedulerError("sourceId (merged away) and targetId (kept) are required", "invalid");
  if (typeof input.expectedFingerprint !== "string" || !input.expectedFingerprint) {
    throw new SchedulerError("expectedFingerprint is required (the finding fingerprint you inspected)", "invalid");
  }
  const nowIso = opts.nowIso ?? new Date().toISOString();
  await ensureScheduler(db);

  const out = await writeTx(db, async (tx) => {
    await syncTx(tx, nowIso, input.findingId);
    const f = await readFinding(tx, input.findingId);
    if (!f) throw new SchedulerError(`Unknown finding ${input.findingId}`, "not_found");
    const links = await readLinks(tx, f.findingId);
    const pending = links.find((l) => l.outcome === "pending");
    if (pending) return { created: false, linkId: pending.linkId, proposalId: pending.proposalId };

    const date = (await readClock(tx)).date;
    const ev = await evaluate(tx, f, links, { expectedFingerprint: input.expectedFingerprint, date, compare: opts.compare });
    const { eligible, reasons } = verdict(ev, { sourceId, targetId });
    if (!eligible || !ev.current) {
      const stale = reasons.some((x) => x.code === "stale_client" || x.code === "stale_evidence");
      throw new SchedulerError(
        stale ? "The finding's evidence is stale; reload it (and run the scheduler) before raising a proposal" : "This finding cannot be raised as a proposal",
        "conflict",
        { reasons, stale, findingFingerprint: f.fingerprint, currentFingerprint: ev.currentFingerprint },
      );
    }

    let proposal: Proposal;
    try {
      proposal = await proposeMerge(asClient(tx), { sourceId, targetId, requestedBy: actor }, date);
    } catch (err) {
      if (err instanceof LifecycleError) throw new SchedulerError(`The merge proposal was refused: ${err.message}`, "conflict", { lifecycleCode: err.code });
      throw err;
    }
    // The proposal must carry exactly the manager's direction (proposeMerge normalises IDs; nothing else may differ).
    const pe = proposal.evidence as { kind?: string; sourceId?: string; targetId?: string };
    if (pe.kind !== "merge_pair" || pe.sourceId !== sourceId || pe.targetId !== targetId || proposal.assetIds[0] !== sourceId) {
      throw new SchedulerError(`${proposal.id} does not record ${sourceId} -> ${targetId}; nothing was raised`, "conflict");
    }

    // B3-F2: the rationale states the chosen direction and labels the comparator's preference as evidence.
    const preferred = preferredOf(ev.current)!;
    const againstComparator = preferred.sourceId !== sourceId || preferred.targetId !== targetId;
    const directionNote =
      ` Direction chosen by ${actor} from scheduler finding ${f.findingId}: ${sourceId} is merged into ${targetId}. ` +
      (againstComparator
        ? `Comparison evidence only, not an authorisation: the overlap comparator preferred the opposite direction ` +
          `(${preferred.sourceId} into ${preferred.targetId}); the comparator reason in the evidence describes that direction.`
        : `Comparison evidence only, not an authorisation: the overlap comparator preferred the same direction.`);
    const named = await tx.execute({
      sql: `UPDATE proposals SET rationale = rationale || ? WHERE id = ? AND status = 'open' AND version = 1`,
      args: [directionNote, proposal.id],
    });
    if (named.rowsAffected !== 1) throw new SchedulerError(`${proposal.id} changed during the raise`, "conflict");

    const linkId = `FPL-${randomUUID()}`;
    await tx.execute({
      sql: `INSERT INTO scheduler_finding_proposals (link_id, finding_id, proposal_id, action, source_id, target_id, actor,
              created_at, sim_date, fingerprint, evidence, outcome, outcome_synced_at)
            VALUES (?, ?, ?, 'merge', ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      args: [linkId, f.findingId, proposal.id, sourceId, targetId, actor, nowIso, date, f.fingerprint, JSON.stringify(ev.current), nowIso],
    });
    const upd = await tx.execute({
      sql: `UPDATE scheduler_findings SET proposal_id = ? WHERE finding_id = ? AND status = 'open'`,
      args: [proposal.id, f.findingId],
    });
    if (upd.rowsAffected !== 1) throw new SchedulerError(`Finding ${f.findingId} changed during the raise`, "conflict");
    await appendAudit(tx, {
      simDate: date,
      actor,
      action: "scheduler_finding_proposal_raised",
      assetId: sourceId,
      proposalId: proposal.id,
      policyVersion: POLICY_VERSION,
      rationale:
        `${actor} raised ${proposal.id} from finding ${f.findingId}: merge ${sourceId} into ${targetId}, direction chosen by ${actor} ` +
        `(approval needed from ${proposal.requiredApprovers.join(" and ")}).` +
        (againstComparator ? ` The comparator preferred ${preferred.sourceId} into ${preferred.targetId} (comparison evidence only).` : ""),
      evidence: {
        findingId: f.findingId,
        linkId,
        ruleId: f.ruleId,
        fingerprint: f.fingerprint,
        chosen: { sourceId, targetId, chosenBy: actor },
        comparatorPreferredDirection: preferred,
        againstComparator,
        comparatorRole: "comparison evidence only; not an authorisation",
      },
    });
    return { created: true, linkId, proposalId: proposal.id };
  });

  const link = (await readLinks(db, input.findingId)).find((l) => l.linkId === out.linkId)!;
  const proposal = (await getProposal(db, out.proposalId))!;
  return { created: out.created, link, proposal };
}

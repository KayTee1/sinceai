// Merge suggestions and merge proposals (T22).
//
// suggestMerge is read-only: for an asset (or every active asset in a scope)
// it finds other active assets whose scope covers it and that map its KPIs,
// and says whether to merge, keep both, or that the overlap is only partial.
// Usage is per dashboard in the pack (Asset_Usage), not per metric, so
// interest in a single metric is unknown.
//
// proposeMerge stores a merge proposal that both owners must approve (an
// inactive owner is replaced by their region's data steward). The engine
// executes it on the last approval (lifecycle/engine.ts, decideMergeTx).
//
// Merge vs. duplicate scan: KayTee's fingerprint duplicate scan may later feed
// candidate pairs into the same proposeMerge; the rules here are ours.
import type { Client } from "@libsql/client";
import {
  LifecycleError,
  POLICY_VERSION,
  addDays,
  appendAudit,
  getProposal,
  regionSteward,
  type MergeEvidence,
  type Proposal,
} from "../lifecycle";
import { scopeFit } from "../steward/discovery";
import { loadEstate, type EstateAsset } from "./index";

/** TEAM ASSUMPTION: a target is bloated for a source when it adds at least this many unrelated KPIs... */
export const BLOAT_MIN_EXTRA = 4;
/** ...and more than this many times the source's own KPI count. */
export const BLOAT_RATIO = 2;
const TIER_RANK: Record<string, number> = { certified: 3, team: 2, personal: 1, temporary: 0 };

export type MergeVerdict = "merge" | "keep_both" | "partial";

export type MergeSide = EstateAsset & { packUsers: number | null; appOpens90d: number; approver: string | null };

export type MergeSuggestion = {
  verdict: MergeVerdict;
  /** merge: the asset merged away and the one kept. keep_both / partial: the asked-about asset and the overlapping one. */
  mergeAway: MergeSide;
  keep: MergeSide;
  sharedKpis: string[];
  /** KPIs of mergeAway that keep lacks (partial only). */
  missingKpis: string[];
  /** KPIs on keep that mergeAway's users never use. */
  extraKpis: string[];
  downstreamAssets: string[];
  reason: string;
};

export type MergeSuggestions = { total: number; suggestions: MergeSuggestion[]; note: string };

const USAGE_NOTE =
  "Usage is per dashboard (pack telemetry: average monthly users over its last 3 months; app opens in the last 90 days). " +
  "How many people look at one metric is unknown.";

async function usage(db: Client, assetId: string, date: string) {
  const pack = await db.execute({
    sql: `SELECT AVG(unique_users) AS u FROM (SELECT unique_users FROM Asset_Usage WHERE asset_id = ? ORDER BY month DESC LIMIT 3)`,
    args: [assetId],
  });
  const opens = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM usage_events WHERE asset_id = ? AND sim_date > ?`,
    args: [assetId, addDays(date, -90)],
  });
  const u = pack.rows[0]?.u;
  return { packUsers: u === null || u === undefined ? null : Math.round(Number(u)), appOpens90d: Number(opens.rows[0]?.n ?? 0) };
}

/** Owner when active, else the region's data steward. */
async function approverFor(db: Client, a: EstateAsset): Promise<string | null> {
  return a.ownerId && a.ownerActive ? a.ownerId : regionSteward(db, a.ownerId);
}

async function side(db: Client, a: EstateAsset, date: string): Promise<MergeSide> {
  return { ...a, ...(await usage(db, a.assetId, date)), approver: await approverFor(db, a) };
}

async function downstream(db: Client, assetId: string): Promise<string[]> {
  const r = await db.execute({
    sql: `SELECT DISTINCT target_id FROM Lineage_Edges WHERE source_id = ? AND edge_type = 'ASSET_TO_ASSET' ORDER BY target_id`,
    args: [assetId],
  });
  return r.rows.map((x) => x.target_id as string);
}

const covers = (outer: EstateAsset, inner: EstateAsset) =>
  scopeFit("product", inner.product, outer.product) !== null && scopeFit("market", inner.market, outer.market) !== null;

const label = (a: EstateAsset) => `${a.assetId} (${a.name})`;

function strength(s: MergeSide): [number, number] {
  return [TIER_RANK[s.tier] ?? 0, (s.packUsers ?? 0) + s.appOpens90d];
}

async function pair(db: Client, source: EstateAsset, target: EstateAsset, date: string): Promise<MergeSuggestion> {
  const shared = source.kpiIds.filter((k) => target.kpiIds.includes(k));
  const missing = source.kpiIds.filter((k) => !target.kpiIds.includes(k));
  const extra = target.kpiIds.filter((k) => !source.kpiIds.includes(k));
  let [away, keep] = [await side(db, source, date), await side(db, target, date)];
  const base = { sharedKpis: shared, missingKpis: missing, extraKpis: extra };

  if (missing.length > 0) {
    return {
      verdict: "partial",
      mergeAway: away,
      keep,
      ...base,
      downstreamAssets: [],
      reason: `${label(target)} lacks ${missing.join(", ")} of ${label(source)}; merging would drop them. Keep both.`,
    };
  }
  if (extra.length >= BLOAT_MIN_EXTRA && extra.length > BLOAT_RATIO * Math.max(1, source.kpiIds.length)) {
    return {
      verdict: "keep_both",
      mergeAway: away,
      keep,
      ...base,
      downstreamAssets: [],
      reason:
        `${label(target)} covers all ${shared.length} KPI(s) of ${label(source)} but adds ${extra.length} others its users ` +
        `do not use; merging would bury them in a crowded dashboard. Keep the focused ${source.assetId}` +
        `${extra.length ? `; if ${target.assetId}'s extra KPIs are unused, review that one instead` : ""}.`,
    };
  }
  // Identical scope and KPIs both ways: keep the higher tier, then the more used one.
  if (extra.length === 0 && covers(source, target)) {
    const [a, b] = [strength(away), strength(keep)];
    if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) [away, keep] = [keep, away];
  }
  const ds = await downstream(db, away.assetId);
  return {
    verdict: "merge",
    mergeAway: away,
    keep,
    ...base,
    extraKpis: keep.kpiIds.filter((k) => !away.kpiIds.includes(k)),
    downstreamAssets: ds,
    reason:
      `${label(keep)} already covers every KPI of ${label(away)} (${shared.join(", ")}) for the same or a broader scope. ` +
      `Merge ${away.assetId} into ${keep.assetId}: its users${ds.length ? ` and ${ds.length} downstream asset(s)` : ""} ` +
      `move to ${keep.assetId}; ${away.assetId} is archived (restorable).`,
  };
}

/** Merge candidates for one asset, or for every active asset in a scope (best pairs first). */
export async function suggestMerge(
  db: Client,
  input: { assetId?: string; product?: string; market?: string; limit?: number },
  date: string,
): Promise<MergeSuggestions> {
  const estate = (await loadEstate(db)).filter((a) => a.status !== "archived" && a.kpiIds.length > 0);
  let sources: EstateAsset[];
  if (input.assetId) {
    const id = input.assetId.trim().toUpperCase();
    const one = estate.find((a) => a.assetId === id);
    if (!one) throw new LifecycleError(`${id} is unknown, archived or maps no KPIs`, "not_found");
    sources = [one];
  } else {
    sources = estate.filter(
      (a) =>
        (!input.product || scopeFit("product", input.product, a.product) === "exact") &&
        (!input.market || scopeFit("market", input.market, a.market) === "exact"),
    );
  }

  const out: MergeSuggestion[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    for (const t of estate) {
      if (t.assetId === s.assetId || !covers(t, s) || !s.kpiIds.some((k) => t.kpiIds.includes(k))) continue;
      const key = [s.assetId, t.assetId].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(await pair(db, s, t, date));
    }
  }
  const rank: Record<MergeVerdict, number> = { merge: 0, keep_both: 1, partial: 2 };
  out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.sharedKpis.length - a.sharedKpis.length);
  // A scope scan only reports merges; for one asset every overlap is useful.
  const shown = input.assetId ? out : out.filter((x) => x.verdict === "merge");
  return { total: shown.length, suggestions: shown.slice(0, input.limit ?? 5), note: USAGE_NOTE };
}

/**
 * Stores a merge proposal of `sourceId` into `targetId` for both owners
 * (D14 checks: both active and not under review, the target's scope covers
 * the source's, and the target maps every source KPI).
 */
export async function proposeMerge(
  db: Client,
  input: { sourceId: string; targetId: string; requestedBy?: string },
  date: string,
): Promise<Proposal> {
  const [sourceId, targetId] = [input.sourceId.trim().toUpperCase(), input.targetId.trim().toUpperCase()];
  if (sourceId === targetId) throw new LifecycleError("Source and target are the same asset", "invalid");
  const estate = await loadEstate(db);
  const source = estate.find((a) => a.assetId === sourceId);
  const target = estate.find((a) => a.assetId === targetId);
  if (!source || !target) throw new LifecycleError(`Unknown asset ${!source ? sourceId : targetId}`, "not_found");
  for (const a of [source, target]) {
    if (a.status !== "active") throw new LifecycleError(`${a.assetId} is ${a.status}; both sides must be active`, "invalid");
  }
  if (!covers(target, source)) {
    throw new LifecycleError(`${targetId} (${target.product} · ${target.market}) does not cover ${sourceId}'s scope (${source.product} · ${source.market})`, "invalid");
  }
  const missing = source.kpiIds.filter((k) => !target.kpiIds.includes(k));
  if (missing.length) throw new LifecycleError(`${targetId} lacks ${missing.join(", ")}; merging would drop them`, "invalid");
  const open = await db.execute({
    sql: `SELECT id FROM proposals WHERE status IN ('open', 'escalated') AND (
            EXISTS (SELECT 1 FROM json_each(asset_ids) WHERE value IN (?, ?))
            OR (type = 'merge' AND json_extract(evidence, '$.targetId') IN (?, ?)))`,
    args: [sourceId, targetId, sourceId, targetId],
  });
  if (open.rows[0]) throw new LifecycleError(`${sourceId} or ${targetId} is already under review (${open.rows[0].id as string})`, "invalid");

  const s = await pair(db, source, target, date);
  const [sourceApprover, targetApprover] = [await approverFor(db, source), await approverFor(db, target)];
  const approvers = [...new Set([sourceApprover, targetApprover].filter((x): x is string => !!x))];
  if (approvers.length === 0) throw new LifecycleError("Nobody active can approve this merge", "invalid");

  const evidence: MergeEvidence = {
    kind: "merge_pair",
    sourceId,
    sourceName: source.name,
    targetId,
    targetName: target.name,
    sourceApprover,
    targetApprover,
    sharedKpis: s.sharedKpis,
    targetExtraKpis: target.kpiIds.filter((k) => !source.kpiIds.includes(k)),
    usage: {
      sourceUsers: s.mergeAway.assetId === sourceId ? s.mergeAway.packUsers : s.keep.packUsers,
      targetUsers: s.keep.assetId === targetId ? s.keep.packUsers : s.mergeAway.packUsers,
      sourceOpens90d: s.mergeAway.assetId === sourceId ? s.mergeAway.appOpens90d : s.keep.appOpens90d,
      targetOpens90d: s.keep.assetId === targetId ? s.keep.appOpens90d : s.mergeAway.appOpens90d,
    },
    downstreamAssets: await downstream(db, sourceId),
    approvals: [],
    reason: s.reason,
    source: [
      { sheet: "Asset_KPI_Map", ids: [sourceId, targetId] },
      { sheet: "Asset_Usage", ids: [sourceId, targetId] },
      { sheet: "Lineage_Edges", ids: [sourceId] },
    ],
  };
  const id = `PRP-MERGE-${sourceId}-INTO-${targetId}-${date}`;
  const rationale =
    `Merge ${label(source)} into ${label(target)}: ${targetId} covers all its KPIs (${evidence.sharedKpis.join(", ")}). ` +
    `Needs approval from ${approvers.join(" and ")}; on approval ${sourceId} is archived (restorable) and redirects to ${targetId}.`;
  await db.execute({
    sql: `INSERT INTO proposals (id, version, type, asset_ids, rationale, evidence, required_approvers, status, created_on, due_on)
          VALUES (?, 1, 'merge', ?, ?, ?, ?, 'open', ?, NULL)`,
    args: [id, JSON.stringify([sourceId]), rationale, JSON.stringify(evidence), JSON.stringify(approvers), date],
  });
  await appendAudit(db, {
    simDate: date,
    actor: input.requestedBy ?? "steward",
    action: "merge_proposed",
    assetId: sourceId,
    proposalId: id,
    policyVersion: POLICY_VERSION,
    rationale,
    evidence,
  });
  return (await getProposal(db, id))!;
}

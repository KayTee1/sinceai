// Rule active_overlap (T24): does a changed asset overlap an active asset?
//
// Reuses estate/merge.ts suggestMerge as is: its scope cover rule (exact, or
// Global / All Pharma), its KPI comparison and its merge / keep_both / partial
// verdicts and thresholds. No new thresholds here.
//
// suggestMerge(asset) only looks at assets that cover the asked one. A
// changed asset can also be the broader side (a new insight that covers an
// older board), so the rule also asks suggestMerge about each active asset
// the changed one covers and that shares a KPI, keeping only the pairs that
// include the changed asset. Only the "merge" verdict (the one suggestMerge
// itself reports in scope scans) becomes a finding; keep_both and partial
// overlaps are counted in the run's assessment. A finding records the
// overlap and suggestMerge's reasoning; it does not propose or perform a merge.
import { createHash } from "node:crypto";
import type { Client } from "@libsql/client";
import { loadEstate, suggestMerge, type EstateAsset, type MergeSide, type MergeSuggestion, type MergeSuggestions, type MergeVerdict } from "../estate";
import { scopeFit } from "../steward/discovery";
import type { AssetAssessment, ChangeTrigger, OverlapBasis, OverlapEvidence, OverlapSide, RuleRef } from "./types";

// overlap-v2 (T24 F2): the fingerprint basis includes each asset's governance tier.
export const OVERLAP_RULE: RuleRef = { ruleId: "active_overlap", version: "overlap-v2" };

/** Same signature as suggestMerge; tests inject failures through it. */
export type Comparator = (db: Client, input: { assetId: string; limit?: number }, date: string) => Promise<MergeSuggestions>;

export type Observation = { dedupKey: string; assetIds: string[]; evidence: OverlapEvidence; fingerprint: string };

const covers = (outer: EstateAsset, inner: EstateAsset) =>
  scopeFit("product", inner.product, outer.product) !== null && scopeFit("market", inner.market, outer.market) !== null;

const isActive = (a: EstateAsset) => a.status !== "archived";

export const dedupKeyFor = (assetIds: string[]) => `${OVERLAP_RULE.ruleId}:${[...assetIds].sort().join("|")}`;

function side(s: MergeSide): OverlapSide {
  return {
    assetId: s.assetId,
    name: s.name,
    origin: s.origin,
    product: s.product,
    market: s.market,
    tier: s.tier,
    ownerId: s.ownerId,
    kpiIds: [...s.kpiIds],
    packUsers: s.packUsers,
    appOpens90d: s.appOpens90d,
  };
}

type BasisSide = { assetId: string; product: string; market: string; tier: string; kpiIds: string[] };

export function basisOf(s: { mergeAway: BasisSide; keep: BasisSide }): OverlapBasis {
  return {
    verdict: "merge",
    assets: [s.mergeAway, s.keep]
      .map((a) => ({ assetId: a.assetId, product: a.product, market: a.market, tier: a.tier, kpiIds: [...new Set(a.kpiIds)].sort() }))
      .sort((x, y) => x.assetId.localeCompare(y.assetId)),
  };
}

/**
 * Material change = a change in the verdict or, for either asset, in its
 * scope (product, market), its KPI set or its governance tier.
 *
 * Tier is material: it is the asset's governed standing (Temporary,
 * Personal, Team, certified), suggestMerge ranks the sides by it, and a
 * dismissal of an overlap with a Temporary insight ("a one-off") says
 * nothing about the same overlap once that insight is Personal or Team.
 *
 * Not material, stored as evidence only:
 * - usage (pack users, app opens in 90 days): moves with the clock, and
 *   which side suggestMerge keeps moves with it for otherwise equal pairs;
 * - name, lease and TTL dates: renewals and renames do not change the
 *   overlap;
 * - owner: ownership cannot change in the app today and does not change the
 *   overlap; revisit when findings are routed to owners (B3);
 * - lifecycle status: an archived asset is not compared at all, and
 *   active / lease_due are both in the active estate.
 */
export const fingerprintOf = (b: OverlapBasis) => createHash("sha256").update(JSON.stringify(b)).digest("hex");

function sourceRefs(sides: OverlapSide[], downstream: string[], changedAssetId: string, triggers: ChangeTrigger[]) {
  const catalog = sides.filter((s) => s.origin === "catalog").map((s) => s.assetId);
  const app = sides.filter((s) => s.origin === "app").map((s) => s.assetId);
  const refs: { sheet: string; ids: string[] }[] = [];
  if (catalog.length) refs.push({ sheet: "Analytics_Assets", ids: catalog }, { sheet: "Asset_KPI_Map", ids: catalog });
  if (app.length) refs.push({ sheet: "insights (app)", ids: app });
  if (downstream.length) refs.push({ sheet: "Lineage_Edges", ids: downstream });
  refs.push({ sheet: "audit_log (app)", ids: triggers.map((t) => String(t.auditId)) });
  refs.push({ sheet: "asset_state (app)", ids: [changedAssetId] });
  return refs;
}

function observe(s: MergeSuggestion, changedAssetId: string, triggers: ChangeTrigger[], usageNote: string): Observation {
  const mergeAway = side(s.mergeAway);
  const keep = side(s.keep);
  const basis = basisOf({ mergeAway, keep });
  const assetIds = basis.assets.map((a) => a.assetId);
  const evidence: OverlapEvidence = {
    kind: "active_overlap",
    changedAssetId,
    triggers,
    verdict: "merge",
    mergeAway,
    keep,
    sharedKpis: [...s.sharedKpis],
    extraKpis: [...s.extraKpis],
    downstreamAssets: [...s.downstreamAssets],
    reason: s.reason,
    usageNote,
    basis,
    source: sourceRefs([mergeAway, keep], s.downstreamAssets, changedAssetId, triggers),
  };
  return { dedupKey: dedupKeyFor(assetIds), assetIds, evidence, fingerprint: fingerprintOf(basis) };
}

const noOverlaps = (): Record<MergeVerdict, number> => ({ merge: 0, keep_both: 0, partial: 0 });

/**
 * Assesses one changed asset against the active estate. Read-only. `estate`
 * is loaded once per run by the caller.
 */
export async function assessAsset(
  db: Client,
  input: { assetId: string; triggers: ChangeTrigger[]; estate: EstateAsset[]; date: string; compare?: Comparator },
): Promise<{ assessment: AssetAssessment; observations: Observation[] }> {
  const { assetId, triggers, estate, date } = input;
  const compare: Comparator = input.compare ?? suggestMerge;
  const base = { assetId, triggers, overlaps: noOverlaps(), findingKeys: [] as string[] };
  const asset = estate.find((a) => a.assetId === assetId);

  if (!asset) {
    const st = await db.execute({ sql: `SELECT origin, status FROM asset_state WHERE asset_id = ?`, args: [assetId] });
    const row = st.rows[0];
    if (!row) return { assessment: { ...base, outcome: "unknown", reason: `No lifecycle or catalog record for ${assetId}.` }, observations: [] };
    return {
      assessment: {
        ...base,
        outcome: "unsupported",
        reason: `${assetId} (${row.origin}) has no catalog entry or built insight, so its scope and KPIs are unknown; overlap not assessed.`,
      },
      observations: [],
    };
  }
  if (!isActive(asset)) {
    return { assessment: { ...base, outcome: "inactive", reason: `${assetId} is archived now; nothing to compare.` }, observations: [] };
  }
  if (asset.kpiIds.length === 0) {
    return {
      assessment: { ...base, outcome: "unsupported", reason: `${assetId} maps no KPIs; overlap cannot be assessed from KPI coverage.` },
      observations: [],
    };
  }

  const limit = estate.length;
  const suggestions: MergeSuggestion[] = [];
  let usageNote = "";
  // The changed asset as the covered side.
  const forward = await compare(db, { assetId, limit }, date);
  usageNote = forward.note;
  suggestions.push(...forward.suggestions);
  // The changed asset as the covering side.
  const covered = estate.filter(
    (o) => o.assetId !== assetId && isActive(o) && covers(asset, o) && o.kpiIds.some((k) => asset.kpiIds.includes(k)),
  );
  for (const o of covered) {
    const r = await compare(db, { assetId: o.assetId, limit }, date);
    suggestions.push(...r.suggestions.filter((s) => s.keep.assetId === assetId || s.mergeAway.assetId === assetId));
  }

  // One verdict per pair; a merge in either direction wins (it is the one suggestMerge reports in scans).
  const byPair = new Map<string, MergeSuggestion>();
  const rank: Record<MergeVerdict, number> = { merge: 0, keep_both: 1, partial: 2 };
  for (const s of suggestions) {
    const key = dedupKeyFor([s.mergeAway.assetId, s.keep.assetId]);
    const prev = byPair.get(key);
    if (!prev || rank[s.verdict] < rank[prev.verdict]) byPair.set(key, s);
  }
  const overlaps = noOverlaps();
  const observations: Observation[] = [];
  for (const s of byPair.values()) {
    overlaps[s.verdict]++;
    if (s.verdict === "merge") observations.push(observe(s, assetId, triggers, usageNote));
  }
  const found = observations.length;
  return {
    assessment: {
      ...base,
      outcome: "evaluated",
      overlaps,
      findingKeys: observations.map((o) => o.dedupKey),
      reason:
        `Compared with ${byPair.size} overlapping active asset(s): ${overlaps.merge} merge, ` +
        `${overlaps.keep_both} keep both, ${overlaps.partial} partial` +
        (found ? `; ${found} finding(s).` : "; no finding."),
    },
    observations,
  };
}

/** Loads the estate once for a run (catalog references and built insights, read-only). */
export const loadRunEstate = loadEstate;

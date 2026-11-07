// Deterministic reuse-candidate discovery over Analytics_Assets.
// An asset is a candidate when its catalog scope covers the requested scope and
// it maps at least one requested metric (Asset_KPI_Map). Scores are a plain sum
// of named parts. Catalog metadata cannot show period, dimensions or filters,
// so those are always reported as unknown.
import type { Client } from "@libsql/client";
import { ALL_PRODUCTS, GLOBAL } from "./requests";
import type { CoverageItem, KpiCheck, KpiDefinition, MetricCoverage, ReuseCandidate, Scope, SourceRef } from "./types";

// TEAM-AUTHORED score weights (ours).
export const WEIGHTS = {
  metricApproved: 3, // per requested metric mapped via its approved canonical KPI
  metricVariantOnly: 1, // per requested metric mapped only via a non-approved variant
  scopeExact: 2,
  scopeBroader: 1,
  certified: 2,
  promoted: 1,
};

export const ALWAYS_UNKNOWN = [
  "period covered by the asset",
  "dimensions and breakdowns (e.g. by country)",
  "filters applied in the asset",
  "whether the asset answers the request (catalog metadata only)",
];

type AssetRow = {
  asset_id: string;
  asset_name: string;
  product_scope: string;
  market_scope: string;
  model_id: string | null;
  owner_id: string | null;
  lifecycle_status: string;
  endorsement: string;
  _source_row: number;
  owner_name: string | null;
  owner_status: string | null;
  owner_row: number | null;
  refresh_status: string | null;
  model_row: number | null;
};

type MapRow = { asset_id: string; kpi_id: string; usage_role: string; _source_row: number };

/** How an asset scope relates to a requested scope: exact, broader (covers it) or null (does not cover). */
/** A single-market asset never covers a region or Global request; only a Global asset does. */
export function scopeFit(field: "product" | "market", requested: string, asset: string) {
  if (asset === requested) return "exact" as const;
  const wildcard = field === "product" ? ALL_PRODUCTS : GLOBAL;
  if (asset === wildcard) return "broader" as const;
  return null;
}

/**
 * Presentation rule for a ranked candidate list: the first `limit` by score;
 * if none of them is a complete match, the best complete match takes the last
 * slot (it scores lowest of the shown list, so order stays by score). Shared
 * by discovery and the compact chat view (T16), so both truncate the same way.
 */
export function presentCandidates<T extends { coversAllMetrics: boolean }>(ranked: T[], limit: number): T[] {
  const shown = ranked.slice(0, limit);
  const best = ranked.find((c) => c.coversAllMetrics);
  if (!best || shown.some((c) => c.coversAllMetrics)) return shown;
  return [...ranked.slice(0, Math.max(0, limit - 1)), best];
}

export type DiscoveryResult = {
  /** Presentation list: top `limit` by score, always including the best complete match if one exists. */
  candidates: ReuseCandidate[];
  /** Counts and complete matches over ALL relevant candidates, independent of `limit`. */
  relevantCount: number;
  inScopeCount: number;
  completeMatches: SourceRef[];
  metricCoverage: MetricCoverage[];
};

export async function discoverCandidates(
  db: Client,
  scope: Scope,
  kpiChecks: KpiCheck[],
  kpis: KpiDefinition[],
  opts: { limit?: number } = {},
): Promise<DiscoveryResult> {
  const limit = opts.limit ?? 10;
  const assetsRes = await db.execute(`
      SELECT a.asset_id, a.asset_name, a.product_scope, a.market_scope, a.model_id, a.owner_id,
             a.lifecycle_status, a.endorsement, a._source_row,
             o.owner_name, o.status AS owner_status, o._source_row AS owner_row,
             s.refresh_status, s._source_row AS model_row
      FROM Analytics_Assets a
      LEFT JOIN Owners o ON o.owner_id = a.owner_id
      LEFT JOIN Semantic_Models s ON s.model_id = a.model_id
      ORDER BY a._source_row`);
  const assets = assetsRes.rows as unknown as AssetRow[];

  const inScope = assets
    .map((a) => ({
      a,
      product: scopeFit("product", scope.product, a.product_scope),
      market: scopeFit("market", scope.market, a.market_scope),
    }))
    .filter((x) => x.product && x.market);

  const ids = inScope.map((x) => x.a.asset_id);
  const maps: MapRow[] = ids.length
    ? ((
        await db.execute({
          sql: `SELECT asset_id, kpi_id, usage_role, _source_row FROM Asset_KPI_Map
                WHERE asset_id IN (${ids.map(() => "?").join(",")}) ORDER BY _source_row`,
          args: ids,
        })
      ).rows as unknown as MapRow[])
    : [];
  const kpiById = new Map(kpis.map((k) => [k.id, k]));
  const mapsByAsset = new Map<string, MapRow[]>();
  for (const m of maps) mapsByAsset.set(m.asset_id, [...(mapsByAsset.get(m.asset_id) ?? []), m]);

  const candidates: ReuseCandidate[] = [];
  for (const { a, product, market } of inScope) {
    const assetMaps = mapsByAsset.get(a.asset_id) ?? [];
    const known: CoverageItem[] = [];
    const gaps: CoverageItem[] = [];
    const parts: Record<string, number> = {};
    let approvedCount = 0;
    let variantCount = 0;

    for (const check of kpiChecks) {
      const hits = assetMaps
        .map((m) => ({ m, k: kpiById.get(m.kpi_id) }))
        .filter((x): x is { m: MapRow; k: KpiDefinition } => !!x.k && x.k.canonicalMetric === check.canonicalMetric);
      const ref = (x: { m: MapRow; k: KpiDefinition }): SourceRef[] => [
        { sheet: "Asset_KPI_Map", row: x.m._source_row, id: `${x.m.asset_id}/${x.m.kpi_id}` },
        x.k.source,
      ];
      // Only the uniquely approved KPI from the KPI check counts as coverage. A
      // metric with zero or several approved definitions can never be covered.
      const approvedHit = check.approved ? hits.find((x) => x.k.id === check.approved!.id) : undefined;
      if (approvedHit) {
        approvedCount++;
        known.push({
          aspect: `metric: ${check.canonicalMetric}`,
          detail: `maps ${approvedHit.k.id} (approved canonical, ${approvedHit.m.usage_role})`,
          evidence: ref(approvedHit),
        });
      } else if (hits.length > 0) {
        variantCount++;
        gaps.push({
          aspect: `metric: ${check.canonicalMetric}`,
          detail:
            (check.approved ? "only non-approved variant(s): " : "no single approved definition for this metric; maps: ") +
            hits.map((x) => `${x.k.id} (${x.k.definitionStatus} / ${x.k.approvalStatus})`).join(", "),
          evidence: hits.flatMap(ref),
        });
      } else {
        gaps.push({
          aspect: `metric: ${check.canonicalMetric}`,
          detail: "no KPI of this metric mapped in Asset_KPI_Map",
          evidence: [],
        });
      }
    }
    if (approvedCount + variantCount === 0) continue;

    const assetRef: SourceRef = { sheet: "Analytics_Assets", row: a._source_row, id: a.asset_id };
    known.unshift(
      {
        aspect: "product",
        detail: product === "exact" ? `${a.product_scope} (exact)` : `${a.product_scope} covers ${scope.product}`,
        evidence: [assetRef],
      },
      {
        aspect: "market",
        detail: market === "exact" ? `${a.market_scope} (exact)` : `${a.market_scope} covers ${scope.market}`,
        evidence: [assetRef],
      },
    );

    if (approvedCount) parts.metricApproved = approvedCount * WEIGHTS.metricApproved;
    if (variantCount) parts.metricVariantOnly = variantCount * WEIGHTS.metricVariantOnly;
    parts.productScope = product === "exact" ? WEIGHTS.scopeExact : WEIGHTS.scopeBroader;
    parts.marketScope = market === "exact" ? WEIGHTS.scopeExact : WEIGHTS.scopeBroader;
    if (a.endorsement === "certified") parts.endorsement = WEIGHTS.certified;
    else if (a.endorsement === "promoted") parts.endorsement = WEIGHTS.promoted;

    candidates.push({
      assetId: a.asset_id,
      name: a.asset_name,
      score: Object.values(parts).reduce((s, v) => s + v, 0),
      scoreParts: parts,
      coversAllMetrics: kpiChecks.length > 0 && approvedCount === kpiChecks.length,
      coverage: { known, gaps, unknown: ALWAYS_UNKNOWN },
      owner: { id: a.owner_id || null, name: a.owner_name, active: a.owner_status === "active" },
      facts: {
        endorsement: a.endorsement,
        lifecycleStatus: a.lifecycle_status,
        modelId: a.model_id || null,
        modelRefreshStatus: a.refresh_status,
      },
      source: assetRef,
    });
  }

  candidates.sort((x, y) => y.score - x.score || x.assetId.localeCompare(y.assetId));

  // Decisions use the full set; only the returned list is truncated.
  const complete = candidates.filter((c) => c.coversAllMetrics);
  const shown = presentCandidates(candidates, limit);

  // Per requested metric: which in-scope assets map its approved KPI (all of
  // them, not only the returned top candidates).
  const metricCoverage: MetricCoverage[] = kpiChecks.map((check) => ({
    canonicalMetric: check.canonicalMetric,
    approvedKpiId: check.approved?.id ?? null,
    assetIds: check.approved
      ? ids.filter((id) => (mapsByAsset.get(id) ?? []).some((m) => m.kpi_id === check.approved!.id))
      : [],
  }));

  return {
    candidates: shown,
    relevantCount: candidates.length,
    inScopeCount: inScope.length,
    completeMatches: complete.map((c) => c.source),
    metricCoverage,
  };
}

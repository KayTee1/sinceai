import "server-only";
import { db, rows } from "@/db/client";
import { ensureLifecycle, listAssetStates, tick } from "@/services/lifecycle";
import { listInsights } from "@/services/build";
import type {
  AssetKpi,
  AssetSummary,
  BusinessData,
  DashboardData,
  EstateData,
  GovernanceSignal,
  Market,
  ProductMarketRow,
  SemanticModel,
  Tier,
} from "./types";

// Two separate sources, never mixed:
// - Analytics estate (metadata about reports, dashboards, models, KPIs, usage,
//   governance): Analytics_Assets, Asset_Usage, Asset_KPI_Map, KPI_Catalog,
//   Semantic_Models, Governance_Signals, Owners, Workspaces.
// - Business performance (synthetic pharma facts): Product_Market_Monthly with
//   Products and Markets, plus Market_Access, Supply_Operations, Launch_Milestones.

const TIER_ORDER: Record<Tier, number> = { certified: 0, team: 1, personal: 2, temporary: 3 };

type AssetRow = {
  asset_id: string;
  asset_name: string;
  asset_type: string;
  platform: string;
  product_scope: string;
  market_scope: string;
  model_id: string | null;
  workspace_name: string;
  owner_name: string | null;
  owner_status: string | null;
  lifecycle_status: string;
  endorsement: string;
  estimated_audience: number | null;
  last_modified: string;
};

type UsageRow = { asset_id: string; month: string; views: number; unique_users: number };

function groupBy<T, V>(items: T[], key: (t: T) => string, map: (t: T) => V): Map<string, V[]> {
  const out = new Map<string, V[]>();
  for (const it of items) {
    const k = key(it);
    const list = out.get(k) ?? [];
    list.push(map(it));
    out.set(k, list);
  }
  return out;
}

async function loadEstate() {
  const [assetRows, usageRows, kpiMap, kpiCatalog, signals, models] = await Promise.all([
    rows<AssetRow>(`
      SELECT a.asset_id, a.asset_name, a.asset_type, a.platform, a.product_scope, a.market_scope, a.model_id,
             w.workspace_name, o.owner_name, o.status AS owner_status,
             a.lifecycle_status, a.endorsement, a.estimated_audience, a.last_modified
      FROM Analytics_Assets a
      LEFT JOIN Owners o ON o.owner_id = a.owner_id
      LEFT JOIN Workspaces w ON w.workspace_id = a.workspace_id`),
    rows<UsageRow>(`SELECT asset_id, month, views, unique_users FROM Asset_Usage ORDER BY month`),
    rows<{
      asset_id: string;
      kpi_id: string;
      kpi_name: string;
      usage_role: string;
      canonical_metric: string;
      definition_status: string;
      approval_status: string;
    }>(`
      SELECT m.asset_id, m.kpi_id, k.kpi_name, m.usage_role, k.canonical_metric, k.definition_status, k.approval_status
      FROM Asset_KPI_Map m JOIN KPI_Catalog k ON k.kpi_id = m.kpi_id
      ORDER BY m.asset_id, m.usage_role, m.kpi_id`),
    rows<{ id: string; name: string; canonicalMetric: string; definitionStatus: string; approvalStatus: string }>(`
      SELECT kpi_id AS id, kpi_name AS name, canonical_metric AS canonicalMetric,
             definition_status AS definitionStatus, approval_status AS approvalStatus
      FROM KPI_Catalog ORDER BY kpi_id`),
    rows<{
      signal_id: string;
      asset_id: string;
      signal_code: string;
      severity: string;
      status: string;
      detected_by: string;
    }>(
      `SELECT signal_id, asset_id, signal_code, severity, status, detected_by FROM Governance_Signals ORDER BY signal_id`,
    ),
    rows<{
      model_id: string;
      model_name: string;
      model_type: string;
      endorsement: string;
      refresh_frequency: string;
      refresh_status: string;
      ai_readiness: string;
      ai_issue_pattern: string;
      table_count: number;
      measure_count: number;
    }>(`
      SELECT model_id, model_name, model_type, endorsement, refresh_frequency, refresh_status,
             ai_readiness, ai_issue_pattern, table_count, measure_count
      FROM Semantic_Models`),
  ]);

  const usage = groupBy(
    usageRows,
    (u) => u.asset_id,
    (u) => ({ month: u.month, views: u.views, users: u.unique_users }),
  );
  const kpis = groupBy<(typeof kpiMap)[number], AssetKpi>(
    kpiMap,
    (k) => k.asset_id,
    (k) => ({
      id: k.kpi_id,
      name: k.kpi_name,
      role: k.usage_role,
      canonicalMetric: k.canonical_metric,
      definitionStatus: k.definition_status,
      approvalStatus: k.approval_status,
    }),
  );
  const assetSignals = groupBy<(typeof signals)[number], GovernanceSignal>(
    signals,
    (s) => s.asset_id,
    (s) => ({
      id: s.signal_id,
      code: s.signal_code,
      severity: s.severity,
      status: s.status,
      detectedBy: s.detected_by,
    }),
  );
  const estate: EstateData = {
    models: Object.fromEntries(
      models.map((m): [string, SemanticModel] => [
        m.model_id,
        {
          id: m.model_id,
          name: m.model_name,
          type: m.model_type,
          endorsement: m.endorsement,
          refreshFrequency: m.refresh_frequency,
          refreshStatus: m.refresh_status,
          aiReadiness: m.ai_readiness,
          aiIssuePattern: m.ai_issue_pattern,
          tableCount: Number(m.table_count),
          measureCount: Number(m.measure_count),
        },
      ]),
    ),
    kpiCatalog: kpiCatalog.map((k) => ({ ...k })),
  };
  return { assetRows, usage, kpis, assetSignals, estate };
}

async function loadBusiness(): Promise<{ business: BusinessData; markets: Market[] }> {
  const [pm, products, markets, access, supply, milestones] = await Promise.all([
    rows<ProductMarketRow>(`
      SELECT p.product_name AS product, m.market_id AS market, m.month,
             m.net_sales_m_eur_syn AS netSales, m.forecast_m_eur_syn AS forecast,
             m.market_access_coverage_pct_syn AS coverage, m.otif_pct_syn AS otif, m.value_type AS valueType
      FROM Product_Market_Monthly m JOIN Products p ON p.product_id = m.product_id
      ORDER BY m.month`),
    rows<{ id: string; name: string; therapeuticArea: string; stage: string }>(
      `SELECT product_id AS id, product_name AS name, therapeutic_area AS therapeuticArea, portfolio_stage AS stage FROM Products`,
    ),
    rows<Market>(`SELECT market_id AS id, market_name AS name, region FROM Markets`),
    rows<BusinessData["marketAccess"][number]>(`
      SELECT p.product_name AS product, a.market_id AS market, a.reimbursement_status AS reimbursement,
             a.coverage_model AS coverageModel, a.coverage_pct_syn AS coveragePct, a.trend_status AS trend,
             a.analytics_priority AS priority
      FROM Market_Access a JOIN Products p ON p.product_id = a.product_id`),
    rows<BusinessData["supply"][number]>(`
      SELECT p.product_name AS product, s.market_id AS market, s.supply_source AS source, s.primary_mode AS mode,
             s.otif_pct_syn AS otifPct, s.inventory_weeks_syn AS inventoryWeeks,
             s.forecast_accuracy_pct_syn AS forecastAccuracyPct, s.risk_status AS risk
      FROM Supply_Operations s JOIN Products p ON p.product_id = s.product_id`),
    rows<BusinessData["milestones"][number]>(`
      SELECT l.milestone_id AS id, p.product_name AS product, l.market_id AS market, l.milestone_type AS type,
             l.milestone_date AS date, l.status, l.business_impact AS impact
      FROM Launch_Milestones l JOIN Products p ON p.product_id = l.product_id
      ORDER BY l.milestone_date`),
  ]);
  const plain = <T>(xs: T[]) => xs.map((x) => ({ ...x }));
  return {
    business: {
      productMarket: plain(pm),
      products: plain(products),
      marketAccess: plain(access),
      supply: plain(supply),
      milestones: plain(milestones),
    },
    markets: plain(markets),
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  // Tiers, leases and status come from the lifecycle engine (app-owned).
  await ensureLifecycle(db());
  const clock = await tick(db());
  const states = new Map((await listAssetStates(db())).map((s) => [s.assetId, s]));

  const [{ assetRows, usage, kpis, assetSignals, estate }, { business, markets }, insights, owners] = await Promise.all(
    [
      loadEstate(),
      loadBusiness(),
      listInsights(db()),
      rows<{ owner_id: string; owner_name: string; status: string }>(`SELECT owner_id, owner_name, status FROM Owners`),
    ],
  );

  const assets: AssetSummary[] = assetRows.map((a) => {
    const state = states.get(a.asset_id);
    return {
      id: a.asset_id,
      name: a.asset_name,
      type: a.asset_type,
      platform: a.platform,
      productScope: a.product_scope,
      marketScope: a.market_scope,
      workspace: a.workspace_name,
      ownerName: a.owner_name,
      ownerActive: a.owner_status === "active",
      lifecycleStatus: a.lifecycle_status,
      endorsement: a.endorsement,
      tier: (state?.tier ?? "personal") as Tier,
      status: state?.status ?? "active",
      leaseEnd: state?.leaseEnd ?? state?.ttlEnd ?? null,
      lastModified: a.last_modified,
      monthlyViews: usage.get(a.asset_id) ?? [],
      origin: "pack" as const,
      modelId: a.model_id,
      estimatedAudience: a.estimated_audience === null ? null : Number(a.estimated_audience),
      kpis: kpis.get(a.asset_id) ?? [],
      signals: assetSignals.get(a.asset_id) ?? [],
    };
  });
  assets.sort((x, y) => TIER_ORDER[x.tier] - TIER_ORDER[y.tier] || x.name.localeCompare(y.name));

  // Insights built by the steward (step 4): app-owned business-performance views.
  // They also appear in the catalog because they have a lifecycle.
  const ownerById = new Map(owners.map((o) => [o.owner_id, o]));
  const built: AssetSummary[] = insights.flatMap((i) => {
    const state = states.get(i.id);
    if (!state) return [];
    const owner = ownerById.get(i.ownerId);
    return [
      {
        id: i.id,
        name: i.name,
        type: "Insight",
        platform: "Analytics Steward",
        productScope: i.scope.product,
        marketScope: i.scope.market,
        workspace: "Built by Analytics Steward",
        ownerName: owner?.owner_name ?? null,
        ownerActive: owner?.status === "active",
        lifecycleStatus: "app_built",
        endorsement: "none",
        tier: state.tier as Tier,
        status: state.status,
        leaseEnd: state.leaseEnd ?? state.ttlEnd ?? null,
        lastModified: i.builtOn,
        monthlyViews: [],
        origin: "app" as const,
        modelId: null,
        estimatedAudience: null,
        kpis: i.results.map((r) => ({
          id: r.kpiId,
          name: r.kpiName ?? r.kpiId,
          role: "primary",
          canonicalMetric: r.kpiName ?? r.kpiId,
          definitionStatus: "canonical",
          approvalStatus: "approved",
        })),
        signals: [],
      },
    ];
  });

  return {
    assets: [...built, ...assets],
    insights: Object.fromEntries(insights.map((i) => [i.id, i])),
    markets,
    estate,
    business,
    clockDate: clock.date,
  };
}

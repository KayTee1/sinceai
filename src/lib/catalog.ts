import "server-only";
import { db, rows } from "@/db/client";
import { ensureLifecycle, listAssetStates, tick } from "@/services/lifecycle";
import { listInsights } from "@/services/build";
import type { AssetSummary, DashboardData, Market, ProductMarketRow, Tier } from "./types";

const TIER_ORDER: Record<Tier, number> = { certified: 0, team: 1, personal: 2, temporary: 3 };

type AssetRow = {
  asset_id: string;
  asset_name: string;
  asset_type: string;
  platform: string;
  product_scope: string;
  market_scope: string;
  workspace_name: string;
  owner_name: string | null;
  owner_status: string | null;
  lifecycle_status: string;
  endorsement: string;
  last_modified: string;
};

type UsageRow = { asset_id: string; month: string; views: number; unique_users: number };

export async function getDashboardData(): Promise<DashboardData> {
  // Tiers, leases and status come from the lifecycle engine (app-owned).
  await ensureLifecycle(db());
  const clock = await tick(db());
  const states = new Map((await listAssetStates(db())).map((s) => [s.assetId, s]));

  const [assetRows, usageRows, pm, markets] = await Promise.all([
    rows<AssetRow>(`
      SELECT a.asset_id, a.asset_name, a.asset_type, a.platform, a.product_scope, a.market_scope,
             w.workspace_name, o.owner_name, o.status AS owner_status,
             a.lifecycle_status, a.endorsement, a.last_modified
      FROM Analytics_Assets a
      LEFT JOIN Owners o ON o.owner_id = a.owner_id
      LEFT JOIN Workspaces w ON w.workspace_id = a.workspace_id`),
    rows<UsageRow>(`SELECT asset_id, month, views, unique_users FROM Asset_Usage ORDER BY month`),
    rows<ProductMarketRow>(`
      SELECT p.product_name AS product, m.market_id AS market, m.month,
             m.net_sales_m_eur_syn AS netSales, m.forecast_m_eur_syn AS forecast,
             m.market_access_coverage_pct_syn AS coverage, m.otif_pct_syn AS otif
      FROM Product_Market_Monthly m JOIN Products p ON p.product_id = m.product_id
      ORDER BY m.month`),
    rows<Market>(`SELECT market_id AS id, market_name AS name, region FROM Markets`),
  ]);

  const usage = new Map<string, AssetSummary["monthlyViews"]>();
  for (const u of usageRows) {
    const list = usage.get(u.asset_id) ?? [];
    list.push({ month: u.month, views: u.views, users: u.unique_users });
    usage.set(u.asset_id, list);
  }

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
    };
  });

  assets.sort((x, y) => TIER_ORDER[x.tier] - TIER_ORDER[y.tier] || x.name.localeCompare(y.name));

  // Insights built by the steward (step 4) are listed first; they are app-owned, not pack assets.
  const insights = await listInsights(db());
  const owners = new Map(
    (
      await rows<{ owner_id: string; owner_name: string; status: string }>(
        `SELECT owner_id, owner_name, status FROM Owners`,
      )
    ).map((o) => [o.owner_id, o]),
  );
  const built: AssetSummary[] = insights.flatMap((i) => {
    const state = states.get(i.id);
    if (!state) return [];
    const owner = owners.get(i.ownerId);
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
      },
    ];
  });

  return {
    assets: [...built, ...assets],
    insights: Object.fromEntries(insights.map((i) => [i.id, i])),
    productMarket: pm.map((r) => ({ ...r })),
    markets: markets.map((m) => ({ ...m })),
    clockDate: clock.date,
  };
}

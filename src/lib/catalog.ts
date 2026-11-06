import "server-only";
import { rows } from "@/db/client";
import type { AssetSummary, DashboardData, Market, ProductMarketRow, Tier } from "./types";

// Simulated clock start and first 90-day lease cycle (app-owned, see SCOPE).
export const CLOCK_START = "2026-11-06";
const LEASE_DAYS = 90;

// Initial tier mapping is a team assumption (SCOPE "Data").
const TIER_BY_ENDORSEMENT: Record<string, Tier> = {
  certified: "certified",
  promoted: "team",
  none: "personal",
};

const TIER_ORDER: Record<Tier, number> = { certified: 0, team: 1, personal: 2, temporary: 3 };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

  const leaseEnd = addDays(CLOCK_START, LEASE_DAYS);
  const assets: AssetSummary[] = assetRows.map((a) => ({
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
    tier: TIER_BY_ENDORSEMENT[a.endorsement] ?? "personal",
    leaseEnd,
    lastModified: a.last_modified,
    monthlyViews: usage.get(a.asset_id) ?? [],
  }));

  assets.sort((x, y) => TIER_ORDER[x.tier] - TIER_ORDER[y.tier] || x.name.localeCompare(y.name));

  return {
    assets,
    productMarket: pm.map((r) => ({ ...r })),
    markets: markets.map((m) => ({ ...m })),
    clockDate: CLOCK_START,
  };
}

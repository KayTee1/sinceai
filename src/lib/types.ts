// Shapes shared by server data loaders and client components.

export type Tier = "temporary" | "personal" | "team" | "certified";
export type Role = "employee" | "manager";

export type AssetSummary = {
  id: string;
  name: string;
  type: string; // App | Workbook | Dashboard | Report
  platform: string;
  productScope: string; // product name or "All Pharma"
  marketScope: string; // market id or "Global"
  workspace: string;
  ownerName: string | null;
  ownerActive: boolean;
  lifecycleStatus: string; // source field, never overwritten
  endorsement: string; // source field, never overwritten
  tier: Tier; // app-owned
  leaseEnd: string; // ISO date, app-owned
  lastModified: string;
  monthlyViews: { month: string; views: number; users: number }[];
};

export type ProductMarketRow = {
  product: string; // product name
  market: string; // market id
  month: string; // YYYY-MM-DD
  netSales: number; // m EUR, synthetic
  forecast: number; // m EUR, synthetic
  coverage: number; // %
  otif: number; // %
};

export type Market = { id: string; name: string; region: string };

export type DashboardData = {
  assets: AssetSummary[];
  productMarket: ProductMarketRow[];
  markets: Market[];
  clockDate: string;
};

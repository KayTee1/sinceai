import type { Insight } from "@/services/build";
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
  status: "active" | "lease_due" | "archived"; // app-owned
  leaseEnd: string | null; // ISO date (lease or TTL end), app-owned
  lastModified: string;
  monthlyViews: { month: string; views: number; users: number }[];
  /** "app" = Temporary insight built by the steward (step 4). */
  origin: "pack" | "app";
  modelId: string | null;
  estimatedAudience: number | null;
  /** Team domain: the most common domain among the asset's primary KPIs (D22). */
  domain: string | null;
  /** Region of the market scope, or "Global". */
  region: string;
  /** KPIs the catalog maps to this asset (Asset_KPI_Map + KPI_Catalog). */
  kpis: AssetKpi[];
  /** Governance_Signals rows for this asset. */
  signals: GovernanceSignal[];
};

export type AssetKpi = {
  id: string;
  name: string;
  domain: string; // KPI_Catalog.domain: Commercial, Finance, Market Access, Supply Chain, Launch Excellence, BI Governance
  role: string; // primary | secondary
  canonicalMetric: string;
  definitionStatus: string;
  approvalStatus: string;
};

export type GovernanceSignal = { id: string; code: string; severity: string; status: string; detectedBy: string };

export type SemanticModel = {
  id: string;
  name: string;
  type: string;
  endorsement: string;
  refreshFrequency: string;
  refreshStatus: string;
  aiReadiness: string;
  aiIssuePattern: string;
  tableCount: number;
  measureCount: number;
};

/** Analytics estate: metadata about analytics products. Never business performance. */
export type EstateData = {
  models: Record<string, SemanticModel>;
  kpiCatalog: { id: string; name: string; canonicalMetric: string; domain: string; definitionStatus: string; approvalStatus: string }[];
};

export type Product = { id: string; name: string; therapeuticArea: string; stage: string };

/** Business performance: synthetic pharma facts from the pack, never analytics metadata. */
export type BusinessData = {
  productMarket: ProductMarketRow[];
  products: Product[];
  marketAccess: {
    product: string;
    market: string;
    reimbursement: string;
    coverageModel: string;
    coveragePct: number;
    trend: string;
    priority: string;
  }[];
  supply: {
    product: string;
    market: string;
    source: string;
    mode: string;
    otifPct: number;
    inventoryWeeks: number;
    forecastAccuracyPct: number;
    risk: string;
  }[];
  milestones: {
    id: string;
    product: string;
    market: string;
    type: string;
    date: string;
    status: string;
    impact: string;
  }[];
};

export type ProductMarketRow = {
  product: string; // product name
  market: string; // market id
  month: string; // YYYY-MM-DD
  netSales: number; // m EUR, synthetic
  forecast: number; // m EUR, synthetic
  coverage: number; // %
  otif: number; // %
  valueType: string; // actual_like_synthetic | forecast_like_synthetic (never blended)
};

export type Market = { id: string; name: string; region: string };

export type DashboardData = {
  assets: AssetSummary[];
  /** Built insights by asset ID, with computed values and provenance. */
  insights: Record<string, Insight>;
  markets: Market[];
  estate: EstateData;
  business: BusinessData;
  clockDate: string;
};

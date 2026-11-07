// TEAM-AUTHORED test fixture for KPI computation (T15). Not derived from the
// Bayer pack: products, values and assets are invented. KPI IDs reuse the
// pack's IDs only because the D14 mapping is keyed by them.
//
// Hand-checkable expectations (actual-like unless noted), month 2026-10:
//   Alphazol DE: net 12.50 (Sep 10.00), fcst 10.00, access 70  -> growth 25 %,  variance  2.5
//   Alphazol FR: net  4.00 (Sep  5.00), fcst  5.00, access 50  -> growth -20 %, variance -1.0
//   Alphazol DE+FR: net 16.5 (Sep 15.0) -> growth 10 % (ratio of sums; the naive mean would be 2.5 %)
//   Alphazol US: Oct actual-like, Sep forecast-like            -> growth insufficient, variance 5.0
//   Betavex DE: zeros in every month                           -> growth insufficient (zero prior)
//   Betavex FR: Oct forecast-like (net 7, fcst 6)              -> actual-like insufficient; forecast-like net 7
//   Betavex US: no Oct row                                     -> insufficient (missing row)
//   Betavex Global (DE, FR, US): KPI-001 / KPI-042 compute for DE only -> incomplete
import type { ParsedSheet } from "../../src/db/import-workbook";

const sheet = (name: string, header: string[], rows: unknown[][]): ParsedSheet => ({ sheet: name, data: [header, ...rows] });

const A = "actual_like_synthetic";
const F = "forecast_like_synthetic";
const ASSET_TAIL = ["active", "certified", "Dashboard", "Power BI", "WS-1", "2026-09-01"];

export const FACT_SHEETS: ParsedSheet[] = [
  { sheet: "START_HERE", data: [["Fixture: team-authored, not Bayer data"]] },
  sheet("Products", ["product_id", "product_name"], [
    ["P-ALP", "Alphazol"],
    ["P-BET", "Betavex"],
  ]),
  sheet("Markets", ["market_id", "market_name", "region"], [
    ["DE", "Germany", "EMEA"],
    ["FR", "France", "EMEA"],
    ["US", "United States", "North America"],
  ]),
  sheet("Owners", ["owner_id", "owner_name", "role", "scope", "status"], [["OWN-1", "Fixture Owner", "Commercial Lead", "EMEA", "active"]]),
  sheet("KPI_Catalog", ["kpi_id", "kpi_name", "canonical_metric", "unit", "definition_status", "approval_status", "description"], [
    ["KPI-001", "Net Sales", "Net Sales", "EUR", "canonical", "approved", "Fixture"],
    ["KPI-004", "Net Sales Growth", "Net Sales Growth", "%", "canonical", "approved", "Fixture"],
    ["KPI-005", "Net Sales Growth Local", "Net Sales Growth", "%", "duplicate_candidate", "local", "Fixture"],
    ["KPI-014", "Units Shipped", "Units Shipped", "units", "canonical", "approved", "Fixture"],
    ["KPI-027", "Market Access Coverage", "Market Access Coverage", "%", "canonical", "approved", "Fixture"],
    ["KPI-042", "Forecast Variance", "Forecast Variance", "EUR", "canonical", "approved", "Fixture"],
    ["KPI-090", "Fixture Unmapped Index", "Fixture Unmapped Index", "index", "canonical", "approved", "Fixture"],
  ]),
  sheet("Semantic_Models", ["model_id", "model_name", "refresh_status"], [["SM-1", "Fixture Model", "healthy"]]),
  sheet(
    "Analytics_Assets",
    [
      "asset_id", "asset_name", "model_id", "product_scope", "market_scope", "owner_id", "lifecycle_status", "endorsement",
      "asset_type", "platform", "workspace_id", "last_modified",
    ],
    [
      ["AST-1", "Alphazol EMEA Growth", "SM-1", "Alphazol", "EMEA", "OWN-1", ...ASSET_TAIL],
      ["AST-2", "Betavex US Sales", "SM-1", "Betavex", "US", "OWN-1", ...ASSET_TAIL],
      ["AST-3", "Betavex Global Sales", "SM-1", "Betavex", "Global", "OWN-1", ...ASSET_TAIL],
    ],
  ),
  sheet("Asset_KPI_Map", ["asset_id", "kpi_id", "usage_role"], [
    ["AST-1", "KPI-004", "primary"],
    ["AST-2", "KPI-001", "primary"],
    ["AST-3", "KPI-001", "primary"],
  ]),
  sheet(
    "Business_Requests",
    ["request_id", "request_date", "product_context", "market_context", "request_text", "urgency", "status"],
    [
      // Gap on forecast variance; both KPIs computable -> build proposal.
      ["REQ-S01", "2026-10-01", "Alphazol", "EMEA", "Net sales growth and forecast variance for Alphazol by country.", "low", "new"],
      // Gap on units shipped, which is not implemented -> no build.
      ["REQ-S02", "2026-10-02", "Alphazol", "EMEA", "Net sales growth and units shipped for Alphazol.", "low", "new"],
      // Gap on forecast variance, but no October row for Betavex US -> no build.
      ["REQ-S03", "2026-10-03", "Betavex", "US", "Net sales and forecast variance for Betavex.", "low", "new"],
      // Gap on forecast variance; computable in DE only of three markets -> no build.
      ["REQ-S04", "2026-10-04", "Betavex", "Global", "Net sales and forecast variance for Betavex by country.", "low", "new"],
    ],
  ),
  sheet(
    "Product_Market_Monthly",
    [
      "product_id", "market_id", "month", "net_sales_m_eur_syn", "forecast_m_eur_syn", "units_shipped_syn", "forecast_variance_pct",
      "market_access_coverage_pct_syn", "otif_pct_syn", "inventory_weeks_syn", "value_type", "synthetic_record",
    ],
    [
      ["P-ALP", "DE", "2026-09-01", 10.0, 8.0, 100, 25.0, 60, 90, 4, A, 1],
      ["P-ALP", "DE", "2026-10-01", 12.5, 10.0, 120, 25.0, 70, 92, 5, A, 1],
      ["P-ALP", "FR", "2026-09-01", 5.0, 5.5, 50, -9.1, 40, 80, 3, A, 1],
      ["P-ALP", "FR", "2026-10-01", 4.0, 5.0, 40, -20.0, 50, 85, 3, A, 1],
      ["P-ALP", "US", "2026-09-01", 20.0, 18.0, 200, 11.1, 30, 70, 6, F, 1],
      ["P-ALP", "US", "2026-10-01", 30.0, 25.0, 300, 20.0, 35, 75, 6, A, 1],
      ["P-BET", "DE", "2026-09-01", 0, 0, 0, 0, 0, 0, 0, A, 1],
      ["P-BET", "DE", "2026-10-01", 0, 0, 0, 0, 0, 0, 0, A, 1],
      ["P-BET", "FR", "2026-09-01", 6.0, 6.0, 60, 0, 20, 90, 2, A, 1],
      ["P-BET", "FR", "2026-10-01", 7.0, 6.0, 70, 16.7, 25, 91, 2, F, 1],
      ["P-BET", "US", "2026-08-01", 3.0, 3.0, 30, 0, 10, 90, 2, A, 1],
      ["P-BET", "US", "2026-09-01", 4.0, 3.0, 40, 33.3, 10, 90, 2, A, 1],
    ],
  ),
];

export const FACT_EXPECTED: Record<string, number> = Object.fromEntries(
  FACT_SHEETS.filter((s) => s.sheet !== "START_HERE").map((s) => [s.sheet, s.data.length - 1]),
);

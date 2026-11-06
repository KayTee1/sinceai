// TEAM-AUTHORED test fixture (ours). Not derived from or attributable to the
// Bayer pack: product names, IDs and mappings are invented to exercise the
// steward services. Column names follow the pack schema in DATA_SOURCES.
import type { ParsedSheet } from "../../src/db/import-workbook";

const sheet = (name: string, header: string[], rows: unknown[][]): ParsedSheet => ({ sheet: name, data: [header, ...rows] });

export const FIXTURE_SHEETS: ParsedSheet[] = [
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
  sheet("Owners", ["owner_id", "owner_name", "role", "scope", "status"], [
    ["OWN-1", "Fixture Owner One", "Commercial Lead", "EMEA", "active"],
    ["OWN-2", "Fixture Owner Two", "Analyst", "EMEA", "inactive"],
  ]),
  sheet("KPI_Catalog", ["kpi_id", "kpi_name", "canonical_metric", "unit", "definition_status", "approval_status", "description"], [
    ["KPI-A1", "Net Sales Growth", "Net Sales Growth", "%", "canonical", "approved", "Fixture definition"],
    ["KPI-A2", "Net Sales Growth Local", "Net Sales Growth", "%", "duplicate_candidate", "local", "Fixture definition"],
    ["KPI-B1", "Net Sales", "Net Sales", "EUR", "canonical", "approved", "Fixture definition"],
    ["KPI-C1", "Market Access Coverage", "Market Access Coverage", "%", "canonical", "approved", "Fixture definition"],
    ["KPI-D1", "Launch Index", "Launch Index", "index", "local_variant", "local", "Fixture definition"],
    ["KPI-D2", "Launch Index", "Launch Index", "index", "definition_conflict", "unapproved", "Fixture definition"],
    ["KPI-E1", "Forecast Variance", "Forecast Variance", "EUR", "canonical", "approved", "Fixture definition"],
  ]),
  sheet("Semantic_Models", ["model_id", "model_name", "refresh_status"], [
    ["SM-1", "Fixture Model One", "healthy"],
    ["SM-2", "Fixture Model Two", "failed"],
  ]),
  sheet(
    "Analytics_Assets",
    [
      "asset_id", "asset_name", "model_id", "product_scope", "market_scope", "owner_id", "lifecycle_status", "endorsement",
      "asset_type", "platform", "workspace_id", "last_modified",
    ],
    [
      ["AST-1", "Alphazol Growth DE", "SM-1", "Alphazol", "DE", "OWN-1", "active", "certified", "Dashboard", "Power BI", "WS-1", "2026-09-01"],
      ["AST-2", "Pharma Growth Global", "SM-2", "All Pharma", "Global", null, "candidate_retire", "none", "Dashboard", "Power BI", "WS-1", "2026-09-01"],
      ["AST-3", "Alphazol Local Growth DE", "SM-1", "Alphazol", "DE", "OWN-2", "legacy", "promoted", "Dashboard", "Power BI", "WS-1", "2026-09-01"],
      ["AST-4", "Betavex Sales US", "SM-1", "Betavex", "US", "OWN-1", "active", "none", "Dashboard", "Power BI", "WS-1", "2026-09-01"],
      ["AST-5", "Betavex Access US", "SM-1", "Betavex", "US", "OWN-1", "active", "none", "Dashboard", "Power BI", "WS-1", "2026-09-01"],
      ["AST-6", "Alphazol France Report", "SM-1", "Alphazol", "FR", "OWN-1", "active", "none", "Dashboard", "Power BI", "WS-1", "2026-09-01"],
    ],
  ),
  sheet("Asset_KPI_Map", ["asset_id", "kpi_id", "usage_role"], [
    ["AST-1", "KPI-A1", "primary"],
    ["AST-1", "KPI-B1", "secondary"],
    ["AST-2", "KPI-A1", "primary"],
    ["AST-3", "KPI-A2", "primary"],
    ["AST-4", "KPI-B1", "primary"],
    ["AST-5", "KPI-C1", "primary"],
    ["AST-6", "KPI-D1", "primary"],
  ]),
  sheet(
    "Business_Requests",
    ["request_id", "request_date", "product_context", "market_context", "request_text", "urgency", "status"],
    [
      // Text vs. context conflict (product and market).
      ["REQ-T01", "2026-10-01", "Betavex", "EMEA", "A global Alphazol dashboard with net sales growth.", "high", "new"],
      // Clear request; reusable assets exist.
      ["REQ-T02", "2026-10-02", "Alphazol", "DE", "Show net sales growth for Alphazol in Germany.", "low", "new"],
      // Approved KPI for forecast variance mapped by no in-scope asset -> build.
      ["REQ-T03", "2026-10-03", "Betavex", "US", "Net sales and forecast variance for Betavex.", "low", "new"],
      // No supported metric named.
      ["REQ-T04", "2026-10-04", "Alphazol", "DE", "Please migrate our old workbook.", "low", "new"],
      // In scope, but no asset maps the metric -> no build from absence alone.
      ["REQ-T05", "2026-10-05", "Alphazol", "FR", "Market access coverage for Alphazol.", "low", "new"],
      // Each metric covered by a different asset -> not a gap.
      ["REQ-T06", "2026-10-06", "Betavex", "US", "Net sales and market access for Betavex.", "low", "new"],
      // Metric without an approved canonical definition.
      ["REQ-T07", "2026-10-07", "Alphazol", "FR", "Launch index for Alphazol.", "low", "new"],
      // All Pharma context narrowed by one explicit product.
      ["REQ-T08", "2026-10-08", "All Pharma", "DE", "Net sales growth for Alphazol.", "low", "new"],
    ],
  ),
];

export const FIXTURE_EXPECTED: Record<string, number> = Object.fromEntries(
  FIXTURE_SHEETS.filter((s) => s.sheet !== "START_HERE").map((s) => [s.sheet, s.data.length - 1]),
);

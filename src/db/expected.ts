// Table sheets of the Bayer builder pack and their data-row counts
// (header excluded), as recorded in docs/DATA_SOURCES.md. The importer
// refuses a workbook that does not match.

export const EXPECTED_ROW_COUNTS: Record<string, number> = {
  Public_References: 6,
  Products: 7,
  Markets: 14,
  Owners: 60,
  KPI_Catalog: 56,
  Workspaces: 16,
  Semantic_Models: 75,
  Analytics_Assets: 360,
  Asset_KPI_Map: 1454,
  Asset_Usage: 3600,
  Lineage_Edges: 438,
  Product_Market_Monthly: 980,
  Launch_Milestones: 35,
  Market_Access: 98,
  Supply_Operations: 98,
  Data_Quality: 147,
  Governance_Signals: 410,
  Migration_Backlog: 94,
  Business_Requests: 150,
  Governance_Rules: 8,
  Data_Dictionary: 13,
  Change_Log: 1,
};

// Columns read by current SQL queries over the imported tables, by consumer:
// S = src/services/steward, K = src/services/semantic (KPI computation),
// A = src/lib/catalog.ts (dashboard),
// M = src/mastra/tools/catalog-tools.ts. Names match DATA_SOURCES. The
// importer rejects a workbook where any of these is missing or renamed.
export const REQUIRED_COLUMNS: Record<string, string[]> = {
  Business_Requests: [
    "request_id", "request_date", "product_context", "market_context", "request_text", "urgency", "status", // S, M
  ],
  Products: ["product_id", "product_name"], // S, A
  Markets: ["market_id", "market_name", "region"], // S, A
  Owners: ["owner_id", "owner_name", "status"], // S, A, M
  KPI_Catalog: [
    "kpi_id", "kpi_name", "canonical_metric", "unit", "definition_status", "approval_status", // S, K, M
    "description", // M
  ],
  Semantic_Models: ["model_id", "refresh_status"], // S
  Analytics_Assets: [
    "asset_id", "asset_name", "product_scope", "market_scope", "model_id", "owner_id", "lifecycle_status", "endorsement", // S, A, M
    "asset_type", "platform", "workspace_id", "last_modified", // A, M
  ],
  Asset_KPI_Map: ["asset_id", "kpi_id", "usage_role"], // S, M
  Workspaces: ["workspace_id", "workspace_name"], // A
  Asset_Usage: ["asset_id", "month", "views", "unique_users"], // A
  Product_Market_Monthly: [
    "product_id", "market_id", "month", "net_sales_m_eur_syn", "forecast_m_eur_syn",
    "market_access_coverage_pct_syn", // A, K
    "otif_pct_syn", // A
    "value_type", // K; kept so actual-like and forecast-like rows stay distinguishable (DATA_SOURCES)
  ],
};

// Presentation sheets, not tables.
export const PRESENTATION_SHEETS = new Set(["START_HERE", "Package_Overview"]);

// Added to every imported table: the exact Excel row the record came from
// (header is row 1, so the first data row is 2).
export const SOURCE_ROW_COLUMN = "_source_row";

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

// Presentation sheets, not tables.
export const PRESENTATION_SHEETS = new Set(["START_HERE", "Package_Overview"]);

// Added to every imported table: the exact Excel row the record came from
// (header is row 1, so the first data row is 2).
export const SOURCE_ROW_COLUMN = "_source_row";

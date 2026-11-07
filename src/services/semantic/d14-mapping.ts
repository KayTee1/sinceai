// TEAM-AUTHORED, PROVISIONAL KPI mapping (D14: proposed by KayTee, pending
// Viet's agreement). The pack has no executable KPI formulas; these choices are
// ours, taken from the table in docs/SCOPE.md, and must be labelled as ours.
//
// This file holds only the D14 choices (which KPI -> which column and method).
// The methods themselves live in compute.ts and are generic. If D14 changes,
// change this file only.

/** Product_Market_Monthly measures the methods may read (whitelist for SQL). */
export type FactColumn = "net_sales_m_eur_syn" | "forecast_m_eur_syn" | "market_access_coverage_pct_syn";

export type Method =
  /** Additive measure: sum over the selected cells. */
  | { kind: "sum"; column: FactColumn }
  /** Difference of two additive measures: sum(a) - sum(b). */
  | { kind: "difference_of_sums"; minuend: FactColumn; subtrahend: FactColumn }
  /** % change of an additive measure vs. the previous month, same cells: (sum now - sum prior) / sum prior * 100. */
  | { kind: "period_growth"; column: FactColumn }
  /** Non-additive measure (a percentage without a denominator in the pack): one cell only. */
  | { kind: "cell_value"; column: FactColumn };

export type MappingEntry = {
  kpiId: string;
  /** The unit KPI_Catalog must show for this mapping to apply. */
  catalogUnit: string;
  /** Unit of the computed value. */
  resultUnit: string;
  method: Method;
  /** Human-readable formula as shown to users. */
  formula: string;
};

export const MAPPING_LABEL = "D14 computable KPI mapping (team-authored, proposed; pending Viet's agreement)";

export const D14_MAPPING: Record<string, MappingEntry> = {
  "KPI-001": {
    kpiId: "KPI-001",
    catalogUnit: "EUR",
    resultUnit: "M EUR",
    method: { kind: "sum", column: "net_sales_m_eur_syn" },
    formula: "Net Sales = Product_Market_Monthly.net_sales_m_eur_syn",
  },
  "KPI-004": {
    kpiId: "KPI-004",
    catalogUnit: "%",
    resultUnit: "%",
    method: { kind: "period_growth", column: "net_sales_m_eur_syn" },
    formula: "Net Sales Growth = (Net Sales this month - Net Sales prior month) / Net Sales prior month * 100, same products and markets",
  },
  "KPI-042": {
    kpiId: "KPI-042",
    catalogUnit: "EUR",
    resultUnit: "M EUR",
    method: { kind: "difference_of_sums", minuend: "net_sales_m_eur_syn", subtrahend: "forecast_m_eur_syn" },
    formula: "Forecast Variance = net_sales_m_eur_syn - forecast_m_eur_syn",
  },
  "KPI-027": {
    kpiId: "KPI-027",
    catalogUnit: "%",
    resultUnit: "%",
    method: { kind: "cell_value", column: "market_access_coverage_pct_syn" },
    formula: "Market Access Coverage = Product_Market_Monthly.market_access_coverage_pct_syn",
  },
};

/** D14 rows not implemented in T15, with the reason. They return "unsupported". */
export const D14_NOT_IMPLEMENTED: Record<string, string> = {
  "KPI-014": "Units Shipped is in the D14 mapping but not implemented yet (T15 covers the KPIs REQ-0001 needs).",
  "KPI-016": "Inventory Coverage is in the D14 mapping but not implemented: weeks of cover are not additive and the pack has no weighting basis.",
  "KPI-020": "On-Time In-Full is in the D14 mapping but not implemented: a percentage without order-line counts cannot be aggregated.",
  "KPI-006": "Demand Forecast Accuracy is in the D14 mapping but not implemented: Supply_Operations has no month, while the KPI is monthly.",
  "KPI-054": "Certified Asset Share is in the D14 mapping but not implemented: the pack has no monthly endorsement history.",
};

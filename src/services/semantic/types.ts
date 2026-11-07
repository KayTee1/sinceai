// Result shapes of deterministic KPI computation (T15).
// PROVISIONAL: depends on the D14 mapping (proposed, pending Viet) and is not
// yet agreed with the frontend lane. Change only together with the consumer.
import type { SourceRef } from "../steward/types";

/** Row categories of Product_Market_Monthly. Never mixed in one calculation. */
export const VALUE_TYPES = ["actual_like_synthetic", "forecast_like_synthetic"] as const;
export type ValueType = (typeof VALUE_TYPES)[number];
export const DEFAULT_VALUE_TYPE: ValueType = "actual_like_synthetic";

/**
 * computed: a value was calculated.
 * unsupported: the KPI cannot be computed from this pack at all, or not at the
 *   requested grain (no mapping, not an approved canonical KPI, unit mismatch,
 *   or an aggregation the definition does not support).
 * insufficient_data: the KPI is supported, but the rows for these filters are
 *   missing, of another value_type, or make the result undefined.
 */
export type ComputeStatus = "computed" | "unsupported" | "insufficient_data";

/** Why a supported KPI could not be computed for the filters. */
export type DataIssue = "missing_row" | "duplicate_rows" | "other_value_type" | "blank_measure" | "zero_prior_period";

export type KpiQuery = {
  kpiId: string;
  productIds: string[];
  marketIds: string[];
  /** First day of the month, as stored: "YYYY-MM-01". */
  month: string;
  /** Defaults to actual_like_synthetic. */
  valueType?: ValueType;
};

export type KpiResult = {
  kpiId: string;
  kpiName: string | null;
  status: ComputeStatus;
  /** Only set when status is "computed". Rounded to 6 decimals. */
  value: number | null;
  unit: string | null;
  reasons: string[];
  /** Distinct causes when status is "insufficient_data"; empty otherwise. */
  issues: DataIssue[];
  filters: {
    productIds: string[];
    marketIds: string[];
    month: string;
    /** Set for period-over-period KPIs. */
    priorMonth?: string;
    valueType: ValueType;
  };
  provenance: {
    /** Which mapping the calculation comes from, and its approval state. */
    mapping: string;
    formula: string | null;
    aggregation: string | null;
    /** The KPI_Catalog row the definition and unit were checked against. */
    catalog: SourceRef | null;
    /** The exact query that fetched the source rows. */
    query: { sql: string; args: string[] } | null;
    /** Product_Market_Monthly rows the value was calculated from. */
    rows: SourceRef[];
  };
};

/**
 * Scope-level status of one KPI:
 * computable: every requested market has a computed result.
 * incomplete: some markets computed, others did not (see byMarket).
 * insufficient_data: no market computed, or no market to probe.
 * unsupported: the KPI cannot be computed at this grain at all.
 */
export type ComputabilityStatus = "computable" | "incomplete" | "unsupported" | "insufficient_data";

/** Read-only check of whether a KPI can be computed for a request scope. Not an approval or a build. */
export type KpiComputability = {
  kpiId: string;
  canonicalMetric: string;
  status: ComputabilityStatus;
  /** The grain that was probed: one result per market, latest month in the pack. */
  probe: {
    month: string;
    valueType: ValueType;
    productIds: string[];
    /** Every requested market, including the successful values. */
    byMarket: { marketId: string; status: ComputeStatus; value: number | null; unit: string | null; issues: DataIssue[]; reasons: string[] }[];
  } | null;
  reasons: string[];
};

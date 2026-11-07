// Result shapes of the deterministic steward services (T14, T15).
import type { KpiComputability } from "../semantic/types";

// PROVISIONAL: not yet agreed with the frontend lane (Viet); D13/D14 details
// are still proposed. Change only together with the consumer.

/** Exact workbook location of a record: sheet name and Excel row (header = row 1). */
export type SourceRef = { sheet: string; row: number; id?: string };

export type ScopeField = "product" | "market";

/** A product or market scope: a product name, a market ID, a region name, or "All Pharma" / "Global". */
export type Scope = { product: string; market: string };

export type ScopeConflict = {
  field: ScopeField;
  /** Value in the request's structured context columns. */
  context: string;
  /** Explicit references found in the request text. */
  text: string[];
};

export type Clarification = {
  needed: boolean;
  /** Explicit references detected in the request text (exact name matches only). */
  detected: { products: string[]; markets: string[] };
  conflicts: ScopeConflict[];
  question?: string;
  /** Scopes the requester can pick from; only present when needed. */
  options?: (Scope & { from: "context" | "text" })[];
  /** Scope used downstream; null while clarification is needed and unanswered. */
  resolved: Scope | null;
  notes: string[];
};

export type KpiDefinition = {
  id: string;
  name: string;
  canonicalMetric: string;
  unit: string;
  definitionStatus: string;
  approvalStatus: string;
  source: SourceRef;
};

export type KpiCheck = {
  canonicalMetric: string;
  /** The request phrase that matched (see metric-phrases.ts). */
  matchedPhrase: string;
  /** The approved canonical definition, if the catalog has exactly one. */
  approved: KpiDefinition | null;
  variants: KpiDefinition[];
  conflict: boolean;
  reasons: string[];
};

export type CoverageItem = { aspect: string; detail: string; evidence: SourceRef[] };

export type ReuseCandidate = {
  assetId: string;
  name: string;
  score: number;
  /** Every part of the score; score is their sum. */
  scoreParts: Record<string, number>;
  /** Requested metrics covered by the approved canonical KPI. */
  coversAllMetrics: boolean;
  coverage: { known: CoverageItem[]; gaps: CoverageItem[]; unknown: string[] };
  owner: { id: string | null; name: string | null; active: boolean };
  facts: { endorsement: string; lifecycleStatus: string; modelId: string | null; modelRefreshStatus: string | null };
  source: SourceRef;
};

/** Which in-scope assets map the approved KPI of one requested metric. */
export type MetricCoverage = { canonicalMetric: string; approvedKpiId: string | null; assetIds: string[] };

export type RecommendationKind = "clarify" | "reuse_candidates" | "build_proposal" | "insufficient_evidence";

export type StewardAnalysis = {
  request: {
    id: string;
    text: string;
    productContext: string;
    marketContext: string;
    status: string;
    source: SourceRef;
  };
  clarification: Clarification;
  kpiChecks: KpiCheck[];
  candidates: ReuseCandidate[];
  /** Empty until discovery runs (clarification needed or no metric named). */
  metricCoverage: MetricCoverage[];
  /**
   * Read-only check that each requested approved KPI can be computed for the
   * resolved scope (T15, D14 mapping, provisional). Empty until discovery runs
   * or while a metric lacks a single approved KPI. Not an approval or a build.
   */
  computability: KpiComputability[];
  recommendation: { kind: RecommendationKind; rationale: string[]; evidence: SourceRef[] };
  /** Labels for team-authored inputs used in this analysis. */
  assumptions: string[];
};

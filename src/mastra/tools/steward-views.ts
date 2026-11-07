// Compact chat views of the deterministic steward results (T16).
//
// The services return complete results with row-level provenance (a full
// StewardAnalysis can reach ~55 KB). Chat history is replayed to the model on
// every turn, so the steward tools send these views instead, to the model
// (toModelOutput) and to the UI stream (transform.display). The views only
// select and rename fields; they never compute, round or reword a value, and
// the recommendation is copied unchanged.
//
// Omitted here: structured provenance, i.e. KPI_Catalog / workbook SourceRefs,
// SQL queries and their arguments, source-row lists, and the D14 mapping label.
// They are not lost: the services are deterministic over the read-only
// imported pack, so the same call with the same inputs reproduces them (see
// docs/ARCHITECTURE.md, "Steward tools").
//
// Kept on purpose: human-readable diagnostic reasons from the services, which
// may name a workbook row to explain an insufficient_data result, e.g.
// "P-BET / FR / 2026-10-01 is forecast_like_synthetic (row 11)". No raw
// source records (row contents) are included in any view.
//
// PROVISIONAL contract (T16): to be agreed with the frontend lane (Viet).
import type { KpiCheck, StewardAnalysis } from "../../services/steward/types";
import type { KpiResult } from "../../services/semantic/types";
import { presentCandidates } from "../../services/steward/discovery";

export const OMITTED_NOTE =
  "Compact chat view. Structured provenance (source references, SQL queries and source-row lists) is omitted from " +
  "this payload and is reproducible by calling the same deterministic service with the same inputs. Diagnostic " +
  "reasons may still name a workbook row, e.g. '(row 11)'; no raw source records are included.";

/** A tool input-validation error returned by Mastra in place of a result. */
export type ToolValidationError = { error: true; message: string } & Record<string, unknown>;

export function isToolValidationError(x: unknown): x is ToolValidationError {
  return typeof x === "object" && x !== null && (x as { error?: unknown }).error === true;
}

export const CANDIDATES_SHOWN = 5;

export type KpiCheckView = {
  canonicalMetric: string;
  matchedPhrase: string;
  approvedKpiId: string | null;
  conflict: boolean;
  variants: { id: string; name: string; definitionStatus: string; approvalStatus: string }[];
  reasons: string[];
};

export function kpiCheckView(k: KpiCheck): KpiCheckView {
  return {
    canonicalMetric: k.canonicalMetric,
    matchedPhrase: k.matchedPhrase,
    approvedKpiId: k.approved?.id ?? null,
    conflict: k.conflict,
    variants: k.variants.map((v) => ({ id: v.id, name: v.name, definitionStatus: v.definitionStatus, approvalStatus: v.approvalStatus })),
    reasons: k.reasons,
  };
}

export type AnalysisView = {
  view: "steward-analysis/v1";
  request: Omit<StewardAnalysis["request"], "source">;
  clarification: Omit<StewardAnalysis["clarification"], "detected">;
  kpiChecks: KpiCheckView[];
  candidates: {
    total: number;
    shown: {
      assetId: string;
      name: string;
      score: number;
      coversAllMetrics: boolean;
      endorsement: string;
      lifecycleStatus: string;
      owner: { id: string | null; name: string | null; active: boolean };
      known: string[];
      gaps: string[];
      unknown: string[];
    }[];
  };
  metricCoverage: StewardAnalysis["metricCoverage"];
  computability: {
    kpiId: string;
    canonicalMetric: string;
    status: string;
    month: string | null;
    valueType: string | null;
    reasons: string[];
    byMarket: { marketId: string; status: string; value: number | null; unit: string | null; issues: string[] }[];
  }[];
  recommendation: { kind: StewardAnalysis["recommendation"]["kind"]; rationale: string[]; evidenceIds: string[] };
  assumptions: string[];
  omitted: string;
};

export function analysisView(a: StewardAnalysis): AnalysisView {
  const { id, text, productContext, marketContext, status } = a.request;
  const { needed, conflicts, question, options, resolved, notes } = a.clarification;
  return {
    view: "steward-analysis/v1",
    request: { id, text, productContext, marketContext, status },
    clarification: { needed, conflicts, question, options, resolved, notes },
    kpiChecks: a.kpiChecks.map(kpiCheckView),
    candidates: {
      total: a.candidates.length,
      // Same truncation rule as discovery: the best complete match, which can
      // drive reuse_candidates from a low rank, is never cut from the view.
      shown: presentCandidates(a.candidates, CANDIDATES_SHOWN).map((c) => ({
        assetId: c.assetId,
        name: c.name,
        score: c.score,
        coversAllMetrics: c.coversAllMetrics,
        endorsement: c.facts.endorsement,
        lifecycleStatus: c.facts.lifecycleStatus,
        owner: c.owner,
        known: c.coverage.known.map((i) => `${i.aspect}: ${i.detail}`),
        gaps: c.coverage.gaps.map((i) => `${i.aspect}: ${i.detail}`),
        unknown: c.coverage.unknown,
      })),
    },
    metricCoverage: a.metricCoverage,
    computability: a.computability.map((c) => ({
      kpiId: c.kpiId,
      canonicalMetric: c.canonicalMetric,
      status: c.status,
      month: c.probe?.month ?? null,
      valueType: c.probe?.valueType ?? null,
      reasons: c.reasons,
      byMarket: (c.probe?.byMarket ?? []).map((m) => ({ marketId: m.marketId, status: m.status, value: m.value, unit: m.unit, issues: m.issues })),
    })),
    recommendation: {
      kind: a.recommendation.kind,
      rationale: a.recommendation.rationale,
      evidenceIds: [...new Set(a.recommendation.evidence.map((e) => e.id).filter((id): id is string => !!id))],
    },
    assumptions: a.assumptions,
    omitted: OMITTED_NOTE,
  };
}

type KpiResultCore = Pick<KpiResult, "kpiId" | "kpiName" | "status" | "value" | "unit" | "reasons" | "issues" | "filters">;

export type KpiResultView = KpiResultCore & {
  view: "kpi-result/v1";
  formula: string | null;
  aggregation: string | null;
  /** How many source rows the value was calculated from (the rows themselves are omitted). */
  sourceRowCount: number;
  omitted: string;
};

export function kpiResultView(r: KpiResult): KpiResultView {
  return {
    view: "kpi-result/v1",
    kpiId: r.kpiId,
    kpiName: r.kpiName,
    status: r.status,
    value: r.value,
    unit: r.unit,
    reasons: r.reasons,
    issues: r.issues,
    filters: r.filters,
    formula: r.provenance.formula,
    aggregation: r.provenance.aggregation,
    sourceRowCount: r.provenance.rows.length,
    omitted: OMITTED_NOTE,
  };
}

export type KpiByMarketView = {
  view: "kpi-by-market/v1";
  kpiId: string;
  results: ({ marketId: string } & Omit<KpiResultView, "view" | "omitted">)[];
  omitted: string;
};

export function kpiByMarketView(kpiId: string, rows: { marketId: string; result: KpiResult }[]): KpiByMarketView {
  return {
    view: "kpi-by-market/v1",
    kpiId,
    results: rows.map(({ marketId, result }) => ({
      marketId,
      kpiId: result.kpiId,
      kpiName: result.kpiName,
      status: result.status,
      value: result.value,
      unit: result.unit,
      reasons: result.reasons,
      issues: result.issues,
      filters: result.filters,
      formula: result.provenance.formula,
      aggregation: result.provenance.aggregation,
      sourceRowCount: result.provenance.rows.length,
    })),
    omitted: OMITTED_NOTE,
  };
}

export type KpiChecksView = { view: "kpi-checks/v1"; text: string; checks: KpiCheckView[]; omitted: string };

/** Validation errors pass through unchanged so the model and UI still see them. */
export function passErrors<T>(project: (x: T) => unknown) {
  return (x: T | ToolValidationError): unknown => (isToolValidationError(x) ? x : project(x as T));
}

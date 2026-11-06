// One deterministic pass: request -> clarification -> KPI check -> discovery ->
// recommendation. No LLM involved; every claim carries a SourceRef.
//
// Recommendation rules, checked in this order; decisions use the full
// candidate set, never the truncated presentation list:
// 1. clarify: request text and context disagree and no answer was given.
// 2. insufficient_evidence: no supported metric is named.
// 3. insufficient_evidence: a metric lacks a single approved canonical KPI
//    (blocks both governed reuse and build).
// 4. reuse_candidates: at least one in-scope asset maps the approved KPI of
//    every requested metric. The requester still has to confirm fit.
// 5. insufficient_evidence: no in-scope asset maps any requested metric
//    (absence of results is not a gap).
// 6. insufficient_evidence: every metric's approved KPI is mapped by some
//    asset, but not by one asset (review the partial candidates).
// 7. build_proposal: at least one metric's approved KPI is mapped by no
//    in-scope asset (a positive, per-metric coverage gap).
import type { Client } from "@libsql/client";
import { discoverCandidates } from "./discovery";
import { checkKpis, loadKpis } from "./kpis";
import { clarify, loadRequest, loadVocabulary, requestSource } from "./requests";
import type { KpiCheck, Scope, SourceRef, StewardAnalysis } from "./types";

export const ASSUMPTIONS = [
  "Metric phrases beyond exact catalog names come from a team-authored list (metric-phrases.ts).",
  "Scope rules are ours: 'All Pharma' / 'Global' context may be narrowed by one explicit text reference; any other disagreement asks the requester.",
  "Candidate score weights and recommendation rules are ours (discovery.ts, analyze.ts).",
  "Asset_KPI_Map is treated as the catalog's record of which KPIs an asset shows; its completeness is not verified.",
  "All values are synthetic challenge data, not actual Bayer performance.",
];

export class RequestNotFoundError extends Error {}

function conflictSummary(checks: KpiCheck[]): string[] {
  return checks
    .filter((k) => k.conflict)
    .map(
      (k) =>
        `KPI conflict for ${k.canonicalMetric}: ` +
        (k.approved ? `approved ${k.approved.id}` : "no single approved definition") +
        (k.variants.length ? ` vs. ${k.variants.map((v) => `${v.id} (${v.definitionStatus})`).join(", ")}` : ""),
    );
}

export async function analyzeRequest(
  db: Client,
  requestId: string,
  answer?: Scope,
  opts: { limit?: number } = {},
): Promise<StewardAnalysis> {
  const row = await loadRequest(db, requestId);
  if (!row) throw new RequestNotFoundError(`Business request not found: ${requestId}`);
  const reqRef = requestSource(row);
  const [vocab, kpis] = await Promise.all([loadVocabulary(db), loadKpis(db)]);
  const clarification = clarify(row, vocab, answer);
  const kpiChecks = checkKpis(row.request_text, kpis);
  const conflicts = conflictSummary(kpiChecks);
  const kpiRefs: SourceRef[] = kpiChecks.flatMap((k) => [...(k.approved ? [k.approved.source] : []), ...k.variants.map((v) => v.source)]);

  const base = {
    request: {
      id: row.request_id,
      text: row.request_text,
      productContext: row.product_context,
      marketContext: row.market_context,
      status: row.status,
      source: reqRef,
    },
    clarification,
    kpiChecks,
    assumptions: ASSUMPTIONS,
  };
  const noDiscovery = { candidates: [], metricCoverage: [] };

  if (clarification.needed || !clarification.resolved) {
    return {
      ...base,
      ...noDiscovery,
      recommendation: {
        kind: "clarify",
        rationale: [clarification.question ?? "Scope unclear.", ...conflicts],
        evidence: [reqRef, ...kpiRefs],
      },
    };
  }

  if (kpiChecks.length === 0) {
    return {
      ...base,
      ...noDiscovery,
      recommendation: {
        kind: "insufficient_evidence",
        rationale: [
          "No supported metric is named explicitly in the request text, so reuse cannot be checked and a build cannot be justified.",
          "Ask the requester which KPI(s) they need.",
        ],
        evidence: [reqRef],
      },
    };
  }

  const scope = clarification.resolved;
  const scopeText = `${scope.product} / ${scope.market}`;
  const { candidates, relevantCount, inScopeCount, completeMatches, metricCoverage } = await discoverCandidates(
    db,
    scope,
    kpiChecks,
    kpis,
    opts,
  );
  const result = (kind: StewardAnalysis["recommendation"]["kind"], rationale: string[], evidence: SourceRef[]): StewardAnalysis => ({
    ...base,
    candidates,
    metricCoverage,
    recommendation: { kind, rationale: [...rationale, ...conflicts], evidence: [reqRef, ...evidence, ...kpiRefs] },
  });
  const perMetric = metricCoverage.map(
    (m) =>
      `${m.canonicalMetric}: ` +
      (m.approvedKpiId
        ? m.assetIds.length
          ? `${m.approvedKpiId} mapped by ${m.assetIds.length} in-scope asset(s)`
          : `${m.approvedKpiId} mapped by no in-scope asset`
        : "no single approved KPI"),
  );

  // An unresolved definition blocks both governed reuse and build.
  const unapproved = kpiChecks.filter((k) => !k.approved).map((k) => k.canonicalMetric);
  if (unapproved.length > 0) {
    return result(
      "insufficient_evidence",
      [
        `No single approved canonical KPI for: ${unapproved.join(", ")}; neither governed reuse nor a build can be recommended.`,
        ...perMetric,
      ],
      candidates.map((c) => c.source),
    );
  }

  if (completeMatches.length > 0) {
    return result(
      "reuse_candidates",
      [
        `${completeMatches.length} in-scope asset(s) for ${scopeText} map the approved KPI for every requested metric.`,
        "Catalog metadata cannot show period, dimensions or filters; the requester must confirm fit before reuse.",
      ],
      completeMatches,
    );
  }
  if (relevantCount === 0) {
    return result(
      "insufficient_evidence",
      [
        inScopeCount === 0
          ? `No catalog asset covers ${scopeText}.`
          : `${inScopeCount} asset(s) cover ${scopeText} but none maps any requested metric.`,
        "Absence of search results alone does not justify a build.",
      ],
      [],
    );
  }

  const uncovered = metricCoverage.filter((m) => m.assetIds.length === 0);
  if (uncovered.length === 0) {
    return result(
      "insufficient_evidence",
      [
        `Every requested metric's approved KPI is mapped by some in-scope asset, but no single asset maps all of them.`,
        ...perMetric,
        "Review the partial candidates with the requester before considering a build.",
      ],
      candidates.map((c) => c.source),
    );
  }

  return result(
    "build_proposal",
    [
      `Checked the KPI mappings of ${inScopeCount} asset(s) covering ${scopeText}; no asset maps the approved KPI for: ${uncovered.map((m) => `${m.canonicalMetric} (${m.approvedKpiId})`).join(", ")}.`,
      ...perMetric,
      `A build would use only approved KPIs: ${kpiChecks.map((k) => k.approved!.id).join(", ")}.`,
      "Not yet checked: whether these KPIs are computable from the pack (D14 mapping, next milestone).",
      "Partial candidates are listed; the requester may still prefer one of them.",
    ],
    candidates.map((c) => c.source),
  );
}

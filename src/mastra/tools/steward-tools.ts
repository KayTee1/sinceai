// Mastra tool adapters over the deterministic steward services (T16).
//
// Thin adapters only: each tool validates the shape of its input, calls the
// existing T14/T15 service, and returns the service result unchanged. All
// business rules (clarification, KPI conflicts, discovery, computability, KPI
// math, value types, month rules) stay in src/services. Domain errors from the
// services are re-thrown unchanged; Mastra reports them as tool errors.
//
// The model and the chat UI receive compact views (steward-views.ts) instead of
// the full results, so row-level provenance is not replayed into the chat
// history on later turns. Execution still returns the full result.
//
// The database comes from an injected provider, so the tools run in tests
// without Next.js (src/db/client.ts is server-only). Production wiring:
//   createStewardTools(db)   // db from "@/db/client"
import type { Client } from "@libsql/client";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { analyzeRequest } from "../../services/steward/analyze";
import { checkKpis, loadKpis } from "../../services/steward/kpis";
import { loadVocabulary } from "../../services/steward/requests";
import { scopeIds } from "../../services/semantic/computability";
import { computeKpi, computeKpiByMarket, latestFactMonth } from "../../services/semantic/compute";
import { VALUE_TYPES } from "../../services/semantic/types";
import type { KpiCheck, StewardAnalysis } from "../../services/steward/types";
import type { KpiResult } from "../../services/semantic/types";
import { analysisView, kpiByMarketView, kpiCheckView, kpiResultView, OMITTED_NOTE, passErrors, type KpiChecksView } from "./steward-views";

/** A tool input that is well-formed but names nothing in the catalog (e.g. an unknown product). */
export class StewardToolInputError extends Error {}

export type ComputeKpiOutput =
  | { breakdown: "total"; result: KpiResult }
  | { breakdown: "by_market"; kpiId: string; results: { marketId: string; result: KpiResult }[] };

export type KpiChecksOutput = { text: string; checks: KpiCheck[] };

const json = (value: unknown) => ({ type: "json" as const, value });

/** Same projection for the model and for the UI stream; validation errors pass through. */
function compact<T>(project: (x: T) => unknown) {
  const view = passErrors(project);
  return {
    toModelOutput: (x: unknown) => json(view(x as T)),
    transform: { display: { output: ({ output }: { output?: unknown }) => view(output as T) } },
  };
}

function computeView(o: ComputeKpiOutput) {
  return o.breakdown === "total" ? kpiResultView(o.result) : kpiByMarketView(o.kpiId, o.results);
}

function checksView(o: KpiChecksOutput): KpiChecksView {
  return { view: "kpi-checks/v1", text: o.text, checks: o.checks.map(kpiCheckView), omitted: OMITTED_NOTE };
}

const scopeName = z.string().trim().min(1).max(100);

export function createStewardTools(getDb: () => Client) {
  const analyzeRequestTool = createTool({
    id: "analyze-request",
    description:
      "Authoritative, deterministic analysis of a stored business request (for example REQ-0001): scope clarification, " +
      "KPI definition conflicts, reuse candidates, KPI computability and a recommendation (clarify, reuse_candidates, " +
      "build_proposal or insufficient_evidence). The recommendation is final: explain it, never override it. It is a " +
      "proposal only; nothing is approved or built. If clarification is needed, ask the user to pick one of " +
      "clarification.options and call again with that option's exact product and market as `answer`. Report numbers " +
      "only from computability values, with their unit and month.",
    inputSchema: z.object({
      requestId: z.string().trim().min(1).max(64).describe("Stored business request ID, e.g. REQ-0001"),
      answer: z
        .object({ product: scopeName, market: scopeName })
        .nullish()
        .describe("Only after a clarify result: the chosen option's exact product and market"),
    }),
    execute: async ({ requestId, answer }): Promise<StewardAnalysis> =>
      analyzeRequest(getDb(), requestId, answer ?? undefined),
    ...compact(analysisView),
  });

  const computeKpiTool = createTool({
    id: "compute-kpi",
    description:
      "The only source of KPI numbers. Computes an approved KPI from the pack under the team's computable KPI mapping, " +
      "with unit, filters and formula. Returns status computed, unsupported (cannot compute from this pack or at this " +
      "grain) or insufficient_data (rows missing, of another value type, or undefined). Never estimate a value that is " +
      "not computed. Scope uses catalog names: product name or 'All Pharma'; market ID, region or 'Global'. Month " +
      "defaults to the latest month in the pack; value type defaults to actual-like.",
    inputSchema: z.object({
      kpiId: z.string().trim().min(1).max(32).describe("KPI ID, e.g. KPI-004"),
      product: scopeName.describe("Product name, e.g. Nubeqa, or 'All Pharma'"),
      market: scopeName.describe("Market ID (DE), region (EMEA) or 'Global'"),
      month: z.string().trim().nullish().describe("First day of the month, YYYY-MM-01; omit for the latest month"),
      valueType: z.enum(VALUE_TYPES).nullish().describe("Omit for actual-like rows"),
      breakdown: z.enum(["total", "by_market"]).nullish().describe("total (default) or one result per market"),
    }),
    execute: async ({ kpiId, product, market, month, valueType, breakdown }): Promise<ComputeKpiOutput> => {
      const db = getDb();
      const ids = scopeIds({ product, market }, await loadVocabulary(db));
      if (!ids) {
        throw new StewardToolInputError(
          `Unknown scope ${product} / ${market}: use a catalog product name or 'All Pharma', and a market ID, region or 'Global'.`,
        );
      }
      const period = month ?? (await latestFactMonth(db));
      if (!period) throw new StewardToolInputError("Product_Market_Monthly has no rows.");
      const query = { kpiId, ...ids, month: period, valueType: valueType ?? undefined };
      return breakdown === "by_market"
        ? { breakdown: "by_market", kpiId, results: await computeKpiByMarket(db, query) }
        : { breakdown: "total", result: await computeKpi(db, query) };
    },
    ...compact(computeView),
  });

  const checkKpiDefinitionsTool = createTool({
    id: "check-kpi-definitions",
    description:
      "Finds the metrics named in free text and checks their KPI definitions: the single approved canonical KPI, its " +
      "variants with definition and approval status, and why they conflict. Uses exact catalog metric names and the " +
      "team's phrase list, longest match first (so 'net sales growth' is not also 'net sales').",
    inputSchema: z.object({ text: z.string().trim().min(1).max(500).describe("Text naming one or more metrics") }),
    execute: async ({ text }): Promise<KpiChecksOutput> => ({ text, checks: checkKpis(text, await loadKpis(getDb())) }),
    ...compact(checksView),
  });

  return { analyzeRequest: analyzeRequestTool, computeKpi: computeKpiTool, checkKpiDefinitions: checkKpiDefinitionsTool };
}

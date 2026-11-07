// Read-only computability check for the steward analysis (T15).
// Answers "can this approved KPI be computed for this scope from the pack?"
// It probes one grain, per market at the latest month in the pack with the
// default value_type. The scope is computable only when every requested market
// computes; partial results are kept per market. Nothing is built and no
// approval is implied.
import type { Client } from "@libsql/client";
import { ALL_PRODUCTS, GLOBAL, type Vocabulary } from "../steward/requests";
import type { Scope } from "../steward/types";
import { computeKpiByMarket, mappingFor } from "./compute";
import { DEFAULT_VALUE_TYPE, type DataIssue, type KpiComputability } from "./types";

const ISSUE_TEXT: Record<DataIssue, string> = {
  missing_row: "no row",
  duplicate_rows: "duplicate rows",
  other_value_type: "other value_type in a needed month",
  blank_measure: "blank measure",
  zero_prior_period: "zero prior month (growth undefined)",
};

/** Product and market IDs for a resolved scope, or null when a name is not in the vocabulary. */
export function scopeIds(scope: Scope, vocab: Vocabulary): { productIds: string[]; marketIds: string[] } | null {
  const productIds =
    scope.product === ALL_PRODUCTS ? vocab.products.map((p) => p.id) : vocab.products.filter((p) => p.name === scope.product).map((p) => p.id);
  const marketIds =
    scope.market === GLOBAL
      ? vocab.markets.map((m) => m.id)
      : vocab.markets.filter((m) => m.region === scope.market || m.id === scope.market).map((m) => m.id);
  return productIds.length > 0 && marketIds.length > 0 ? { productIds, marketIds } : null;
}

export async function checkComputability(
  db: Client,
  kpis: { kpiId: string; canonicalMetric: string }[],
  scope: Scope,
  vocab: Vocabulary,
): Promise<KpiComputability[]> {
  const ids = scopeIds(scope, vocab);
  // Latest month of the whole fact table, not of the scope: a scope whose
  // newest rows are missing must show that gap, not fall back to older data.
  // Read only when a KPI is mapped, so unsupported KPIs never touch the facts.
  let month: string | null | undefined;
  const latestMonth = async () => {
    if (month === undefined) {
      const latest = await db.execute(`SELECT max(month) AS month FROM Product_Market_Monthly`);
      month = latest.rows[0]?.month ? String(latest.rows[0].month) : null;
    }
    return month;
  };

  const out: KpiComputability[] = [];
  for (const k of kpis) {
    const base = { kpiId: k.kpiId, canonicalMetric: k.canonicalMetric };
    const mapping = await mappingFor(db, k.kpiId);
    if (!mapping.entry) {
      out.push({ ...base, status: "unsupported", probe: null, reasons: mapping.reasons });
      continue;
    }
    const month = await latestMonth();
    if (!ids || !month) {
      out.push({
        ...base,
        status: "insufficient_data",
        probe: null,
        reasons: [`No Product_Market_Monthly rows for ${scope.product} / ${scope.market}.`],
      });
      continue;
    }
    const results = await computeKpiByMarket(db, { kpiId: k.kpiId, ...ids, month, valueType: DEFAULT_VALUE_TYPE });
    if (results.length === 0) {
      out.push({ ...base, status: "insufficient_data", probe: null, reasons: [`No markets to probe for ${scope.product} / ${scope.market}.`] });
      continue;
    }
    if (results.every((r) => r.result.status === "unsupported")) {
      out.push({ ...base, status: "unsupported", probe: null, reasons: results[0].result.reasons });
      continue;
    }
    const ok = results.filter((r) => r.result.status === "computed").map((r) => r.marketId);
    const reasons = [
      `Probed per market at ${month} (${DEFAULT_VALUE_TYPE} rows only): computable for ${ok.length} of ${results.length} market(s)` +
        (ok.length ? ` (${ok.join(", ")})` : "") +
        ".",
    ];
    const byIssue = new Map<DataIssue, string[]>();
    for (const r of results) for (const i of r.result.issues) byIssue.set(i, [...(byIssue.get(i) ?? []), r.marketId]);
    for (const [issue, markets] of byIssue) reasons.push(`Insufficient data (${ISSUE_TEXT[issue]}): ${markets.join(", ")}.`);
    out.push({
      ...base,
      status: ok.length === results.length ? "computable" : ok.length > 0 ? "incomplete" : "insufficient_data",
      probe: {
        month,
        valueType: DEFAULT_VALUE_TYPE,
        productIds: ids.productIds,
        byMarket: results.map(({ marketId, result: r }) => ({
          marketId,
          status: r.status,
          value: r.value,
          unit: r.unit,
          issues: r.issues,
          reasons: r.reasons,
          filters: r.filters,
          provenance: r.provenance,
        })),
      },
      reasons,
    });
  }
  return out;
}

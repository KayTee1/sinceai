// Deterministic KPI computation over Product_Market_Monthly (T15).
//
// Rules (ours, applied to every method):
// - One value_type per calculation. A row of another value_type makes the
//   result insufficient_data; it is never dropped silently, because that would
//   change the population (e.g. a "Global" total missing some markets).
// - Every selected product x market cell must have exactly one row for each
//   month the method needs.
// - Additive measures (M EUR) are summed. Growth is a ratio of sums, never an
//   average of per-cell growth rates. Percentages without a denominator in the
//   pack are never summed or averaged: they are computed for one cell only.
// - Arithmetic runs in TypeScript over rows from one logged query, in a fixed
//   order, and the result is rounded to 6 decimals.
import type { Client } from "@libsql/client";
import type { SourceRef } from "../steward/types";
import { isApprovedCanonical } from "../steward/kpis";
import { D14_MAPPING, D14_NOT_IMPLEMENTED, MAPPING_LABEL, type FactColumn, type MappingEntry, type Method } from "./d14-mapping";
import { DEFAULT_VALUE_TYPE, VALUE_TYPES, type DataIssue, type KpiQuery, type KpiResult, type ValueType } from "./types";

const MONTH = /^(\d{4})-(\d{2})-01$/;
const SHEET = "Product_Market_Monthly";

export class InvalidKpiQueryError extends Error {}

/** "2026-10-01" -> "2026-09-01". */
export function priorMonth(month: string): string {
  const m = MONTH.exec(month);
  if (!m) throw new InvalidKpiQueryError(`Month must be YYYY-MM-01: ${month}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return mo === 1 ? `${y - 1}-12-01` : `${y}-${String(mo - 1).padStart(2, "0")}-01`;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0; // + 0 turns -0 into 0

function methodColumns(m: Method): FactColumn[] {
  return m.kind === "difference_of_sums" ? [m.minuend, m.subtrahend] : [m.column];
}

function aggregationText(m: Method): string {
  switch (m.kind) {
    case "sum":
      return "Sum over the selected product x market cells (additive measure).";
    case "difference_of_sums":
      return "Sum of each measure over the selected cells, then the difference (additive measures).";
    case "period_growth":
      return "Ratio of sums over the same cells in both months; per-cell growth rates are never averaged.";
    case "cell_value":
      return "One product x market cell only; the pack has no weights, so the percentage is not summed or averaged.";
  }
}

type CatalogRow = { kpi_name: string; unit: string; definition_status: string; approval_status: string; _source_row: number };

type FactRow = {
  product_id: string;
  market_id: string;
  month: string;
  value_type: string;
  _source_row: number;
} & Partial<Record<FactColumn, number | null>>;

function factRef(r: FactRow): SourceRef {
  return { sheet: SHEET, row: Number(r._source_row), id: `${r.product_id}|${r.market_id}|${r.month}` };
}

function normalize(q: KpiQuery): { productIds: string[]; marketIds: string[]; month: string; valueType: ValueType } {
  const productIds = [...new Set(q.productIds)].sort();
  const marketIds = [...new Set(q.marketIds)].sort();
  const valueType = q.valueType ?? DEFAULT_VALUE_TYPE;
  if (productIds.length === 0 || marketIds.length === 0) throw new InvalidKpiQueryError("At least one product and one market are required");
  if (!MONTH.test(q.month)) throw new InvalidKpiQueryError(`Month must be YYYY-MM-01: ${q.month}`);
  if (!VALUE_TYPES.includes(valueType)) throw new InvalidKpiQueryError(`Unknown value_type: ${valueType}`);
  return { productIds, marketIds, month: q.month, valueType };
}

/** Mapping-level support, before any fact rows are read. */
export async function mappingFor(
  db: Client,
  kpiId: string,
): Promise<{ entry: MappingEntry | null; catalog: (CatalogRow & { ref: SourceRef }) | null; reasons: string[] }> {
  const res = await db.execute({
    sql: `SELECT kpi_name, unit, definition_status, approval_status, _source_row FROM KPI_Catalog WHERE kpi_id = ?`,
    args: [kpiId],
  });
  if (res.rows.length !== 1) {
    return { entry: null, catalog: null, reasons: [res.rows.length === 0 ? `${kpiId} is not in KPI_Catalog.` : `${kpiId} appears ${res.rows.length} times in KPI_Catalog.`] };
  }
  const row = res.rows[0] as unknown as CatalogRow;
  const catalog = { ...row, ref: { sheet: "KPI_Catalog", row: Number(row._source_row), id: kpiId } };
  const reasons: string[] = [];
  const approved = isApprovedCanonical({
    id: kpiId,
    name: row.kpi_name,
    canonicalMetric: "",
    unit: row.unit,
    definitionStatus: row.definition_status,
    approvalStatus: row.approval_status,
    source: catalog.ref,
  });
  if (!approved) reasons.push(`${kpiId} is ${row.definition_status} / ${row.approval_status}; only approved canonical KPIs are computed.`);
  const entry = D14_MAPPING[kpiId] ?? null;
  if (!entry) {
    reasons.push(D14_NOT_IMPLEMENTED[kpiId] ?? `Cannot compute ${kpiId} from this pack: it is not in the computable KPI mapping.`);
  } else if (entry.catalogUnit !== row.unit) {
    reasons.push(`KPI_Catalog unit for ${kpiId} is "${row.unit}", but the mapping expects "${entry.catalogUnit}".`);
  }
  return { entry: reasons.length === 0 ? entry : null, catalog, reasons };
}

export async function computeKpi(db: Client, query: KpiQuery): Promise<KpiResult> {
  const f = normalize(query);
  const { entry, catalog, reasons: mappingReasons } = await mappingFor(db, query.kpiId);
  type Prov = Partial<Pick<KpiResult["provenance"], "query" | "rows">>;
  const result = (
    status: KpiResult["status"],
    reasons: string[],
    prov: Prov = {},
    value: number | null = null,
    issues: DataIssue[] = [],
  ): KpiResult => ({
    kpiId: query.kpiId,
    kpiName: catalog?.kpi_name ?? null,
    status,
    value,
    unit: entry?.resultUnit ?? null,
    reasons,
    issues: [...new Set(issues)],
    filters: { ...f, ...(entry?.method.kind === "period_growth" ? { priorMonth: priorMonth(f.month) } : {}) },
    provenance: {
      mapping: MAPPING_LABEL,
      formula: entry?.formula ?? null,
      aggregation: entry ? aggregationText(entry.method) : null,
      catalog: catalog?.ref ?? null,
      query: prov.query ?? null,
      rows: prov.rows ?? [],
    },
  });

  if (!entry) return result("unsupported", mappingReasons);

  const m = entry.method;
  const cells = f.productIds.length * f.marketIds.length;
  if (m.kind === "cell_value" && cells > 1) {
    return result("unsupported", [
      `${query.kpiId} is a percentage without a denominator in the pack; it is computed per product and market only, not aggregated over ${cells} cells.`,
    ]);
  }

  const months = m.kind === "period_growth" ? [priorMonth(f.month), f.month] : [f.month];
  const cols = methodColumns(m);
  const ph = (n: number) => Array(n).fill("?").join(", ");
  const sql =
    `SELECT product_id, market_id, month, value_type, ${cols.join(", ")}, _source_row FROM ${SHEET} ` +
    `WHERE product_id IN (${ph(f.productIds.length)}) AND market_id IN (${ph(f.marketIds.length)}) AND month IN (${ph(months.length)}) ` +
    `ORDER BY product_id, market_id, month, _source_row`;
  const args = [...f.productIds, ...f.marketIds, ...months];
  const rows = (await db.execute({ sql, args })).rows as unknown as FactRow[];
  const queryRef = { sql, args };

  // Exactly one usable row per cell and month.
  const problems: string[] = [];
  const issues: DataIssue[] = [];
  const byKey = new Map<string, FactRow[]>();
  for (const r of rows) {
    const k = `${r.product_id}|${r.market_id}|${r.month}`;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const picked: Record<string, FactRow[]> = Object.fromEntries(months.map((mo) => [mo, []]));
  for (const p of f.productIds) {
    for (const mk of f.marketIds) {
      for (const mo of months) {
        const found = byKey.get(`${p}|${mk}|${mo}`) ?? [];
        const where = `${p} / ${mk} / ${mo}`;
        if (found.length === 0) {
          problems.push(`No ${SHEET} row for ${where}.`);
          issues.push("missing_row");
        } else if (found.length > 1) {
          problems.push(`${found.length} ${SHEET} rows for ${where} (rows ${found.map((r) => r._source_row).join(", ")}).`);
          issues.push("duplicate_rows");
        } else if (found[0].value_type !== f.valueType) {
          problems.push(`${where} is ${found[0].value_type} (row ${found[0]._source_row}); requested ${f.valueType}, and value types are not mixed.`);
          issues.push("other_value_type");
        } else if (cols.some((c) => typeof found[0][c] !== "number")) {
          problems.push(`${where} has a blank measure (row ${found[0]._source_row}).`);
          issues.push("blank_measure");
        } else picked[mo].push(found[0]);
      }
    }
  }
  if (problems.length > 0) return result("insufficient_data", problems, { query: queryRef }, null, issues);

  const sum = (rs: FactRow[], c: FactColumn) => rs.reduce((s, r) => s + (r[c] as number), 0);
  const used = months.flatMap((mo) => picked[mo]).map(factRef);
  const provenance = { query: queryRef, rows: used };
  const now = picked[f.month];
  let value: number;
  switch (m.kind) {
    case "sum":
      value = sum(now, m.column);
      break;
    case "difference_of_sums":
      value = sum(now, m.minuend) - sum(now, m.subtrahend);
      break;
    case "cell_value":
      value = now[0][m.column] as number;
      break;
    case "period_growth": {
      const prior = sum(picked[months[0]], m.column);
      if (!(prior > 0)) {
        return result(
          "insufficient_data",
          [`Prior-month ${m.column} for these cells is ${round6(prior)} in ${months[0]}; growth is undefined.`],
          provenance,
          null,
          ["zero_prior_period"],
        );
      }
      value = ((sum(now, m.column) - prior) / prior) * 100;
      break;
    }
  }
  return result("computed", [], provenance, round6(value));
}

/** One result per market (same products), e.g. for a "by country" request. */
export async function computeKpiByMarket(db: Client, query: KpiQuery): Promise<{ marketId: string; result: KpiResult }[]> {
  const out: { marketId: string; result: KpiResult }[] = [];
  for (const marketId of [...new Set(query.marketIds)].sort()) {
    out.push({ marketId, result: await computeKpi(db, { ...query, marketIds: [marketId] }) });
  }
  return out;
}

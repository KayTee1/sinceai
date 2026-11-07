"use client";

import { useState } from "react";
import type { Insight, InsightResult } from "@/services/build";
import { formatDate, formatMonth } from "@/lib/format";

type Cell = { kpi: InsightResult; market: InsightResult["byMarket"][number] };

function formatValue(value: number | null, unit: string | null) {
  if (value === null) return "–";
  const n = value.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  if (unit === "%") return `${n}%`;
  if (unit === "M EUR" || unit === "EUR") {
    const abs = Math.abs(value).toLocaleString("en-GB", { maximumFractionDigits: 2 });
    return `${value < 0 ? "−" : ""}€${abs}m`;
  }
  return unit ? `${n} ${unit}` : n;
}

// A Temporary insight built by the steward (step 4): computed KPI values per
// market, each traceable to its formula, filters, query and source rows (D6).
export function InsightBody({ insight }: { insight: Insight | undefined }) {
  const [open, setOpen] = useState<Cell | null>(null);
  if (!insight)
    return <div className="rounded-sm border border-line bg-surface p-6 text-sm text-ink-2">Insight not found.</div>;

  const markets = insight.results[0]?.byMarket.map((m) => m.marketId) ?? [];
  const month = insight.results[0]?.month;

  return (
    <div className="space-y-5">
      <div className="rounded-sm border border-line bg-surface">
        <div className="flex items-baseline justify-between border-b border-line px-5 py-3">
          <h3 className="text-sm font-semibold">Computed from certified KPIs</h3>
          <span className="text-xs text-ink-3">
            {month ? `${formatMonth(month)} ${month.slice(0, 4)}` : ""} · actual-like rows · built{" "}
            {formatDate(insight.builtOn)} for {insight.requestId}
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-3">
              <th className="px-5 py-2 font-medium">Market</th>
              {insight.results.map((r) => (
                <th key={r.kpiId} className="px-5 py-2 text-right font-medium">
                  {r.kpiName ?? r.kpiId} <span className="text-ink-3">({r.kpiId})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {markets.map((marketId, row) => (
              <tr key={marketId} className="border-b border-line last:border-0">
                <td className="px-5 py-2 font-medium">{marketId}</td>
                {insight.results.map((kpi) => {
                  const market = kpi.byMarket[row];
                  const active = open?.kpi.kpiId === kpi.kpiId && open.market.marketId === marketId;
                  return (
                    <td key={kpi.kpiId} className="px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => setOpen(active ? null : { kpi, market })}
                        title="Show how this value was computed"
                        className={`tabular rounded-sm px-3 py-1 underline decoration-dotted underline-offset-4 ${
                          active ? "bg-[#e6f4fc] text-[#00609a]" : "hover:bg-canvas"
                        } ${market.status === "computed" ? "" : "text-warn"}`}
                      >
                        {market.status === "computed"
                          ? formatValue(market.value, market.unit)
                          : market.status.replace("_", " ")}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-line px-5 py-2 text-[11px] text-ink-3">
          Numbers are computed by code over Product_Market_Monthly rows, never by the AI. Synthetic challenge data, not
          actual Bayer performance. Click a value to see how it was computed.
        </p>
      </div>

      {open && <Provenance cell={open} />}
    </div>
  );
}

function Provenance({ cell }: { cell: Cell }) {
  const { kpi, market } = cell;
  const p = market.provenance;
  return (
    <div className="rounded-sm border border-blue/40 bg-surface">
      <div className="flex items-baseline justify-between border-b border-line px-5 py-3">
        <h3 className="text-sm font-semibold">
          How {kpi.kpiName ?? kpi.kpiId} for {market.marketId} was computed
        </h3>
        <span className="tabular text-sm font-semibold">{formatValue(market.value, market.unit)}</span>
      </div>
      <dl className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-1.5 px-5 py-4 text-xs">
        <dt className="text-ink-3">Definition</dt>
        <dd>
          {kpi.kpiId}
          {p.catalog ? ` · KPI_Catalog row ${p.catalog.row}` : ""} · {p.mapping}
        </dd>
        <dt className="text-ink-3">Formula</dt>
        <dd>{p.formula ?? "–"}</dd>
        <dt className="text-ink-3">Aggregation</dt>
        <dd>{p.aggregation ?? "–"}</dd>
        <dt className="text-ink-3">Filters</dt>
        <dd>
          products {market.filters.productIds.join(", ")} · market {market.filters.marketIds.join(", ")} · month{" "}
          {market.filters.month}
          {market.filters.priorMonth ? ` vs ${market.filters.priorMonth}` : ""} · {market.filters.valueType}
        </dd>
        <dt className="text-ink-3">Source rows</dt>
        <dd>
          {p.rows.length} rows of {p.rows[0]?.sheet ?? "Product_Market_Monthly"}:{" "}
          {p.rows.map((r) => `row ${r.row}`).join(", ")}
        </dd>
        {market.reasons.length > 0 && (
          <>
            <dt className="text-ink-3">Notes</dt>
            <dd>{market.reasons.join(" ")}</dd>
          </>
        )}
        <dt className="text-ink-3">Query</dt>
        <dd>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-sm border border-line bg-canvas p-2 font-mono text-[11px]">
            {p.query ? `${p.query.sql}\n-- args: ${p.query.args.join(", ")}` : "–"}
          </pre>
        </dd>
      </dl>
    </div>
  );
}

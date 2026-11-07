"use client";

import { useMemo, useState } from "react";
import type { AssetSummary, DashboardData } from "@/lib/types";
import { eurM, formatDate, formatMonth, int, pct } from "@/lib/format";
import { BreakdownChart, SalesTrendChart } from "./charts";
import { InsightBody } from "./insight-body";
import { TierBadge } from "./tier-badge";
import { Card, Note, Pill, Stat, StatRow, toneFor } from "./ui";

// Business performance: synthetic pharma facts from the pack (Product_Market_Monthly
// with Products and Markets; Market_Access, Supply_Operations, Launch_Milestones).
// These are our views on the facts, not copies of any catalog asset.

type Board = "commercial" | "access" | "supply" | "launch";
const BOARDS: { id: Board; label: string; source: string }[] = [
  { id: "commercial", label: "Commercial performance", source: "Product_Market_Monthly" },
  { id: "access", label: "Market access", source: "Market_Access" },
  { id: "supply", label: "Supply operations", source: "Supply_Operations" },
  { id: "launch", label: "Launch milestones", source: "Launch_Milestones" },
];

const ALL = "__all";

export function BusinessView({ data, built }: { data: DashboardData; built: AssetSummary[] }) {
  const [board, setBoard] = useState<Board | string>("commercial");
  const [product, setProduct] = useState(ALL);
  const [market, setMarket] = useState(ALL);
  const regions = useMemo(() => [...new Set(data.markets.map((m) => m.region))], [data.markets]);
  const marketIds = useMemo(() => {
    if (market === ALL) return null;
    if (regions.includes(market)) return new Set(data.markets.filter((m) => m.region === market).map((m) => m.id));
    return new Set([market]);
  }, [market, data.markets, regions]);
  const keep = (p: string, m: string) => (product === ALL || p === product) && (!marketIds || marketIds.has(m));
  const insight = built.find((b) => b.id === board);

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-[260px] shrink-0 overflow-y-auto border-r border-line bg-surface">
        <div className="p-4 pb-2 text-sm font-semibold">Business dashboards</div>
        <ul>
          {BOARDS.map((b) => (
            <NavItem
              key={b.id}
              active={board === b.id}
              onClick={() => setBoard(b.id)}
              title={b.label}
              note={b.source}
            />
          ))}
        </ul>
        <div className="mt-3 border-t border-line p-4 pb-2 text-sm font-semibold">Built insights</div>
        <ul>
          {built.length === 0 && (
            <li className="px-4 pb-4 text-xs text-ink-3">
              None yet. The steward builds one when nothing existing fits.
            </li>
          )}
          {built.map((b) => (
            <NavItem
              key={b.id}
              active={board === b.id}
              onClick={() => setBoard(b.id)}
              title={b.name}
              note={b.id}
              badge={<TierBadge tier={b.tier} />}
            />
          ))}
        </ul>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] space-y-5 p-6">
          {insight ? (
            <>
              <header className="space-y-1">
                <div className="text-xs text-ink-3">Built insight · {insight.id}</div>
                <h1 className="text-2xl font-semibold tracking-tight">{insight.name}</h1>
              </header>
              <InsightBody insight={data.insights[insight.id]} />
            </>
          ) : (
            <>
              <header className="flex flex-wrap items-end justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs text-ink-3">Business performance</div>
                  <h1 className="text-2xl font-semibold tracking-tight">{BOARDS.find((b) => b.id === board)?.label}</h1>
                </div>
                <div className="flex gap-2 text-xs">
                  <Select value={product} onChange={setProduct} label="Product">
                    <option value={ALL}>All products</option>
                    {data.business.products.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name} · {p.therapeuticArea}
                      </option>
                    ))}
                  </Select>
                  <Select value={market} onChange={setMarket} label="Market">
                    <option value={ALL}>All markets</option>
                    {regions.map((r) => (
                      <option key={r} value={r}>
                        {r} (region)
                      </option>
                    ))}
                    {data.markets.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </header>
              <Note>
                Synthetic challenge data from the Bayer pack, shown as our own views on the facts. Not actual Bayer
                performance, and not the content of any catalog asset.
              </Note>
              {board === "commercial" && <Commercial data={data} keep={keep} single={product !== ALL} />}
              {board === "access" && <Access data={data} keep={keep} />}
              {board === "supply" && <Supply data={data} keep={keep} />}
              {board === "launch" && <Launch data={data} keep={keep} />}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

type Keep = (product: string, market: string) => boolean;

function Commercial({ data, keep, single }: { data: DashboardData; keep: Keep; single: boolean }) {
  // D15: actual-like and forecast-like rows are never blended in one figure.
  const [valueType, setValueType] = useState("actual_like_synthetic");
  const all = data.business.productMarket.filter((r) => keep(r.product, r.market));
  const rows = all.filter((r) => r.valueType === valueType);
  const marketName = new Map(data.markets.map((m) => [m.id, m.name]));

  const byMonth = new Map<string, { netSales: number; forecast: number }>();
  const byKey = new Map<string, number>();
  let net = 0;
  let fc = 0;
  for (const r of rows) {
    const m = byMonth.get(r.month) ?? { netSales: 0, forecast: 0 };
    m.netSales += r.netSales;
    m.forecast += r.forecast;
    byMonth.set(r.month, m);
    const k = single ? (marketName.get(r.market) ?? r.market) : r.product;
    byKey.set(k, (byKey.get(k) ?? 0) + r.netSales);
    net += r.netSales;
    fc += r.forecast;
  }
  const trend = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month: formatMonth(month), netSales: round(v.netSales), forecast: round(v.forecast) }));
  const breakdown = [...byKey.entries()]
    .map(([name, value]) => ({ name, value: round(value) }))
    .sort((a, b) => b.value - a.value);

  return (
    <>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-ink-3">Rows</span>
        {[
          ["actual_like_synthetic", "Actual-like"],
          ["forecast_like_synthetic", "Forecast-like"],
        ].map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => setValueType(v)}
            className={`rounded-sm px-2.5 py-1 font-medium ${valueType === v ? "bg-navy text-white" : "text-ink-2 hover:bg-canvas"}`}
          >
            {l}
          </button>
        ))}
        <span className="text-ink-3">
          · {rows.length} of {all.length} product-market-month rows (value types are never mixed)
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-3">No rows for this selection.</p>
      ) : (
        <>
          <StatRow>
            <Stat label="Net sales" value={eurM(net)} note="Sum of selected rows" />
            <Stat label="Forecast" value={eurM(fc)} note="Same rows" />
            <Stat label="vs. forecast" value={`${net >= fc ? "+" : ""}${pct(fc ? ((net - fc) / fc) * 100 : 0)}`} />
            <Stat
              label="Rows"
              value={int(rows.length)}
              note={valueType === "actual_like_synthetic" ? "actual-like" : "forecast-like"}
            />
          </StatRow>
          <Card title="Net sales vs. forecast" subtitle="€ millions per month">
            <SalesTrendChart data={trend} />
          </Card>
          <Card title={`Net sales by ${single ? "market" : "product"}`} subtitle="€ millions, selected rows">
            <BreakdownChart data={breakdown} />
          </Card>
        </>
      )}
    </>
  );
}

function Access({ data, keep }: { data: DashboardData; keep: Keep }) {
  const rows = data.business.marketAccess.filter((r) => keep(r.product, r.market));
  const listed = rows.filter((r) => r.reimbursement === "listed").length;
  // Coverage % is shown per product and market only; percentages are never averaged (D15).
  const bars = rows
    .map((r) => ({ name: `${r.product} · ${r.market}`, value: Number(r.coveragePct) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 20);
  return (
    <>
      <StatRow>
        <Stat label="Product-markets" value={int(rows.length)} />
        <Stat label="Listed" value={int(listed)} note="reimbursement status" />
        <Stat label="Not listed yet" value={int(rows.length - listed)} />
        <Stat
          label="High priority"
          value={int(rows.filter((r) => r.priority === "high").length)}
          note="analytics priority"
        />
      </StatRow>
      <Card title="Coverage by product and market" subtitle="% · top 20 · never averaged">
        <BreakdownChart data={bars} format={(v) => pct(v)} labelWidth={150} label="Coverage" />
      </Card>
      <Table
        head={["Product", "Market", "Reimbursement", "Coverage model", "Coverage", "Trend", "Priority"]}
        rows={rows.map((r) => [
          r.product,
          r.market,
          <Pill key="r" text={r.reimbursement} tone={toneFor(r.reimbursement)} />,
          r.coverageModel.replaceAll("_", " "),
          pct(Number(r.coveragePct)),
          <Pill key="t" text={r.trend} tone={toneFor(r.trend)} />,
          r.priority,
        ])}
      />
    </>
  );
}

function Supply({ data, keep }: { data: DashboardData; keep: Keep }) {
  const rows = data.business.supply.filter((r) => keep(r.product, r.market));
  const risk = (s: string) => rows.filter((r) => r.risk === s).length;
  const bars = rows
    .map((r) => ({ name: `${r.product} · ${r.market}`, value: Number(r.otifPct) }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 20);
  return (
    <>
      <StatRow>
        <Stat label="Product-markets" value={int(rows.length)} />
        <Stat label="Risk red" value={int(risk("red"))} note="risk_status" />
        <Stat label="Risk amber" value={int(risk("amber"))} />
        <Stat label="Risk green" value={int(risk("green"))} />
      </StatRow>
      <Card title="OTIF by product and market" subtitle="% on time in full · lowest 20">
        <BreakdownChart data={bars} format={(v) => pct(v)} labelWidth={150} label="OTIF" />
      </Card>
      <Table
        head={["Product", "Market", "Risk", "OTIF", "Inventory", "Forecast accuracy", "Mode", "Source"]}
        rows={rows.map((r) => [
          r.product,
          r.market,
          <Pill key="k" text={r.risk} tone={toneFor(r.risk)} />,
          pct(Number(r.otifPct)),
          `${Number(r.inventoryWeeks).toFixed(1)} wk`,
          pct(Number(r.forecastAccuracyPct)),
          r.mode,
          r.source.replaceAll("_", " "),
        ])}
      />
    </>
  );
}

function Launch({ data, keep }: { data: DashboardData; keep: Keep }) {
  const rows = data.business.milestones.filter((r) => keep(r.product, r.market));
  const by = (s: string) => rows.filter((r) => r.status === s).length;
  return (
    <>
      <StatRow>
        <Stat label="Milestones" value={int(rows.length)} />
        <Stat label="Completed" value={int(by("completed"))} />
        <Stat label="In progress" value={int(by("in_progress"))} />
        <Stat label="Planned" value={int(by("planned"))} />
      </StatRow>
      <Table
        head={["Date", "Product", "Market", "Milestone", "Status", "Impact"]}
        rows={rows.map((r) => [
          formatDate(r.date),
          r.product,
          r.market,
          r.type.replaceAll("_", " "),
          <Pill key="s" text={r.status} tone={toneFor(r.status)} />,
          r.impact,
        ])}
      />
    </>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (rows.length === 0) return <p className="text-sm text-ink-3">No rows for this selection.</p>;
  return (
    <div className="overflow-x-auto rounded-sm border border-line bg-surface">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line text-left text-ink-3">
            {head.map((h) => (
              <th key={h} className="px-4 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="tabular border-b border-line last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-1.5">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-1.5 text-ink-3">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-sm border border-line-strong bg-surface px-2 py-1.5 text-ink focus:border-blue focus:outline-none"
      >
        {children}
      </select>
    </label>
  );
}

function NavItem({
  active,
  onClick,
  title,
  note,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  note: string;
  badge?: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`block w-full border-l-[3px] px-4 py-2.5 text-left ${
          active ? "border-l-blue bg-[#eef6fb]" : "border-l-transparent hover:bg-canvas"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium leading-snug">{title}</span>
          {badge}
        </div>
        <div className="text-[11px] text-ink-3">{note}</div>
      </button>
    </li>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;

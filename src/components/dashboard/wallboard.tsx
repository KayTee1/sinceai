"use client";

import type { AssetSummary, DashboardData } from "@/lib/types";
import { eurM, formatDate, formatMonth, int, pct } from "@/lib/format";
import { BreakdownChart, SalesTrendChart } from "./charts";

// Wallboard rendering of one dashboard (D22): glanceable tiles and charts built
// from the dashboard's own catalog KPIs (its domain) over the pack's business
// facts, for the dashboard's product and market scope. The pack has no report
// layouts, so the layout is ours and labelled as such.

export type Keep = (product: string, market: string) => boolean;

const ACTUAL = "actual_like_synthetic"; // D15: one value type per figure, never blended

/** Rows in the dashboard's scope: "All Pharma" = every product, "Global" = every market. */
export function scopeFilter(asset: AssetSummary, data: DashboardData): Keep {
  const region = new Map(data.markets.map((m) => [m.id, m.region]));
  return (product, market) =>
    (asset.productScope === "All Pharma" || product === asset.productScope) &&
    (asset.marketScope === "Global" || market === asset.marketScope || region.get(market) === asset.marketScope);
}

export function DomainBoard({ asset, data }: { asset: AssetSummary; data: DashboardData }) {
  const keep = scopeFilter(asset, data);
  const multiProduct = asset.productScope === "All Pharma";
  switch (asset.domain) {
    case "Commercial":
      return <Sales data={data} keep={keep} multiProduct={multiProduct} focus="sales" />;
    case "Finance":
      return <Sales data={data} keep={keep} multiProduct={multiProduct} focus="forecast" />;
    case "Market Access":
      return <Access data={data} keep={keep} multiProduct={multiProduct} />;
    case "Supply Chain":
      return <Supply data={data} keep={keep} multiProduct={multiProduct} />;
    case "Launch Excellence":
      return <Launch data={data} keep={keep} />;
    default:
      return <Governance asset={asset} data={data} />;
  }
}

function Sales({
  data,
  keep,
  multiProduct,
  focus,
}: {
  data: DashboardData;
  keep: Keep;
  multiProduct: boolean;
  focus: "sales" | "forecast";
}) {
  const name = new Map(data.markets.map((m) => [m.id, m.name]));
  const rows = data.business.productMarket.filter((r) => r.valueType === ACTUAL && keep(r.product, r.market));
  if (rows.length === 0) return <Empty />;
  if (rows.every((r) => r.netSales === 0 && r.forecast === 0)) {
    return (
      <Empty text="The pack records no net sales or forecast for this dashboard's product and market (every value is zero)." />
    );
  }
  const latest = rows.reduce((m, r) => (r.month > m ? r.month : m), "");
  const month = rows.filter((r) => r.month === latest);
  const sum = (xs: typeof rows, k: "netSales" | "forecast") => xs.reduce((s, r) => s + r[k], 0);
  const net = sum(month, "netSales");
  const fc = sum(month, "forecast");
  const behind = month.filter((r) => r.netSales < r.forecast);
  const label = (r: (typeof rows)[number]) =>
    `${multiProduct ? r.product + " · " : ""}${name.get(r.market) ?? r.market}`;

  const trend = [...group(rows, (r) => r.month).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, xs]) => ({
      month: formatMonth(m),
      netSales: round(sum(xs, "netSales")),
      forecast: round(sum(xs, "forecast")),
    }));
  const byKey = [...group(rows, (r) => (multiProduct ? r.product : (name.get(r.market) ?? r.market))).entries()]
    .map(([n, xs]) => ({ name: n, value: round(sum(xs, "netSales")) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const shortfall = behind
    .map((r) => ({ name: label(r), value: round(r.forecast - r.netSales) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const variance = fc ? ((net - fc) / fc) * 100 : 0;

  return (
    <>
      <Tiles>
        <Tile label={`Net sales · ${formatMonth(latest)}`} value={eurM(net)} />
        <Tile
          label="vs. forecast"
          value={`${net >= fc ? "+" : ""}${pct(variance)}`}
          tone={net >= fc ? "good" : "warn"}
          status={net >= fc ? "On track" : "Below forecast"}
        />
        {focus === "sales" ? (
          <Tile label="Net sales · year to date" value={eurM(sum(rows, "netSales"))} />
        ) : (
          <Tile label="Forecast · year to date" value={eurM(sum(rows, "forecast"))} />
        )}
        <Tile
          label="Markets below forecast"
          value={`${behind.length} of ${month.length}`}
          tone={behind.length ? "warn" : "good"}
          status={behind.length ? "Needs attention" : "All on track"}
        />
      </Tiles>
      <Grid>
        <Panel title="Net sales vs. forecast" note="€ millions · actual-like months only">
          <SalesTrendChart data={trend} />
        </Panel>
        {focus === "sales" ? (
          <Panel title={multiProduct ? "Net sales by product" : "Net sales by market"} note="€ millions, year to date">
            <BreakdownChart data={byKey} labelWidth={130} />
          </Panel>
        ) : (
          <Panel title="Furthest below forecast" note={`€ millions · ${formatMonth(latest)}`}>
            {shortfall.length ? (
              <BreakdownChart data={shortfall} label="Below forecast" labelWidth={170} />
            ) : (
              <p className="text-sm text-ink-3">Every market is at or above forecast.</p>
            )}
          </Panel>
        )}
      </Grid>
    </>
  );
}

function Access({ data, keep, multiProduct }: { data: DashboardData; keep: Keep; multiProduct: boolean }) {
  const rows = data.business.marketAccess.filter((r) => keep(r.product, r.market));
  if (rows.length === 0) return <Empty />;
  const listed = rows.filter((r) => r.reimbursement === "listed").length;
  const label = (r: (typeof rows)[number]) => (multiProduct ? `${r.product} · ${r.market}` : r.market);
  const lowest = [...rows].sort((a, b) => a.coveragePct - b.coveragePct)[0];
  return (
    <>
      <Tiles>
        <Tile label="Listed for reimbursement" value={`${listed} of ${rows.length}`} />
        <Tile
          label="Not yet listed"
          value={int(rows.length - listed)}
          tone={rows.length - listed ? "warn" : "good"}
          status={rows.length - listed ? "Open decisions" : "All listed"}
        />
        <Tile label="Improving trend" value={int(rows.filter((r) => r.trend === "improving").length)} />
        <Tile
          label="Lowest coverage"
          value={pct(lowest.coveragePct)}
          tone={lowest.coveragePct < 50 ? "bad" : "neutral"}
          status={label(lowest)}
        />
      </Tiles>
      <Grid>
        <Panel title="Coverage" note="% per product and market, never averaged">
          <BreakdownChart
            data={rows
              .map((r) => ({ name: label(r), value: r.coveragePct }))
              .sort((a, b) => b.value - a.value)
              .slice(0, 10)}
            format={(v) => pct(v)}
            label="Coverage"
            labelWidth={140}
          />
        </Panel>
        <Panel title="Reimbursement status" note="product-markets">
          <BreakdownChart
            data={counts(rows, (r) => r.reimbursement)}
            format={int}
            label="Product-markets"
            labelWidth={120}
          />
        </Panel>
      </Grid>
    </>
  );
}

function Supply({ data, keep, multiProduct }: { data: DashboardData; keep: Keep; multiProduct: boolean }) {
  const rows = data.business.supply.filter((r) => keep(r.product, r.market));
  if (rows.length === 0) return <Empty />;
  const risk = (s: string) => rows.filter((r) => r.risk === s).length;
  const label = (r: (typeof rows)[number]) => (multiProduct ? `${r.product} · ${r.market}` : r.market);
  const lowest = (k: "otifPct" | "inventoryWeeks") =>
    rows
      .map((r) => ({ name: label(r), value: Number(r[k]) }))
      .sort((a, b) => a.value - b.value)
      .slice(0, 8);
  return (
    <>
      <Tiles>
        <Tile label="Supply risk · red" value={int(risk("red"))} tone="bad" status="Red" />
        <Tile label="Supply risk · amber" value={int(risk("amber"))} tone="warn" status="Amber" />
        <Tile label="Supply risk · green" value={int(risk("green"))} tone="good" status="Green" />
        <Tile
          label="Lowest OTIF"
          value={pct(Math.min(...rows.map((r) => Number(r.otifPct))))}
          status="on time, in full"
        />
      </Tiles>
      <Grid>
        <Panel title="Lowest OTIF" note="% on time, in full">
          <BreakdownChart data={lowest("otifPct")} format={(v) => pct(v)} label="OTIF" labelWidth={140} />
        </Panel>
        <Panel title="Lowest inventory cover" note="weeks">
          <BreakdownChart
            data={lowest("inventoryWeeks")}
            format={(v) => `${v.toFixed(1)} wk`}
            label="Inventory"
            labelWidth={140}
          />
        </Panel>
      </Grid>
    </>
  );
}

function Launch({ data, keep }: { data: DashboardData; keep: Keep }) {
  const rows = data.business.milestones.filter((r) => keep(r.product, r.market));
  if (rows.length === 0) return <Empty />;
  const by = (s: string) => rows.filter((r) => r.status === s).length;
  const open = rows.filter((r) => r.status !== "completed");
  return (
    <>
      <Tiles>
        <Tile label="Completed" value={int(by("completed"))} tone="good" status="Done" />
        <Tile label="In progress" value={int(by("in_progress"))} />
        <Tile label="Planned" value={int(by("planned"))} />
        <Tile
          label="Open, high impact"
          value={int(open.filter((r) => r.impact === "high").length)}
          tone={open.some((r) => r.impact === "high") ? "warn" : "good"}
          status="In progress or planned"
        />
      </Tiles>
      <Grid>
        <Panel title="Milestones by type" note="count">
          <BreakdownChart data={counts(rows, (r) => r.type)} format={int} label="Milestones" labelWidth={160} />
        </Panel>
        <Panel title="Open milestones" note="by date">
          <ul className="divide-y divide-line text-xs">
            {open.slice(0, 8).map((r) => (
              <li key={r.id} className="flex justify-between gap-3 px-2 py-1.5">
                <span>
                  <span className="font-medium">{r.product}</span> · {r.market} · {r.type.replaceAll("_", " ")}
                </span>
                <span className="tabular shrink-0 text-ink-3">
                  {formatDate(r.date)} · {r.status.replaceAll("_", " ")}
                </span>
              </li>
            ))}
            {open.length === 0 && <li className="px-2 py-2 text-ink-3">None open.</li>}
          </ul>
        </Panel>
      </Grid>
    </>
  );
}

// BI Governance dashboards track the analytics estate itself, so their figures
// come from catalog metadata in their scope, not from business facts.
function Governance({ asset, data }: { asset: AssetSummary; data: DashboardData }) {
  const keep = scopeFilter(asset, data);
  const assets = data.assets.filter((a) => a.origin === "pack" && keepAsset(a, asset, keep));
  const open = assets.flatMap((a) => a.signals).filter((s) => s.status === "open");
  return (
    <>
      <Tiles>
        <Tile label="Dashboards in scope" value={int(assets.length)} />
        <Tile label="Certified" value={int(assets.filter((a) => a.tier === "certified").length)} />
        <Tile
          label="Owner missing or inactive"
          value={int(assets.filter((a) => !a.ownerActive).length)}
          tone={assets.some((a) => !a.ownerActive) ? "warn" : "good"}
          status="Ownership"
        />
        <Tile
          label="Open governance signals"
          value={int(open.length)}
          tone={open.length ? "warn" : "good"}
          status="Signals"
        />
      </Tiles>
      <Grid>
        <Panel title="Open signals" note="Governance_Signals">
          <BreakdownChart
            data={counts(open, (s) => s.code.toLowerCase())}
            format={int}
            label="Signals"
            labelWidth={170}
          />
        </Panel>
        <Panel title="Dashboards by platform" note="Analytics_Assets">
          <BreakdownChart
            data={counts(assets, (a) => `${a.platform} · ${a.type}`)}
            format={int}
            label="Assets"
            labelWidth={150}
          />
        </Panel>
      </Grid>
    </>
  );
}

function keepAsset(a: AssetSummary, scope: AssetSummary, keep: Keep) {
  if (scope.productScope !== "All Pharma" && a.productScope !== scope.productScope && a.productScope !== "All Pharma")
    return false;
  return (
    a.marketScope === "Global" ||
    keep(scope.productScope === "All Pharma" ? a.productScope : scope.productScope, a.marketScope)
  );
}

// ---------- layout pieces ----------

const TONE = {
  neutral: "bg-surface text-ink",
  good: "bg-[#e3f2d2] text-[#2f5a07]",
  warn: "bg-[#fbe6c8] text-[#7a4100]",
  bad: "bg-[#f8d9da] text-[#8a1b20]",
};

export function Tiles({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

export function Tile({
  label,
  value,
  tone = "neutral",
  status,
}: {
  label: string;
  value: string;
  tone?: keyof typeof TONE;
  status?: string;
}) {
  return (
    <div className={`rounded-sm border border-line px-5 py-4 ${TONE[tone]}`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="tabular mt-1 text-[32px] font-semibold leading-none tracking-tight">{value}</div>
      {status && <div className="mt-2 truncate text-xs font-semibold">{status}</div>}
    </div>
  );
}

export function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 lg:grid-cols-2">{children}</div>;
}

export function Panel({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-line bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[11px] text-ink-3">{note}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text?: string }) {
  return (
    <div className="rounded-sm border border-line bg-surface p-6 text-sm text-ink-2">
      {text ?? "The pack has no business rows for this dashboard's product and market."}
    </div>
  );
}

function group<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

function counts<T>(xs: T[], key: (x: T) => string) {
  return [...group(xs, key).entries()]
    .map(([name, v]) => ({ name: name.replaceAll("_", " "), value: v.length }))
    .sort((a, b) => b.value - a.value);
}

const round = (v: number) => Math.round(v * 100) / 100;

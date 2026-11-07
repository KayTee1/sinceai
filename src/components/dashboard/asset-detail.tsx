"use client";

import { useMemo } from "react";
import type { AssetSummary, DashboardData, Role } from "@/lib/types";
import { eurM, formatDate, formatMonth, leaseLabel, pct } from "@/lib/format";
import { TierBadge } from "./tier-badge";
import { BreakdownChart, SalesTrendChart, UsageChart } from "./charts";
import { Timeline } from "../lifecycle/timeline";
import { InsightBody } from "./insight-body";

export function AssetDetail({ asset, data, role }: { asset: AssetSummary; data: DashboardData; role: Role }) {
  const view = useMemo(() => buildView(asset, data), [asset, data]);

  return (
    <div className="mx-auto max-w-[1180px] space-y-5 p-6">
      <header className="space-y-2">
        <div className="text-xs text-ink-3">
          {asset.workspace} / {asset.type} · {asset.platform}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{asset.name}</h1>
          <TierBadge tier={asset.tier} />
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <Meta label="ID" value={asset.id} />
          <Meta label="Scope" value={`${asset.productScope} · ${view.marketLabel}`} />
          <Meta
            label="Owner"
            value={asset.ownerName ? `${asset.ownerName}${asset.ownerActive ? "" : " (inactive)"}` : "Missing"}
            warn={!asset.ownerActive}
          />
          <Meta
            label="Lifecycle"
            value={leaseLabel(asset.status, asset.leaseEnd, asset.tier)}
            warn={asset.status !== "active"}
          />
          <Meta label="Last modified" value={formatDate(asset.lastModified)} />
          {role === "manager" && (
            <Meta label="Source status" value={`${asset.endorsement} · ${asset.lifecycleStatus.replace("_", " ")}`} />
          )}
        </dl>
      </header>

      <p className="flex items-center gap-2 rounded-sm border border-line bg-surface px-3 py-2 text-xs text-ink-2">
        <span className="h-1.5 w-1.5 rounded-full bg-sky" aria-hidden />
        {asset.origin === "app"
          ? "Temporary insight built by Analytics Steward from certified KPIs. Expires after 30 days unless used again."
          : `Synthetic challenge data from the Bayer builder pack (${view.periodLabel}). Not actual Bayer performance.`}
      </p>

      {role === "manager" && <Timeline assetId={asset.id} />}

      {asset.origin === "app" ? (
        <InsightBody insight={data.insights[asset.id]} />
      ) : view.rows === 0 ? (
        <div className="rounded-sm border border-line bg-surface p-6 text-sm text-ink-2">
          No product-market data recorded for this scope.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line bg-line lg:grid-cols-4">
            <Stat label="Net sales" value={eurM(view.netSales)} note={view.periodLabel} />
            <Stat
              label="vs. forecast"
              value={`${view.variance >= 0 ? "+" : ""}${pct(view.variance)}`}
              note={`Forecast ${eurM(view.forecast)}`}
            />
            <Stat label="Market access coverage" value={pct(view.coverage)} note="Average across scope" />
            <Stat label="OTIF" value={pct(view.otif)} note="On time, in full · average" />
          </div>

          <Card title="Net sales vs. forecast" subtitle="€ millions per month">
            <SalesTrendChart data={view.monthly} />
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            {view.breakdown && (
              <Card title={`Net sales by ${view.breakdown.by}`} subtitle={`€ millions, ${view.periodLabel}`}>
                <BreakdownChart data={view.breakdown.items} />
              </Card>
            )}
            <Card title="Dashboard usage" subtitle="Views per month · from the catalog's usage log">
              <UsageChart
                data={asset.monthlyViews.map((u) => ({ month: formatMonth(u.month), views: u.views, users: u.users }))}
              />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function buildView(asset: AssetSummary, data: DashboardData) {
  const allProducts = asset.productScope === "All Pharma";
  const allMarkets = asset.marketScope === "Global";
  const scoped = data.productMarket.filter(
    (r) => (allProducts || r.product === asset.productScope) && (allMarkets || r.market === asset.marketScope),
  );

  const byMonth = new Map<string, { month: string; netSales: number; forecast: number }>();
  let netSales = 0;
  let forecast = 0;
  let coverage = 0;
  let otif = 0;
  for (const r of scoped) {
    const m = byMonth.get(r.month) ?? { month: r.month, netSales: 0, forecast: 0 };
    m.netSales += r.netSales;
    m.forecast += r.forecast;
    byMonth.set(r.month, m);
    netSales += r.netSales;
    forecast += r.forecast;
    coverage += r.coverage;
    otif += r.otif;
  }
  const monthly = [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({ month: formatMonth(m.month), netSales: round(m.netSales), forecast: round(m.forecast) }));

  const marketName = new Map(data.markets.map((m) => [m.id, m.name]));
  let breakdown: { by: string; items: { name: string; value: number }[] } | null = null;
  if (allMarkets || allProducts) {
    const key = allMarkets
      ? (r: (typeof scoped)[number]) => marketName.get(r.market) ?? r.market
      : (r: (typeof scoped)[number]) => r.product;
    const totals = new Map<string, number>();
    for (const r of scoped) totals.set(key(r), (totals.get(key(r)) ?? 0) + r.netSales);
    breakdown = {
      by: allMarkets ? "market" : "product",
      items: [...totals.entries()]
        .map(([name, value]) => ({ name, value: round(value) }))
        .sort((a, b) => b.value - a.value),
    };
  }

  const months = [...byMonth.keys()].sort();
  const periodLabel = months.length
    ? `${formatMonth(months[0])}–${formatMonth(months[months.length - 1])} ${months[0].slice(0, 4)}`
    : "no period";

  return {
    rows: scoped.length,
    netSales,
    forecast,
    variance: forecast ? ((netSales - forecast) / forecast) * 100 : 0,
    coverage: scoped.length ? coverage / scoped.length : 0,
    otif: scoped.length ? otif / scoped.length : 0,
    monthly,
    breakdown,
    periodLabel,
    marketLabel: allMarkets ? "Global" : (marketName.get(asset.marketScope) ?? asset.marketScope),
  };
}

const round = (v: number) => Math.round(v * 100) / 100;

function Meta({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-ink-3">{label}</dt>
      <dd className={`font-medium ${warn ? "text-warn" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <div className="label">{label}</div>
      <div className="tabular mt-1 text-[26px] font-semibold leading-tight tracking-tight">{value}</div>
      <div className="mt-0.5 text-xs text-ink-3">{note}</div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-line bg-surface">
      <div className="flex items-baseline justify-between border-b border-line px-5 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-ink-3">{subtitle}</span>
      </div>
      <div className="px-3 pb-3 pt-4">{children}</div>
    </div>
  );
}

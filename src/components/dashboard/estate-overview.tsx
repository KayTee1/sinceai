"use client";

import type { AssetSummary, DashboardData } from "@/lib/types";
import { int } from "@/lib/format";
import { BreakdownChart } from "./charts";
import { Card, Note, Stat, StatRow } from "./ui";

// Analytics estate overview (Manager): the existing analytics landscape from
// metadata only — Analytics_Assets, Asset_Usage, Asset_KPI_Map, KPI_Catalog,
// Semantic_Models, Governance_Signals. No business performance figures.

const LOW_USERS = 10; // same threshold as the lease review (policy.ts)

function count<T>(items: T[], key: (t: T) => string) {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return [...m.entries()]
    .map(([name, value]) => ({ name: name.replaceAll("_", " "), value }))
    .sort((a, b) => b.value - a.value);
}

function avgRecentUsers(a: AssetSummary): number {
  const last = a.monthlyViews.slice(-3);
  return last.length ? last.reduce((s, u) => s + u.users, 0) / last.length : 0;
}

export function EstateOverview({ data }: { data: DashboardData }) {
  const assets = data.assets.filter((a) => a.origin === "pack");
  const models = Object.values(data.estate.models);
  const signals = assets.flatMap((a) => a.signals);
  const open = signals.filter((s) => s.status === "open");
  const low = assets.filter((a) => avgRecentUsers(a) < LOW_USERS);

  // Duplication: several assets on the same product × market scope.
  const scopes = count(assets, (a) => `${a.productScope} · ${a.marketScope}`).filter((s) => s.value > 1);
  // KPI variants: canonical metrics with more than one catalog definition.
  const byMetric = new Map<string, { total: number; unapproved: number }>();
  for (const k of data.estate.kpiCatalog) {
    const m = byMetric.get(k.canonicalMetric) ?? { total: 0, unapproved: 0 };
    m.total++;
    if (k.approvalStatus !== "approved" || k.definitionStatus !== "canonical") m.unapproved++;
    byMetric.set(k.canonicalMetric, m);
  }
  const variants = [...byMetric.entries()]
    .filter(([, v]) => v.total > 1)
    .map(([name, v]) => ({ name, value: v.total }))
    .sort((a, b) => b.value - a.value);
  const conflicting = [...byMetric.values()].filter((v) => v.total > 1 && v.unapproved > 0).length;

  return (
    <div className="mx-auto max-w-[1180px] space-y-5 p-6">
      <header className="space-y-1">
        <div className="text-xs text-ink-3">Analytics estate</div>
        <h1 className="text-2xl font-semibold tracking-tight">Estate overview</h1>
      </header>
      <Note>
        Metadata about the existing analytics products in the Bayer pack (synthetic): what exists, who uses it, where it
        duplicates and how governed it is. No business performance figures.
      </Note>

      <StatRow>
        <Stat label="Analytics assets" value={int(assets.length)} note={`${int(models.length)} semantic models`} />
        <Stat label="Low usage" value={int(low.length)} note={`< ${LOW_USERS} users/month, last 3 months`} />
        <Stat label="Duplicated scopes" value={int(scopes.length)} note="product × market with 2+ assets" />
        <Stat label="Open governance signals" value={int(open.length)} note={`${int(signals.length)} in total`} />
      </StatRow>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Assets by platform and type" subtitle="Analytics_Assets">
          <BreakdownChart
            data={count(assets, (a) => `${a.platform} · ${a.type}`)}
            format={int}
            labelWidth={190}
            label="Assets"
          />
        </Card>
        <Card title="Bayer lifecycle status" subtitle="Analytics_Assets · source field">
          <BreakdownChart data={count(assets, (a) => a.lifecycleStatus)} format={int} labelWidth={190} label="Assets" />
        </Card>
        <Card title="Most duplicated scopes" subtitle="assets per product × market · top 10">
          <BreakdownChart data={scopes.slice(0, 10)} format={int} labelWidth={190} label="Assets" />
        </Card>
        <Card
          title="KPI definitions per metric"
          subtitle={`KPI_Catalog · ${conflicting} metrics with unapproved variants`}
        >
          <BreakdownChart data={variants.slice(0, 10)} format={int} labelWidth={190} label="Definitions" />
        </Card>
        <Card title="Open governance signals" subtitle="Governance_Signals">
          <BreakdownChart
            data={count(open, (s) => `${s.code.toLowerCase()} (${s.severity})`)}
            format={int}
            labelWidth={190}
            label="Signals"
          />
        </Card>
        <Card title="Semantic model health" subtitle="Semantic_Models · refresh × AI readiness">
          <BreakdownChart
            data={count(models, (m) => `refresh ${m.refreshStatus} · AI ${m.aiReadiness}`)}
            format={int}
            labelWidth={190}
            label="Models"
          />
        </Card>
      </div>
    </div>
  );
}

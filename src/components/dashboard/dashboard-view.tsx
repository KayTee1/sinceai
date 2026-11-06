"use client";

import { useMemo, useState } from "react";
import type { AssetSummary, DashboardData, Role, Tier } from "@/lib/types";
import { formatDate, int } from "@/lib/format";
import { TierBadge } from "./tier-badge";
import { AssetDetail } from "./asset-detail";

const FILTERS: { id: Tier | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "certified", label: "Certified" },
  { id: "team", label: "Team" },
  { id: "personal", label: "Personal" },
];

export function DashboardView({ data, role }: { data: DashboardData; role: Role }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Tier | "all">("all");
  const [selectedId, setSelectedId] = useState(data.assets[0]?.id);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.assets.filter(
      (a) =>
        (filter === "all" || a.tier === filter) &&
        (!q || `${a.name} ${a.productScope} ${a.marketScope} ${a.id}`.toLowerCase().includes(q)),
    );
  }, [data.assets, query, filter]);

  const selected = data.assets.find((a) => a.id === selectedId) ?? visible[0];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {role === "manager" && <PortfolioStrip assets={data.assets} />}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[340px] shrink-0 flex-col border-r border-line bg-surface">
          <div className="space-y-3 border-b border-line p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Dashboards</h2>
              <span className="tabular text-xs text-ink-3">
                {visible.length} of {data.assets.length}
              </span>
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, product, market or ID"
              className="w-full rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm placeholder:text-ink-3 focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20"
            />
            <div className="flex gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
                    filter === f.id ? "bg-navy text-white" : "text-ink-2 hover:bg-canvas"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {visible.map((a) => (
              <AssetRow key={a.id} asset={a} active={a.id === selected?.id} onSelect={() => setSelectedId(a.id)} />
            ))}
            {visible.length === 0 && <li className="p-4 text-sm text-ink-3">No dashboards match.</li>}
          </ul>
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto">
          {selected ? (
            <AssetDetail key={selected.id} asset={selected} data={data} role={role} />
          ) : (
            <div className="p-8 text-sm text-ink-3">Select a dashboard.</div>
          )}
        </section>
      </div>
    </div>
  );
}

function AssetRow({ asset, active, onSelect }: { asset: AssetSummary; active: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`block w-full border-b border-line border-l-[3px] px-4 py-3 text-left transition-colors ${
          active ? "border-l-blue bg-[#eef6fb]" : "border-l-transparent hover:bg-canvas"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium leading-snug">{asset.name}</span>
          <TierBadge tier={asset.tier} />
        </div>
        <div className="mt-1 text-xs text-ink-3">
          {asset.productScope} · {asset.marketScope} · {asset.type}
        </div>
        <div className="mt-0.5 flex justify-between text-xs text-ink-3">
          <span className={asset.ownerActive ? "" : "text-warn"}>
            {asset.ownerName ?? "No owner"}
            {!asset.ownerActive && asset.ownerName ? " (inactive)" : ""}
          </span>
          <span className="tabular">Lease {formatDate(asset.leaseEnd)}</span>
        </div>
      </button>
    </li>
  );
}

function PortfolioStrip({ assets }: { assets: AssetSummary[] }) {
  const count = (fn: (a: AssetSummary) => boolean) => assets.filter(fn).length;
  const items = [
    { label: "Assets in catalog", value: assets.length },
    { label: "Certified", value: count((a) => a.tier === "certified") },
    { label: "Team", value: count((a) => a.tier === "team") },
    { label: "Personal", value: count((a) => a.tier === "personal") },
    { label: "Flagged retire (source)", value: count((a) => a.lifecycleStatus === "candidate_retire") },
    { label: "Owner inactive or missing", value: count((a) => !a.ownerActive) },
  ];
  return (
    <div className="flex shrink-0 divide-x divide-line border-b border-line bg-surface">
      <div className="flex items-center px-5">
        <span className="label">Portfolio</span>
      </div>
      {items.map((i) => (
        <div key={i.label} className="px-5 py-2.5">
          <div className="tabular text-lg font-semibold leading-tight">{int(i.value)}</div>
          <div className="text-[11px] text-ink-3">{i.label}</div>
        </div>
      ))}
    </div>
  );
}

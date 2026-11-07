"use client";

import { useMemo, useState } from "react";
import type { AssetSummary, DashboardData, Role, Tier } from "@/lib/types";
import { int, leaseLabel } from "@/lib/format";
import { TierBadge } from "./tier-badge";
import { useLifecycle } from "../lifecycle/lifecycle-context";
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
  const { logOpen } = useLifecycle();

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
      {role === "manager" && <BeforeAfter />}
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
              <AssetRow
                key={a.id}
                asset={a}
                active={a.id === selected?.id}
                onSelect={() => {
                  setSelectedId(a.id);
                  // Only employee opens are logged, so manager browsing does not inflate usage.
                  if (role === "employee" && a.id !== selected?.id) logOpen(a.id);
                }}
              />
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
          <span className={`tabular ${asset.status === "active" ? "" : "font-medium text-warn"}`}>
            {leaseLabel(asset.status, asset.leaseEnd)}
          </span>
        </div>
      </button>
    </li>
  );
}

function BeforeAfter() {
  const { data } = useLifecycle();
  if (!data) return <div className="h-[58px] shrink-0 border-b border-line bg-surface" />;
  const { before, now, changes } = data.portfolio;
  const rows: { label: string; key: keyof typeof now }[] = [
    { label: "Certified", key: "certified" },
    { label: "Team", key: "team" },
    { label: "Personal", key: "personal" },
    { label: "Temporary", key: "temporary" },
    { label: "Archived", key: "archived" },
    { label: "Under review", key: "underReview" },
  ];
  const active = (c: typeof now) => c.certified + c.team + c.personal + c.temporary;
  const applied = (Object.entries(changes) as [string, number][]).filter(([, n]) => n > 0);

  return (
    <div className="flex shrink-0 items-stretch divide-x divide-line border-b border-line bg-surface">
      <div className="flex flex-col justify-center px-5">
        <span className="label">Since reset</span>
        <span className="text-[11px] text-ink-3">before → now</span>
      </div>
      <Delta label="Active assets" from={active(before)} to={active(now)} />
      {rows.map((r) => (
        <Delta key={r.key} label={r.label} from={before[r.key]} to={now[r.key]} />
      ))}
      <div className="flex min-w-0 flex-1 flex-col justify-center px-5 text-[11px] text-ink-3">
        <span className="label">Applied changes</span>
        <span className="truncate">
          {applied.length ? applied.map(([k, n]) => `${n} ${k}`).join(" · ") : "None yet. Advance the clock."}
        </span>
      </div>
    </div>
  );
}

function Delta({ label, from, to }: { label: string; from: number; to: number }) {
  const d = to - from;
  return (
    <div className="px-4 py-2.5">
      <div className="tabular flex items-baseline gap-1.5 leading-tight">
        <span className="text-lg font-semibold">{int(to)}</span>
        {d !== 0 && (
          <span className="text-xs font-medium text-ink-2">
            {d > 0 ? "+" : "−"}
            {int(Math.abs(d))}
          </span>
        )}
      </div>
      <div className="text-[11px] text-ink-3">
        {label} <span className="tabular">(was {int(from)})</span>
      </div>
    </div>
  );
}

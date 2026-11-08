"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetSummary, DashboardData, Role } from "@/lib/types";
import { formatDate, formatMonthYear, int, leaseLabel, olderThan } from "@/lib/format";
import { TierBadge } from "./tier-badge";
import { InsightBody } from "./insight-body";
import { DomainBoard } from "./wallboard";
import { useLifecycle } from "../lifecycle/lifecycle-context";

// "My team's dashboards" (D22): employees pick (or inherit) a team and see the
// real catalog dashboards for it, rendered as glanceable wallboards. Every
// employee open is a view of that real dashboard and feeds its lease review.

export const DOMAINS = ["Commercial", "Finance", "Market Access", "Supply Chain", "Launch Excellence", "BI Governance"];
export const REGIONS = ["EMEA", "North America", "Asia Pacific", "Latin America", "Global"];

/** Team domain for a pack owner role (our mapping, D22). */
export function domainForRole(role: string | undefined): string {
  if (!role) return "Commercial";
  if (role.startsWith("Commercial")) return "Commercial";
  if (role.startsWith("Finance")) return "Finance";
  if (role.startsWith("Market Access")) return "Market Access";
  if (role.startsWith("Supply")) return "Supply Chain";
  if (role.startsWith("Launch")) return "Launch Excellence";
  return "BI Governance"; // platform, model, data product owners, stewards, reporting
}

export function teamDashboards(assets: AssetSummary[], domain: string, region: string) {
  return assets.filter(
    (a) =>
      a.origin === "pack" &&
      a.status !== "archived" &&
      a.domain === domain &&
      (a.region === region || a.region === "Global"),
  );
}

export function MyDashboards({ data, role }: { data: DashboardData; role: Role }) {
  const { data: lc, viewer, logOpen } = useLifecycle();
  const person = viewer ? lc?.people[viewer] : undefined;
  // A manual team choice applies to the current viewer only.
  const [override, setOverride] = useState<{ viewer: string; domain: string; region: string } | null>(null);
  const team =
    override && override.viewer === viewer
      ? override
      : { viewer, domain: domainForRole(person?.role), region: person?.region ?? "EMEA" };

  const list = useMemo(
    () => teamDashboards(data.assets, team.domain, team.region),
    [data.assets, team.domain, team.region],
  );
  const built = data.assets.filter((a) => a.origin === "app");
  const [picked, setPicked] = useState<string | null>(null);
  const all = [...list, ...built];
  const selected = all.find((a) => a.id === picked) ?? list[0] ?? built[0];

  // One view per dashboard and viewer; manager browsing is not counted.
  const lastLogged = useRef("");
  useEffect(() => {
    if (role !== "employee" || !viewer || !selected) return;
    const key = `${selected.id}|${viewer}`;
    if (lastLogged.current === key) return;
    lastLogged.current = key;
    logOpen(selected.id);
  }, [selected, role, viewer, logOpen]);

  const setTeam = (patch: Partial<{ domain: string; region: string }>) => {
    setOverride({ viewer, domain: team.domain, region: team.region, ...patch });
    setPicked(null);
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[290px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="space-y-2 border-b border-line p-4">
          <div className="label">Your team</div>
          <div className="flex gap-2 text-xs">
            <select
              value={team.domain}
              onChange={(e) => setTeam({ domain: e.target.value })}
              className="min-w-0 flex-1 rounded-sm border border-line-strong bg-surface px-2 py-1.5"
            >
              {DOMAINS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <select
              value={team.region}
              onChange={(e) => setTeam({ region: e.target.value })}
              className="min-w-0 flex-1 rounded-sm border border-line-strong bg-surface px-2 py-1.5"
            >
              {REGIONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>
          {person && !override && (
            <p className="text-[11px] text-ink-3">
              From {person.name}&apos;s role ({person.role}, {person.region}).
            </p>
          )}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          <li className="label px-4 pb-1 pt-3">
            {list.length} dashboards for {team.domain} · {team.region}
          </li>
          {list.map((a) => (
            <Item key={a.id} asset={a} active={a.id === selected?.id} onClick={() => setPicked(a.id)} />
          ))}
          {list.length === 0 && <li className="px-4 py-3 text-xs text-ink-3">No dashboards for this team.</li>}
          {built.length > 0 && (
            <>
              <li className="label mt-2 border-t border-line px-4 pb-1 pt-3">Built insights</li>
              {built.map((a) => (
                <Item key={a.id} asset={a} active={a.id === selected?.id} onClick={() => setPicked(a.id)} />
              ))}
            </>
          )}
        </ul>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto bg-canvas">
        {selected ? (
          <Board asset={selected} data={data} role={role} />
        ) : (
          <div className="p-8 text-sm text-ink-3">Pick a dashboard.</div>
        )}
      </section>
    </div>
  );
}

function Board({ asset, data, role }: { asset: AssetSummary; data: DashboardData; role: Role }) {
  const app = asset.origin === "app";
  return (
    <div className="flex min-h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-4 rounded-sm bg-navy px-5 py-3 text-white">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.12em] text-white/60">
            {app ? "Built insight" : `${asset.domain ?? "Dashboard"} · ${asset.productScope} · ${asset.marketScope}`}
          </div>
          <h1 className="truncate text-xl font-semibold tracking-tight">{asset.name}</h1>
        </div>
        <div className="shrink-0 rounded-sm bg-white px-1 py-0.5">
          <TierBadge tier={asset.tier} />
        </div>
      </div>

      {!app && <KpiChips asset={asset} />}
      {role === "manager" && <Views asset={asset} />}

      {app ? <InsightBody insight={data.insights[asset.id]} /> : <DomainBoard asset={asset} data={data} />}

      <p className="mt-auto text-[11px] text-ink-3">
        {app
          ? "Temporary insight built by Bonsai from certified KPIs. Synthetic challenge data."
          : `View built from this dashboard's catalog KPIs on the pack's facts for its product and market; layout is ours, the report itself lives in ${asset.platform}. Synthetic challenge data, not actual Bayer performance.`}
      </p>
    </div>
  );
}

// Which KPIs this dashboard uses; unapproved variants are flagged so readers know.
function KpiChips({ asset }: { asset: AssetSummary }) {
  const primary = asset.kpis.filter((k) => k.role === "primary");
  if (primary.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="text-ink-3">KPIs</span>
      {primary.map((k) => {
        const ok = k.approvalStatus === "approved" && k.definitionStatus === "canonical";
        return (
          <span
            key={k.id}
            title={`${k.id} · ${k.definitionStatus} · ${k.approvalStatus}`}
            className={`rounded-full border px-2 py-0.5 ${ok ? "border-line-strong bg-surface text-ink-2" : "border-warn/40 bg-[#fdf3e6] text-warn"}`}
          >
            {k.name}
            {ok ? "" : " · not the approved definition"}
          </span>
        );
      })}
    </div>
  );
}

function Views({ asset }: { asset: AssetSummary }) {
  const { data } = useLifecycle();
  const u = data?.appUsage[asset.id];
  const recent = asset.monthlyViews.slice(-3);
  const packUsers = recent.length ? Math.round(recent.reduce((s, m) => s + m.users, 0) / recent.length) : null;
  const lastMonth = recent.at(-1)?.month;
  const stale = lastMonth && data ? olderThan(lastMonth, data.clock.date, 90 + 31) : false;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-sm border border-line bg-surface px-5 py-2 text-xs">
      <span className="label">Relevance</span>
      <span>
        <b className="tabular">{int(u?.opens ?? 0)}</b> app views by <b className="tabular">{int(u?.viewers ?? 0)}</b>{" "}
        {u?.viewers === 1 ? "person" : "people"} · <b className="tabular">{int(u?.last30 ?? 0)}</b> in 30 days
      </span>
      {packUsers !== null &&
        (stale ? (
          <span className="text-ink-3">
            Pack telemetry ended {formatMonthYear(lastMonth!)}: only app views count now (D23)
          </span>
        ) : (
          <span>
            <b className="tabular">{int(packUsers)}</b> users/month in pack telemetry (to {formatMonthYear(lastMonth!)})
          </span>
        ))}
      <span className="text-ink-3">
        {u?.lastOpened ? `Last viewed ${formatDate(u.lastOpened)}` : "Not viewed in the app"}
      </span>
      <span className="text-ink-3">{leaseLabel(asset.status, asset.leaseEnd, asset.tier)}</span>
    </div>
  );
}

function Item({ asset, active, onClick }: { asset: AssetSummary; active: boolean; onClick: () => void }) {
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
          <span className="text-sm font-medium leading-snug">{asset.name}</span>
          <TierBadge tier={asset.tier} />
        </div>
        <div className="text-[11px] text-ink-3">
          {asset.productScope} · {asset.marketScope} · {asset.type}
        </div>
      </button>
    </li>
  );
}

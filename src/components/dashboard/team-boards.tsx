"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetSummary, DashboardData, Role } from "@/lib/types";
import { TEAM_DASHBOARDS, type TeamBoardId } from "@/services/lifecycle/team-dashboards";
import { eurM, formatDate, formatMonth, int, leaseLabel, pct } from "@/lib/format";
import { BreakdownChart, SalesTrendChart } from "./charts";
import { InsightBody } from "./insight-body";
import { TierBadge } from "./tier-badge";
import { useLifecycle } from "../lifecycle/lifecycle-context";

// Team dashboards (D20): glanceable wallboards on the pack's business facts.
// Employees see only these; managers also see how often each is viewed.

const ALL = "__all";
const ACTUAL = "actual_like_synthetic"; // D15: one value type per figure, never blended

export function TeamBoards({ data, role }: { data: DashboardData; role: Role }) {
  const built = data.assets.filter((a) => a.origin === "app");
  const [board, setBoard] = useState<string>(TEAM_DASHBOARDS[0].id);
  const { logOpen, viewer } = useLifecycle();

  // Employee opens count as views of that dashboard (manager browsing does not).
  // One view per board selection and viewer, not per data refresh or re-render.
  const lastLogged = useRef("");
  useEffect(() => {
    const key = `${board}|${viewer}`;
    if (role !== "employee" || !viewer || lastLogged.current === key) return;
    lastLogged.current = key;
    logOpen(board);
  }, [board, role, viewer, logOpen]);

  const team = TEAM_DASHBOARDS.find((t) => t.id === board);
  const insight = built.find((b) => b.id === board);

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-[240px] shrink-0 overflow-y-auto border-r border-line bg-surface">
        <div className="label px-4 pb-2 pt-4">Team dashboards</div>
        <ul>
          {TEAM_DASHBOARDS.map((t) => (
            <Nav key={t.id} active={board === t.id} onClick={() => setBoard(t.id)} title={t.title} note={t.team} />
          ))}
        </ul>
        {built.length > 0 && (
          <>
            <div className="label mt-2 border-t border-line px-4 pb-2 pt-4">Built insights</div>
            <ul>
              {built.map((b) => (
                <Nav
                  key={b.id}
                  active={board === b.id}
                  onClick={() => setBoard(b.id)}
                  title={b.name}
                  note={b.id}
                  badge={<TierBadge tier={b.tier} />}
                />
              ))}
            </ul>
          </>
        )}
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto bg-canvas">
        {team ? (
          <Board id={team.id} title={team.title} team={team.team} data={data} role={role} />
        ) : insight ? (
          <div className="mx-auto max-w-[1180px] space-y-5 p-6">
            <h1 className="text-2xl font-semibold tracking-tight">{insight.name}</h1>
            {role === "manager" && <UsageStrip asset={insight} />}
            <InsightBody insight={data.insights[insight.id]} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Board({
  id,
  title,
  team,
  data,
  role,
}: {
  id: TeamBoardId;
  title: string;
  team: string;
  data: DashboardData;
  role: Role;
}) {
  const [product, setProduct] = useState(ALL);
  const latest = useMemo(
    () => data.business.productMarket.reduce((m, r) => (r.month > m ? r.month : m), ""),
    [data.business.productMarket],
  );
  return (
    <div className="flex min-h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between rounded-sm bg-navy px-5 py-3 text-white">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-white/60">{team}</div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-white/60">
            Latest month {latest ? formatMonth(latest) + " " + latest.slice(0, 4) : ""}
          </span>
          <select
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            className="rounded-sm border border-white/20 bg-white/10 px-2 py-1 text-white focus:outline-none"
          >
            <option value={ALL} className="text-ink">
              All products
            </option>
            {data.business.products.map((p) => (
              <option key={p.id} value={p.name} className="text-ink">
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {role === "manager" && <BoardUsage id={id} />}
      {id === "DSH-COMMERCIAL" && <Commercial data={data} product={product} latest={latest} />}
      {id === "DSH-ACCESS" && <Access data={data} product={product} />}
      {id === "DSH-SUPPLY" && <Supply data={data} product={product} />}
      {id === "DSH-LAUNCH" && <Launch data={data} product={product} />}
      <p className="mt-auto text-[11px] text-ink-3">
        Synthetic challenge data from the Bayer pack, shown as our team views. Not actual Bayer performance.
      </p>
    </div>
  );
}

// ---------- boards ----------

function Commercial({ data, product, latest }: { data: DashboardData; product: string; latest: string }) {
  const region = new Map(data.markets.map((m) => [m.id, m.region]));
  const name = new Map(data.markets.map((m) => [m.id, m.name]));
  const rows = data.business.productMarket.filter(
    (r) => r.valueType === ACTUAL && (product === ALL || r.product === product),
  );
  const month = rows.filter((r) => r.month === latest);
  const sum = (xs: typeof rows, k: "netSales" | "forecast") => xs.reduce((s, r) => s + r[k], 0);
  const net = sum(month, "netSales");
  const fc = sum(month, "forecast");
  const behind = month.filter((r) => r.netSales < r.forecast).length;

  const byMonth = group(rows, (r) => r.month);
  const trend = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, xs]) => ({
      month: formatMonth(m),
      netSales: round(sum(xs, "netSales")),
      forecast: round(sum(xs, "forecast")),
    }));
  const totals = (key: (r: (typeof rows)[number]) => string) =>
    [...group(rows, key).entries()]
      .map(([n, xs]) => ({ name: n, value: round(sum(xs, "netSales")) }))
      .sort((a, b) => b.value - a.value);
  // Shortfalls only, as positive amounts below forecast.
  const gap = month
    .filter((r) => r.netSales < r.forecast)
    .map((r) => ({
      name: `${product === ALL ? r.product + " · " : ""}${name.get(r.market) ?? r.market}`,
      value: round(r.forecast - r.netSales),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return (
    <>
      <Tiles>
        <Tile label={`Net sales · ${formatMonth(latest)}`} value={eurM(net)} />
        <Tile
          label="vs. forecast"
          value={`${net >= fc ? "+" : ""}${pct(fc ? ((net - fc) / fc) * 100 : 0)}`}
          tone={net >= fc ? "good" : "warn"}
          status={net >= fc ? "On track" : "Below forecast"}
        />
        <Tile label="Net sales · year to date" value={eurM(sum(rows, "netSales"))} />
        <Tile
          label="Markets below forecast"
          value={`${behind} of ${month.length}`}
          tone={behind ? "warn" : "good"}
          status={behind ? "Needs attention" : "All on track"}
        />
      </Tiles>
      <Grid>
        <Panel title="Net sales vs. forecast" note="€ millions per month">
          <SalesTrendChart data={trend} />
        </Panel>
        <Panel title={product === ALL ? "Net sales by product" : "Net sales by market"} note="€ millions, year to date">
          <BreakdownChart
            data={(product === ALL ? totals((r) => r.product) : totals((r) => name.get(r.market) ?? r.market)).slice(
              0,
              8,
            )}
          />
        </Panel>
        <Panel title="Net sales by region" note="€ millions, year to date">
          <BreakdownChart data={totals((r) => region.get(r.market) ?? r.market)} labelWidth={120} />
        </Panel>
        <Panel title="Furthest below forecast" note={`€ millions · ${formatMonth(latest)}`}>
          <BreakdownChart data={gap} label="Below forecast" labelWidth={170} />
        </Panel>
      </Grid>
    </>
  );
}

function Access({ data, product }: { data: DashboardData; product: string }) {
  const rows = data.business.marketAccess.filter((r) => product === ALL || r.product === product);
  const listed = rows.filter((r) => r.reimbursement === "listed").length;
  const lowest = [...rows].sort((a, b) => a.coveragePct - b.coveragePct)[0];
  const label = (r: (typeof rows)[number]) => (product === ALL ? `${r.product} · ${r.market}` : r.market);
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
          value={lowest ? pct(lowest.coveragePct) : "–"}
          tone={lowest && lowest.coveragePct < 50 ? "bad" : "neutral"}
          status={lowest ? label(lowest) : undefined}
        />
      </Tiles>
      <Grid>
        <Panel title="Highest coverage" note="% per product and market">
          <BreakdownChart
            data={rows
              .map((r) => ({ name: label(r), value: r.coveragePct }))
              .sort((a, b) => b.value - a.value)
              .slice(0, 8)}
            format={(v) => pct(v)}
            label="Coverage"
            labelWidth={140}
          />
        </Panel>
        <Panel title="Lowest coverage" note="% per product and market">
          <BreakdownChart
            data={rows
              .map((r) => ({ name: label(r), value: r.coveragePct }))
              .sort((a, b) => a.value - b.value)
              .slice(0, 8)}
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
        <Panel title="Access trend" note="product-markets">
          <BreakdownChart data={counts(rows, (r) => r.trend)} format={int} label="Product-markets" labelWidth={120} />
        </Panel>
      </Grid>
    </>
  );
}

function Supply({ data, product }: { data: DashboardData; product: string }) {
  const rows = data.business.supply.filter((r) => product === ALL || r.product === product);
  const risk = (s: string) => rows.filter((r) => r.risk === s).length;
  const label = (r: (typeof rows)[number]) => (product === ALL ? `${r.product} · ${r.market}` : r.market);
  const lowest = (k: "otifPct" | "inventoryWeeks" | "forecastAccuracyPct") =>
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
        <Tile label="Product-markets" value={int(rows.length)} />
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
        <Panel title="Lowest forecast accuracy" note="%">
          <BreakdownChart
            data={lowest("forecastAccuracyPct")}
            format={(v) => pct(v)}
            label="Accuracy"
            labelWidth={140}
          />
        </Panel>
        <Panel title="Red risk by transport mode" note="product-markets">
          <BreakdownChart
            data={counts(
              rows.filter((r) => r.risk === "red"),
              (r) => r.mode,
            )}
            format={int}
            label="Red risk"
          />
        </Panel>
      </Grid>
    </>
  );
}

function Launch({ data, product }: { data: DashboardData; product: string }) {
  const rows = data.business.milestones.filter((r) => product === ALL || r.product === product);
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
        <Panel title="Milestones by product" note="count">
          <BreakdownChart data={counts(rows, (r) => r.product)} format={int} label="Milestones" />
        </Panel>
        <Panel title="Open milestones" note="in progress or planned, by date">
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
        <Panel title="Status by impact" note="count">
          <BreakdownChart
            data={counts(rows, (r) => `${r.impact} · ${r.status}`)}
            format={int}
            label="Milestones"
            labelWidth={160}
          />
        </Panel>
      </Grid>
    </>
  );
}

// ---------- manager usage ----------

function BoardUsage({ id }: { id: string }) {
  const { data } = useLifecycle();
  const u = data?.appUsage[id];
  const b = data?.boards[id];
  const owner = b?.ownerId ? data?.people[b.ownerId]?.name : null;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-sm border border-line bg-surface px-5 py-2 text-xs">
      <span className="label">Relevance</span>
      <span>
        <b className="tabular">{int(u?.opens ?? 0)}</b> views by <b className="tabular">{int(u?.viewers ?? 0)}</b>{" "}
        {u?.viewers === 1 ? "person" : "people"}
      </span>
      <span>
        <b className="tabular">{int(u?.last30 ?? 0)}</b> in the last 30 days
      </span>
      <span className="text-ink-3">{u?.lastOpened ? `Last viewed ${formatDate(u.lastOpened)}` : "Not viewed yet"}</span>
      {b && (
        <span className="text-ink-3">
          {leaseLabel(b.status, b.leaseEnd, b.tier)} · owner {owner ?? "missing"}
        </span>
      )}
    </div>
  );
}

function UsageStrip({ asset }: { asset: AssetSummary }) {
  const { data } = useLifecycle();
  const u = data?.appUsage[asset.id];
  return (
    <div className="rounded-sm border border-line bg-surface px-5 py-2 text-xs">
      <b className="tabular">{int(u?.opens ?? 0)}</b> views by <b className="tabular">{int(u?.viewers ?? 0)}</b>{" "}
      {u?.viewers === 1 ? "person" : "people"} · {leaseLabel(asset.status, asset.leaseEnd, asset.tier)}
    </div>
  );
}

// ---------- layout pieces ----------

const TONE = {
  neutral: "bg-surface text-ink",
  good: "bg-[#e3f2d2] text-[#2f5a07]",
  warn: "bg-[#fbe6c8] text-[#7a4100]",
  bad: "bg-[#f8d9da] text-[#8a1b20]",
};

function Tiles({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

function Tile({
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
      {status && <div className="mt-2 text-xs font-semibold">{status}</div>}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 lg:grid-cols-2">{children}</div>;
}

function Panel({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
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

function Nav({
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

// ---------- helpers ----------

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

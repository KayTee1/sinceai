"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { eurM, int } from "@/lib/format";

// Series colours validated for colour-blind separation and contrast on white.
const SERIES_1 = "#0091df";
const SERIES_2 = "#4e8a12";
const GRID = "#e8edf1";
const AXIS = { fontSize: 11, fill: "#6f8592" };

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="mb-2 flex gap-4 px-2 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line
              x1="0"
              y1="3"
              x2="18"
              y2="3"
              stroke={i.color}
              strokeWidth="2"
              strokeDasharray={i.dashed ? "4 3" : undefined}
            />
          </svg>
          {i.label}
        </span>
      ))}
    </div>
  );
}

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-sm border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-semibold text-ink">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 text-ink-2">
          <span className="flex items-center gap-1.5">
            {r.color && <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="tabular font-medium text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

type TrendPoint = { month: string; netSales: number; forecast: number };

export function SalesTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div>
      <Legend
        items={[
          { label: "Net sales", color: SERIES_1 },
          { label: "Forecast", color: SERIES_2, dashed: true },
        ]}
      />
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `€${v}m`} />
            <Tooltip
              cursor={{ stroke: "#c3ced7", strokeWidth: 1 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={String(label)}
                    rows={[
                      { label: "Net sales", value: eurM(Number(payload[0]?.payload.netSales), 2), color: SERIES_1 },
                      { label: "Forecast", value: eurM(Number(payload[0]?.payload.forecast), 2), color: SERIES_2 },
                    ]}
                  />
                ) : null
              }
            />
            <Line
              type="monotone"
              dataKey="netSales"
              stroke={SERIES_1}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }}
            />
            <Line
              type="monotone"
              dataKey="forecast"
              stroke={SERIES_2}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function BreakdownChart({
  data,
  format = (v: number) => eurM(v),
  label = "Net sales",
  labelWidth = 104,
}: {
  data: { name: string; value: number }[];
  format?: (v: number) => string;
  label?: string;
  labelWidth?: number;
}) {
  const height = Math.max(160, data.length * 26 + 16);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap={4}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={labelWidth} />
          <Tooltip
            cursor={{ fill: "#f3f6f8" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <TooltipBox
                  title={String(payload[0].payload.name)}
                  rows={[{ label, value: format(Number(payload[0].value)) }]}
                />
              ) : null
            }
          />
          <Bar dataKey="value" fill={SERIES_1} radius={[0, 4, 4, 0]} maxBarSize={18}>
            <LabelList dataKey="value" position="right" formatter={(v) => format(Number(v))} style={AXIS} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function UsageChart({ data }: { data: { month: string; views: number; users: number }[] }) {
  if (data.length === 0) return <div className="p-4 text-sm text-ink-3">No usage recorded.</div>;
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={6}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => int(Number(v))} />
          <Tooltip
            cursor={{ fill: "#f3f6f8" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipBox
                  title={String(label)}
                  rows={[
                    { label: "Views", value: int(Number(payload[0].payload.views)) },
                    { label: "Unique users", value: int(Number(payload[0].payload.users)) },
                  ]}
                />
              ) : null
            }
          />
          <Bar dataKey="views" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

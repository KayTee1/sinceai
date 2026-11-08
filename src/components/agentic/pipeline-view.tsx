"use client";

// Pipeline view (T23): the Miro page-2 sequence drawn live from the latest
// run's step events. Each arrow is keyed by (step, agent) and takes the
// status of its latest event: grey = not reached, blue = done, amber pulsing
// = waiting for a person, red = failed. The branch not taken is dimmed.
import { useEffect, useState } from "react";
import { Storyboard } from "./storyboard-view";

export type StepStatus = "running" | "done" | "waiting_input" | "waiting_approval" | "failed" | "skipped";
export type StepEvent = { id: number; step: string; agent: string; status: StepStatus; summary: string; evidence: string[]; ts: string };
export type Run = {
  runId: string;
  requestId: string;
  scope: { product: string; market: string } | null;
  path: string | null;
  status: string;
  proposalId: string | null;
  assetId: string | null;
  events: StepEvent[];
};

const LANES = ["Analyst", "Orchestrator", "Discovery agent", "Metadata catalog", "Semantic layer", "Lifecycle engine", "Approver"] as const;
type Lane = (typeof LANES)[number];
const LANE_LABEL: Record<Lane, string> = {
  Analyst: "Analyst",
  Orchestrator: "Orchestrator",
  "Discovery agent": "Discovery",
  "Metadata catalog": "Catalog",
  "Semantic layer": "Semantic layer",
  "Lifecycle engine": "Lifecycle",
  Approver: "Approver",
};

type Arrow = { key: string; from: Lane; to: Lane; label: string; reply?: boolean; branch?: "reuse" | "build" | "clarify" };

const ARROWS: Arrow[] = [
  { key: "intent/Analyst", from: "Analyst", to: "Orchestrator", label: "Question" },
  { key: "intent/Orchestrator", from: "Orchestrator", to: "Orchestrator", label: "Parse intent (metrics, scope)" },
  { key: "clarify/Orchestrator", from: "Orchestrator", to: "Analyst", label: "Which scope is meant?", reply: true, branch: "clarify" },
  { key: "discovery/Orchestrator", from: "Orchestrator", to: "Discovery agent", label: "Find related assets" },
  { key: "discovery/Discovery agent", from: "Discovery agent", to: "Metadata catalog", label: "Hybrid search" },
  { key: "discovery/Metadata catalog", from: "Metadata catalog", to: "Discovery agent", label: "Dashboards, metric definitions", reply: true },
  { key: "conflict/Discovery agent", from: "Discovery agent", to: "Semantic layer", label: "Compare definitions" },
  { key: "conflict/Semantic layer", from: "Semantic layer", to: "Discovery agent", label: "Conflicts", reply: true },
  { key: "duplicate/Discovery agent", from: "Discovery agent", to: "Orchestrator", label: "Candidates + conflict + reasoning", reply: true },
  { key: "recommend/Orchestrator", from: "Orchestrator", to: "Analyst", label: "Suggest reuse, flag conflict", reply: true },
  { key: "confirm_reuse/Analyst", from: "Analyst", to: "Orchestrator", label: "Use certified dashboard", branch: "reuse" },
  { key: "log_reuse/Lifecycle engine", from: "Orchestrator", to: "Lifecycle engine", label: "Log reuse (usage +1)", branch: "reuse" },
  { key: "propose/Orchestrator", from: "Orchestrator", to: "Approver", label: "Request approval to build", branch: "build" },
  { key: "approve/Approver", from: "Approver", to: "Orchestrator", label: "Approved", reply: true, branch: "build" },
  { key: "build/Semantic layer", from: "Orchestrator", to: "Semantic layer", label: "Query certified metrics only", branch: "build" },
  { key: "register/Lifecycle engine", from: "Orchestrator", to: "Lifecycle engine", label: "Register TEMPORARY, TTL 30d", branch: "build" },
  { key: "done/Lifecycle engine", from: "Lifecycle engine", to: "Analyst", label: "Insight link + expiry date", reply: true, branch: "build" },
];

const W = 760;
const LANE_X = (i: number) => 54 + i * ((W - 108) / (LANES.length - 1));
const TOP = 46;
const ROW = 40;

const COLOR: Record<string, string> = {
  pending: "var(--line-strong)",
  done: "var(--blue)",
  running: "var(--sky)",
  waiting_input: "var(--warn)",
  waiting_approval: "var(--warn)",
  failed: "var(--danger)",
  skipped: "var(--line-strong)",
};

function useLatestRun(): Run | null {
  const [run, setRun] = useState<Run | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const res = await fetch("/api/runs/latest", { cache: "no-store" });
        const json = await res.json();
        if (!stop && res.ok) setRun(json.run ?? null);
      } catch {
        // keep the last run on a network blip
      }
      if (!stop) timer = setTimeout(load, document.visibilityState === "visible" ? 800 : 4000);
    };
    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);
  return run;
}

type Mode = "steps" | "diagram";

export function PipelineView() {
  const run = useLatestRun();
  const [mode, setMode] = useState<Mode>("steps");
  if (!run) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-ink-3">
        Run a request in the chat (e.g. &ldquo;Handle business request TEAM-REQ-01&rdquo;) to watch the pipeline here.
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <RunHeader run={run} mode={mode} onMode={setMode} />
      <div className="min-h-0 flex-1 overflow-auto">{mode === "steps" ? <Storyboard run={run} /> : <SequenceDiagram run={run} />}</div>
    </div>
  );
}

function SequenceDiagram({ run }: { run: Run }) {
  const latest = new Map<string, StepEvent>();
  for (const e of run.events) latest.set(`${e.step}/${e.agent}`, e);
  const path = run.path;
  const shown = ARROWS.filter((a) => a.branch !== "clarify" || latest.has(a.key));
  const dimmed = (a: Arrow) =>
    (a.branch === "reuse" && path !== null && path !== "reuse") || (a.branch === "build" && path !== null && path !== "build");

  const height = TOP + shown.length * ROW + 24;
  const reuseStart = shown.findIndex((a) => a.branch === "reuse");
  const buildStart = shown.findIndex((a) => a.branch === "build");

  return (
    <div>
      <div className="px-3 pb-4 pt-2">
        <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={`Pipeline run ${run.runId}`}>
          <defs>
            {Object.entries(COLOR).map(([k, c]) => (
              <marker key={k} id={`arrow-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" fill={c} />
              </marker>
            ))}
          </defs>

          {LANES.map((l, i) => (
            <g key={l}>
              <rect x={LANE_X(i) - 46} y={6} width={92} height={24} rx={4} fill="var(--surface)" stroke="var(--line-strong)" />
              <text x={LANE_X(i)} y={22} textAnchor="middle" fontSize="10.5" fontWeight={600} fill="var(--ink)">
                {LANE_LABEL[l]}
              </text>
              <line x1={LANE_X(i)} x2={LANE_X(i)} y1={30} y2={height - 6} stroke="var(--line)" strokeDasharray="4 4" />
            </g>
          ))}

          {reuseStart >= 0 && <Frame y={TOP + reuseStart * ROW - 12} rows={2} label="Existing asset fits" active={path === "reuse"} />}
          {buildStart >= 0 && <Frame y={TOP + buildStart * ROW - 12} rows={5} label="Nothing fits" active={path === "build"} />}

          {shown.map((a, row) => {
            const e = latest.get(a.key);
            const status = e?.status ?? "pending";
            const y = TOP + row * ROW + 12;
            const x1 = LANE_X(LANES.indexOf(a.from));
            const x2 = LANE_X(LANES.indexOf(a.to));
            const waiting = status === "waiting_input" || status === "waiting_approval";
            const label = e ? e.summary : a.label;
            const opacity = dimmed(a) ? 0.25 : 1;
            const mid = a.from === a.to ? x1 + 70 : (x1 + x2) / 2;
            return (
              <g key={a.key} opacity={opacity} className={waiting ? "pipeline-pulse" : undefined}>
                {a.from === a.to ? (
                  <path
                    d={`M${x1},${y - 6} h26 v12 h-24`}
                    fill="none"
                    stroke={COLOR[status]}
                    strokeWidth={e ? 2 : 1.25}
                    markerEnd={`url(#arrow-${status})`}
                  />
                ) : (
                  <line
                    x1={x1}
                    x2={x2 + (x2 > x1 ? -3 : 3)}
                    y1={y}
                    y2={y}
                    stroke={COLOR[status]}
                    strokeWidth={e ? 2 : 1.25}
                    strokeDasharray={a.reply ? "5 4" : undefined}
                    markerEnd={`url(#arrow-${status})`}
                  />
                )}
                <text
                  x={a.from === a.to ? x1 + 34 : mid}
                  y={y - 6}
                  textAnchor={a.from === a.to ? "start" : "middle"}
                  fontSize="10"
                  fill={e ? (status === "failed" ? "var(--danger)" : waiting ? "var(--warn)" : "var(--ink)") : "var(--ink-3)"}
                  fontWeight={waiting ? 600 : 400}
                >
                  {truncate(label, a.from === a.to ? 70 : Math.max(28, Math.abs(x2 - x1) / 5.4))}
                  <title>{label}</title>
                </text>
              </g>
            );
          })}
        </svg>
        <LifecycleStrip run={run} />
      </div>
    </div>
  );
}

function Frame({ y, rows, label, active }: { y: number; rows: number; label: string; active: boolean }) {
  return (
    <g>
      <rect x={6} y={y} width={W - 12} height={rows * ROW + 4} rx={6} fill="none" stroke={active ? "var(--blue)" : "var(--line-strong)"} strokeDasharray="3 4" />
      <text x={14} y={y + 12} fontSize="9.5" fill={active ? "var(--blue)" : "var(--ink-3)"} fontWeight={600}>
        {label}
      </text>
    </g>
  );
}

function truncate(s: string, n: number) {
  const max = Math.floor(n);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const STATUS_TEXT: Record<string, string> = {
  running: "Running",
  waiting_input: "Waiting for the requester",
  waiting_approval: "Waiting for approval",
  done: "Done",
  failed: "Stopped",
};

function RunHeader({ run, mode, onMode }: { run: Run; mode: Mode; onMode: (m: Mode) => void }) {
  const waiting = run.status === "waiting_input" || run.status === "waiting_approval";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="label">Pipeline</div>
        <div className="truncate text-sm font-semibold text-ink">
          {run.runId} · {run.requestId}
          {run.scope ? <span className="font-normal text-ink-3"> · {run.scope.product} · {run.scope.market}</span> : null}
        </div>
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          run.status === "done"
            ? "bg-[#eef7e4] text-green-deep"
            : run.status === "failed"
              ? "bg-[#fdeeee] text-danger"
              : waiting
                ? "pipeline-pulse bg-[#fdf3e6] text-warn"
                : "bg-[#e6f4fc] text-[#00609a]"
        }`}
      >
        {STATUS_TEXT[run.status] ?? run.status}
      </span>
      <div className="flex shrink-0 rounded-sm border border-line p-0.5">
        {(["steps", "diagram"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onMode(m)}
            className={`rounded-sm px-2 py-0.5 text-[11px] font-medium capitalize ${mode === m ? "bg-navy text-white" : "text-ink-2 hover:bg-canvas"}`}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Page 1 of the board, reduced to the question's first move: reuse a certified asset, or a Temporary build. */
function LifecycleStrip({ run }: { run: Run }) {
  const reuse = run.path === "reuse";
  const build = run.path === "build";
  const finished = run.status === "done";
  const node = (label: string, on: boolean, tone: "good" | "warn" | "plain") => (
    <span
      className={`rounded-full border px-2.5 py-1 text-[11px] ${
        on
          ? tone === "good"
            ? "border-green bg-[#eef7e4] text-green-deep"
            : tone === "warn"
              ? "border-warn bg-[#fdf3e6] text-warn"
              : "border-blue bg-[#e6f4fc] text-[#00609a]"
          : "border-line text-ink-3"
      }`}
    >
      {label}
    </span>
  );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-sm border border-line bg-canvas px-3 py-2 text-ink-3">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide">Lifecycle</span>
      {node("Question asked", true, "plain")}
      <span>→</span>
      {node("Existing asset answers it?", run.path !== null, "plain")}
      <span>→</span>
      {node(reuse && finished ? `Reused ${run.assetId ?? ""}` : "Yes, reuse", reuse, finished ? "good" : "warn")}
      <span>/</span>
      {node(build && finished ? `Temporary ${run.assetId ?? ""} · TTL 30d` : "No: Temporary, TTL 30d", build, finished ? "good" : "warn")}
    </div>
  );
}

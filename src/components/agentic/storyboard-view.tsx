"use client";

// Storyboard (T23, option C): the run as vertical steps that slide in one by
// one, counters that tick up to the real numbers, a human gate that pulses
// while it waits and unlocks on approval, and a result card that pops out at
// the end. Built only from the run's step events. Steps are revealed about
// half a second apart even when they all arrived at once (display pacing
// only); with reduced motion everything shows at once.
import { useEffect, useState } from "react";
import { useLifecycle } from "../lifecycle/lifecycle-context";
import type { Run, StepEvent, StepStatus } from "./pipeline-view";

type Tone = "done" | "active" | "waiting" | "failed";

type Step = {
  key: string;
  who: string;
  title: string;
  detail: React.ReactNode;
  tone: Tone;
  icon?: string;
};

const REVEAL_MS = 550;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Number that ticks up from 0 to `to` once it appears. */
function Counter({ to, instant }: { to: number; instant: boolean }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (instant || to <= 0) return;
    let raf = 0;
    const start = performance.now();
    const dur = Math.min(900, 250 + to * 60);
    const frame = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [to, instant]);
  return <span className="tabular font-bold text-navy">{instant || to <= 0 ? to : v}</span>;
}

function count(e: StepEvent | undefined, name: string): number | null {
  const hit = e?.evidence.find((x) => x.startsWith(`#${name}=`));
  return hit ? Number(hit.split("=")[1]) : null;
}

function value(e: StepEvent | undefined, name: string): string | null {
  const hit = e?.evidence.find((x) => x.startsWith(`#${name}=`));
  return hit ? hit.slice(name.length + 2) : null;
}

const toneOf = (s: StepStatus | undefined): Tone =>
  s === "failed" ? "failed" : s === "waiting_input" || s === "waiting_approval" ? "waiting" : s === "running" ? "active" : "done";

function buildSteps(run: Run, latest: Map<string, StepEvent>, instant: boolean): Step[] {
  const steps: Step[] = [];
  const add = (key: string, who: string, title: string, detail: React.ReactNode, status?: StepStatus, icon?: string) => {
    steps.push({ key, who, title, detail, tone: toneOf(status), icon });
  };
  const ev = (k: string) => latest.get(k);

  const q = ev("intent/Analyst");
  if (q) add("q", "Analyst", "Question", q.summary, q.status);
  const intent = ev("intent/Orchestrator");
  if (intent) add("intent", "Orchestrator", "Parse intent", intent.summary, intent.status);
  const clarify = ev("clarify/Orchestrator");
  if (clarify) add("clarify", "Orchestrator", "Which scope is meant?", clarify.summary, clarify.status, "?");

  const disc = ev("discovery/Metadata catalog");
  if (disc) {
    const d = count(disc, "dashboards");
    const m = count(disc, "definitions");
    add(
      "disc",
      "Discovery agent",
      "Search the catalog",
      <>
        {d !== null && m !== null ? (
          <span className="block">
            Found <Counter to={d} instant={instant} /> dashboards, <Counter to={m} instant={instant} /> metric definitions
          </span>
        ) : null}
        {/* The template line repeats the counters; only an agent-worded finding adds something. */}
        {/^\d+ dashboards, \d+ metric definitions/.test(disc.summary) ? null : <span className="block text-ink-3">{disc.summary}</span>}
      </>,
      disc.status,
    );
  }
  const conf = ev("conflict/Semantic layer");
  if (conf) {
    const c = count(conf, "conflicts");
    add(
      "conf",
      "Conflict detector",
      "Compare definitions",
      <>
        {c !== null ? (
          <span className={`block ${c > 0 ? "text-warn" : ""}`}>
            <Counter to={c} instant={instant} /> conflicting {c === 1 ? "metric" : "metrics"}
          </span>
        ) : null}
        <span className="block text-ink-3">{conf.summary}</span>
      </>,
      conf.status,
    );
  }
  const dup = ev("duplicate/Discovery agent");
  if (dup) {
    const text = dup.summary.replace(/^Candidates \+ conflict \+ reasoning: /, "");
    add("dup", "Discovery agent", "Check the estate", text.charAt(0).toUpperCase() + text.slice(1), dup.status);
  }
  const rec = ev("recommend/Orchestrator");
  if (rec) add("rec", "Orchestrator", "Recommendation", rec.summary, rec.status);

  // The human gate.
  if (run.path === "build") {
    const propose = ev("propose/Orchestrator");
    const approve = ev("approve/Approver");
    if (approve) {
      const icon = approve.status === "done" ? "🔓" : approve.status === "failed" ? "✕" : "🔒";
      add("gate", "Approver", approve.status === "done" ? "Approved" : approve.status === "failed" ? "Rejected" : "Lead approval", approve.summary, approve.status, icon);
    } else if (propose) {
      add("gate", "Requester", "Submit build proposal?", "Press Submit build proposal in the chat", propose.status, "🔒");
    }
    const build = ev("build/Semantic layer");
    if (build) add("build", "Semantic layer", "Query certified metrics", build.summary.replace(/^Queried certified metrics only: /, "Certified only: "), build.status);
    const reg = ev("register/Lifecycle engine");
    if (reg) add("reg", "Lifecycle engine", "Register", reg.summary, reg.status);
  }
  if (run.path === "reuse") {
    const confirm = ev("confirm_reuse/Analyst");
    if (confirm) add("gate", "Requester", confirm.status === "done" ? "Reuse confirmed" : "Use this dashboard?", confirm.status === "done" ? confirm.summary : "Press Use this in the chat", confirm.status, confirm.status === "done" ? "✓" : "🔒");
    const log = ev("log_reuse/Lifecycle engine");
    if (log) add("log", "Lifecycle engine", "Log reuse", log.summary, log.status);
  }
  return steps;
}

/** Owner IDs read as people's names (the run stores IDs). */
function withNames(text: string, people: Record<string, { name: string }>): string {
  return text.replace(/OWN-\d+/g, (id) => people[id]?.name ?? id);
}

export function Storyboard({ run }: { run: Run }) {
  const reduced = useReducedMotion();
  const people = useLifecycle().data?.people ?? {};
  const latest = new Map<string, StepEvent>();
  for (const e of run.events) latest.set(`${e.step}/${e.agent}`, { ...e, summary: withNames(e.summary, people) });
  const steps = buildSteps(run, latest, reduced);

  // Reveal steps one by one; a new run starts again from zero.
  const [reveal, setReveal] = useState<{ runId: string; n: number }>({ runId: run.runId, n: 0 });
  const current = reveal.runId === run.runId ? reveal.n : 0;
  const revealed = reduced ? steps.length + 1 : current;
  useEffect(() => {
    if (reduced || current > steps.length) return;
    const t = setTimeout(() => setReveal({ runId: run.runId, n: current + 1 }), current === 0 ? 150 : REVEAL_MS);
    return () => clearTimeout(t);
  }, [current, steps.length, reduced, run.runId]);

  const shown = steps.slice(0, revealed);
  const allShown = revealed > steps.length;
  const runFinished = run.status === "done" || run.status === "failed";

  return (
    <div className="space-y-2 px-4 py-4">
      <ol className="space-y-2">
        {shown.map((s, i) => {
          const last = i === shown.length - 1 && !allShown;
          const tone: Tone = s.tone === "done" && last && !runFinished ? "active" : s.tone;
          return <StepRow key={s.key} n={i + 1} step={{ ...s, tone }} animate={!reduced} />;
        })}
      </ol>
      {allShown && runFinished && <ResultCard run={run} latest={latest} animate={!reduced} />}
    </div>
  );
}

const ROW: Record<Tone, string> = {
  done: "border-line bg-surface",
  active: "border-sky bg-surface shadow-[0_0_0_3px_rgba(0,188,255,0.15)]",
  waiting: "pipeline-pulse border-warn bg-[#fffaf2]",
  failed: "border-danger/40 bg-[#fdeeee]",
};
const ICON: Record<Tone, string> = {
  done: "bg-blue text-white",
  active: "bg-sky text-white",
  waiting: "bg-warn text-white",
  failed: "bg-danger text-white",
};

function StepRow({ n, step, animate }: { n: number; step: Step; animate: boolean }) {
  return (
    <li className={`flex items-start gap-3 rounded-md border px-3 py-2 text-xs transition-colors ${ROW[step.tone]} ${animate ? "storyboard-in" : ""}`}>
      <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${ICON[step.tone]}`}>
        {step.icon ?? (step.tone === "done" ? "✓" : n)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold text-ink">{step.title}</span>
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-ink-3">{step.who}</span>
        </div>
        <div className={`mt-0.5 leading-snug ${step.tone === "waiting" ? "font-medium text-warn" : "text-ink-2"}`}>{step.detail}</div>
      </div>
    </li>
  );
}

function ResultCard({ run, latest, animate }: { run: Run; latest: Map<string, StepEvent>; animate: boolean }) {
  const scope = run.scope ? `${run.scope.product} · ${run.scope.market}` : run.requestId;
  const anim = animate ? "storyboard-pop" : "";
  if (run.status === "failed") {
    const why = latest.get("approve/Approver")?.summary ?? latest.get("done/Orchestrator")?.summary ?? "Stopped";
    return (
      <div className={`rounded-lg border-2 border-danger/50 bg-surface p-4 shadow-lg ${anim}`}>
        <div className="text-[10px] font-bold uppercase tracking-widest text-danger">Not built</div>
        <div className="mt-1 text-sm text-ink">{why}</div>
      </div>
    );
  }
  if (run.path === "build") {
    const done = latest.get("done/Lifecycle engine");
    const kpis = latest.get("build/Semantic layer")?.evidence.filter((x) => !x.startsWith("#")) ?? [];
    const expires = value(done, "expires");
    return (
      <div className={`rounded-lg border-2 border-green bg-surface p-4 shadow-lg ${anim}`}>
        <div className="text-[10px] font-bold uppercase tracking-widest text-green-deep">Temporary · new</div>
        <div className="mt-1 text-base font-semibold text-ink">{run.assetId}</div>
        <div className="mt-1 text-xs text-ink-2">
          {kpis.join(", ")} · {scope}
        </div>
        {expires && <div className="mt-2 inline-block rounded-full bg-[#fdf3e6] px-2 py-0.5 text-[11px] font-medium text-warn">Expires {expires} unless used again</div>}
        <div className="mt-2 text-[11px] text-ink-3">Open it on the Dashboard tab.</div>
      </div>
    );
  }
  if (run.path === "reuse" && latest.has("log_reuse/Lifecycle engine")) {
    return (
      <div className={`rounded-lg border-2 border-green bg-surface p-4 shadow-lg ${anim}`}>
        <div className="text-[10px] font-bold uppercase tracking-widest text-green-deep">Reused · nothing built</div>
        <div className="mt-1 text-base font-semibold text-ink">{run.assetId}</div>
        <div className="mt-1 text-xs text-ink-2">{latest.get("log_reuse/Lifecycle engine")?.summary} · {scope}</div>
      </div>
    );
  }
  const rec = latest.get("recommend/Orchestrator")?.summary ?? "";
  const covered = run.path === "reuse" || run.path === "restore" || run.path === "pending";
  return (
    <div className={`rounded-lg border-2 ${covered ? "border-blue" : "border-line-strong"} bg-surface p-4 shadow-lg ${anim}`}>
      <div className={`text-[10px] font-bold uppercase tracking-widest ${covered ? "text-[#00609a]" : "text-ink-3"}`}>
        {covered ? "Already covered · nothing built" : "No action"}
      </div>
      <div className="mt-1 text-sm text-ink">{rec}</div>
    </div>
  );
}

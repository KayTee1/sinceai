"use client";

// T24 (B4): Scheduler tab in the Agentic workspace (Pipeline | Scheduler | Inbox).
// Shows the scheduler's jobs, run history and findings from the real
// /api/scheduler routes, and offers the manager's manual run, dismiss and
// abandon actions. Actions are sent as the demo "manager" identity, which the
// server accepts only with SCHEDULER_DEMO_ACTIONS=1: attribution, not
// authentication. Approving or rejecting a proposal stays in the Inbox.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Finding, SchedulerRun } from "@/services/scheduler/types";
import { useLifecycle } from "../lifecycle/lifecycle-context";
import {
  canStartRun,
  findingStatusOptions,
  runOutcome,
  schedulerApi,
  statusLabel,
  type ApiResult,
  type SchedulerOverviewResponse,
  type Tone,
} from "@/lib/scheduler-client";
import { FindingCard, JobCard, Notice, RunRow } from "./scheduler-parts";

type Section = "jobs" | "findings" | "runs";
type Flash = { tone: Tone; text: string } | null;

const api = schedulerApi();

export function SchedulerView() {
  const { data: lifecycle } = useLifecycle();
  const [section, setSection] = useState<Section>("jobs");
  const [statusFilter, setStatusFilter] = useState("open");
  const [overview, setOverview] = useState<SchedulerOverviewResponse | null>(null);
  const [runs, setRuns] = useState<SchedulerRun[] | null>(null);
  const [findings, setFindings] = useState<{ total: number; list: Finding[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inFlight, setInFlight] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  // Only the newest load may write state: an older response (e.g. for the
  // previous status filter) that lands later is dropped.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const [o, r, f] = await Promise.all([api.overview(), api.runs(20), api.findings(statusFilter)]);
    if (seq !== loadSeq.current) return;
    const firstError = [o, r, f].find((x): x is Extract<ApiResult<unknown>, { ok: false }> => !x.ok);
    setLoadError(firstError ? firstError.message : null);
    if (o.ok) setOverview(o.data);
    if (r.ok) setRuns(r.data.runs);
    if (f.ok) setFindings({ total: f.data.total, list: f.data.findings });
    setLoading(false);
  }, [statusFilter]);

  // Re-read on mount, on a filter change and when the simulated date settles
  // (lifecycle changes add audit rows); not every tick while the clock runs.
  const clockKey = lifecycle?.clock.running ? "running" : (lifecycle?.clock.date ?? "");
  useEffect(() => {
    Promise.resolve().then(load);
  }, [load, clockKey]);

  // While the server reports a run in progress (e.g. started elsewhere), poll.
  const anyRunning = overview?.jobs.some((j) => j.running) ?? false;
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [anyRunning, load]);

  const act = useCallback(
    async <T,>(key: string, fn: () => Promise<ApiResult<T>>, onOk: (data: T) => Flash): Promise<boolean> => {
      setInFlight(key);
      setFlash(null);
      try {
        const res = await fn();
        setFlash(res.ok ? onOk(res.data) : { tone: "bad", text: res.message });
        return res.ok;
      } finally {
        setInFlight(null);
        await load();
      }
    },
    [load],
  );

  const startRun = (jobId: string) =>
    act(`run:${jobId}`, () => api.startRun(jobId), (d) => runOutcome(d.run));
  const dismiss = (findingId: string, reason: string) =>
    act(`dismiss:${findingId}`, () => api.dismiss(findingId, reason), (d) => ({
      tone: "ok",
      text: `Finding ${d.finding.findingId} is now ${statusLabel(d.finding.status)}.`,
    }));
  const abandon = (runId: string, reason: string) =>
    act(`abandon:${runId}`, () => api.abandon(runId, reason), (d) => ({
      tone: d.run.status === "failed" ? "ok" : "attention",
      text: `Run ${d.run.runId} is now ${statusLabel(d.run.status)}.`,
    }));

  const counts = overview?.findings;
  const options = useMemo(() => findingStatusOptions(counts), [counts]);
  const open = counts?.open ?? 0;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-line p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Governance scheduler</h2>
          <button type="button" onClick={() => void load()} className="text-xs text-blue hover:underline">
            Refresh
          </button>
        </div>
        <p className="text-xs text-ink-3">
          Scheduled checks over the estate. Findings are observations, not decisions; approve or reject proposals in the
          Inbox. Actions are sent as the demo &ldquo;manager&rdquo; identity (attribution, not authentication).
        </p>
        <div role="tablist" aria-label="Scheduler sections" className="flex flex-wrap gap-1">
          {(["jobs", "findings", "runs"] as Section[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              id={`scheduler-tab-${s}`}
              aria-selected={section === s}
              aria-controls="scheduler-panel"
              onClick={() => setSection(s)}
              className={`rounded-sm px-2 py-1 text-xs font-medium ${section === s ? "bg-navy text-white" : "text-ink-2 hover:bg-canvas"}`}
            >
              {s === "jobs"
                ? `Jobs${overview ? ` (${overview.jobs.length})` : ""}`
                : s === "findings"
                  ? `Findings${open ? ` (${open} open)` : ""}`
                  : "Run history"}
            </button>
          ))}
        </div>
        {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
        {loadError && <Notice tone="bad">{loadError}</Notice>}
      </div>

      <div
        id="scheduler-panel"
        role="tabpanel"
        aria-labelledby={`scheduler-tab-${section}`}
        className="min-h-0 flex-1 overflow-y-auto bg-canvas p-3"
      >
        {loading && !overview ? (
          <p className="p-4 text-center text-xs text-ink-3">Loading scheduler…</p>
        ) : section === "jobs" ? (
          !overview ? (
            <p className="p-4 text-center text-xs text-ink-3">Scheduler overview unavailable.</p>
          ) : overview.jobs.length === 0 ? (
            <p className="p-4 text-center text-xs text-ink-3">No scheduler jobs are registered on this server.</p>
          ) : (
            <ul className="space-y-2">
              {overview.jobs.map((j) => (
                <JobCard
                  key={j.job.jobId}
                  j={j}
                  busy={inFlight !== null}
                  starting={inFlight === `run:${j.job.jobId}`}
                  canRun={canStartRun(j, inFlight !== null)}
                  onRun={() => void startRun(j.job.jobId)}
                  onAbandon={abandon}
                />
              ))}
            </ul>
          )
        ) : section === "findings" ? (
          <div className="space-y-2">
            <div role="group" aria-label="Filter findings by status" className="flex flex-wrap items-center gap-1 text-xs">
              <span className="text-ink-3">Status:</span>
              {options.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={statusFilter === s}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-sm px-2 py-0.5 font-medium capitalize ${
                    statusFilter === s ? "bg-navy text-white" : "text-ink-2 hover:bg-surface"
                  }`}
                >
                  {statusLabel(s)}
                  {s !== "any" && counts && counts[s] !== undefined ? ` (${counts[s]})` : ""}
                </button>
              ))}
            </div>
            {!findings ? (
              <p className="p-4 text-center text-xs text-ink-3">Findings unavailable.</p>
            ) : findings.list.length === 0 ? (
              <p className="p-4 text-center text-xs text-ink-3">
                {statusFilter === "open" ? "No open findings. Run the overlap job after estate changes." : "No findings match."}
              </p>
            ) : (
              <>
                {findings.total > findings.list.length && (
                  <p className="text-xs text-ink-3">
                    Showing {findings.list.length} of {findings.total}.
                  </p>
                )}
                <ul className="space-y-2">
                  {findings.list.map((f) => (
                    <FindingCard key={f.findingId} f={f} busy={inFlight !== null} onDismiss={dismiss} />
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : !runs ? (
          <p className="p-4 text-center text-xs text-ink-3">Run history unavailable.</p>
        ) : runs.length === 0 ? (
          <p className="p-4 text-center text-xs text-ink-3">No runs yet. Start one from Jobs.</p>
        ) : (
          <ul className="space-y-2">
            {runs.map((r) => (
              <RunRow key={r.runId} run={r} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

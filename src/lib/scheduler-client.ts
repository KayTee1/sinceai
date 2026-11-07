// T24 (B4): browser-side helpers for the Scheduler tab. Typed fetch helpers
// for the /api/scheduler routes plus pure view-model functions, kept free of
// React so tests can cover them. Imports scheduler TYPES only (erased at
// build), never the server-side services.
//
// Rendering is deliberately generic: job lists, run and finding statuses and
// run summaries come from the server as-is, so a job, status or summary
// field added by a later branch (periodic reassessment, resolved/superseded
// findings) shows up without a code change here.
import type { ChangeWindow, Finding, JobDescriptor, OverlapSide, SchedulerRun } from "@/services/scheduler/types";

/** The Agentic workspace side tabs, in display order. */
export const AGENTIC_SIDE_TABS = ["pipeline", "scheduler", "inbox"] as const;
export type AgenticSideTab = (typeof AGENTIC_SIDE_TABS)[number];

/**
 * The identity the Manager view sends. Demo attribution only: the prototype
 * has no authentication, and the server accepts it only with
 * SCHEDULER_DEMO_ACTIONS=1 (services/scheduler/access.ts).
 */
export const DEMO_ACTOR = "manager";

export const GATE_MESSAGE =
  "Scheduler actions are disabled on this server (SCHEDULER_DEMO_ACTIONS). The prototype has no authentication.";
export const NOT_READY_MESSAGE = "Lifecycle is not initialised yet: open the app's dashboards once, then refresh.";

// ---- Response shapes (as the routes return them; statuses widened to string) ----

export type JobOverview = {
  job: JobDescriptor;
  checkpoint: { lastAuditId: number; runId: string | null; updatedAt: string } | null;
  pendingAuditRows: number;
  runs: Record<string, number>;
  latestRun: SchedulerRun | null;
  running: SchedulerRun | null;
};
export type SchedulerOverviewResponse = { jobs: JobOverview[]; findings: Record<string, number> };
export type RunsResponse = { runs: SchedulerRun[]; counts: Record<string, number> };
export type FindingsResponse = { total: number; counts: Record<string, number>; findings: Finding[] };

// ---- Result mapping ----

export type ApiErrorKind = "gate" | "not_ready" | "conflict" | "invalid" | "not_found" | "server" | "network";
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: ApiErrorKind; status: number | null; message: string };

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

type Raw = { status: number; body: unknown } | { status: null; error: string };

/** Maps an HTTP status and JSON body to a result. Pure, so tests feed it directly. */
export function mapResponse<T>(raw: Raw, context: "read" | "run" | "dismiss" | "abandon" = "read"): ApiResult<T> {
  if (raw.status === null) {
    return { ok: false, kind: "network", status: null, message: `Could not reach the server: ${raw.error}` };
  }
  const { status, body } = raw;
  if (status >= 200 && status < 300) return { ok: true, data: body as T };
  const serverMsg = errorText(body);
  if (status === 403) {
    const message = /SCHEDULER_DEMO_ACTIONS|disabled/i.test(serverMsg)
      ? GATE_MESSAGE
      : `Refused by the demo gate (403): ${serverMsg || "not allowed"}. The prototype has no authentication.`;
    return { ok: false, kind: "gate", status, message };
  }
  if (status === 409) {
    if (/not initiali[sz]ed/i.test(serverMsg)) return { ok: false, kind: "not_ready", status, message: NOT_READY_MESSAGE };
    const running = typeof (body as { runningRunId?: unknown })?.runningRunId === "string" || /still running|same time/i.test(serverMsg);
    const message =
      context === "run" && running
        ? `Another run is in progress; nothing was started. (${serverMsg})`
        : `Conflict (409): ${serverMsg || "the request conflicts with the current state"}`;
    return { ok: false, kind: "conflict", status, message };
  }
  if (status === 400) return { ok: false, kind: "invalid", status, message: `Invalid request (400): ${serverMsg || "rejected"}` };
  if (status === 404) return { ok: false, kind: "not_found", status, message: `Not found (404): ${serverMsg || "unknown id"}` };
  return { ok: false, kind: "server", status, message: `Server error (${status}): ${serverMsg || "request failed"}` };
}

function errorText(body: unknown): string {
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") return (body as { error: string }).error;
  return "";
}

async function call<T>(fetcher: Fetcher, url: string, init: RequestInit | undefined, context: Parameters<typeof mapResponse>[1]) {
  let res: Response;
  try {
    res = await fetcher(url, init);
  } catch (err) {
    return mapResponse<T>({ status: null, error: err instanceof Error ? err.message : String(err) }, context);
  }
  const body = await res.json().catch(() => null);
  return mapResponse<T>({ status: res.status, body }, context);
}

const post = (body: object): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Typed client for the scheduler routes. `fetcher` is injectable for tests. */
export function schedulerApi(fetcher: Fetcher = (url, init) => fetch(url, init)) {
  const get = <T>(url: string) => call<T>(fetcher, url, { cache: "no-store" }, "read");
  return {
    overview: () => get<SchedulerOverviewResponse>("/api/scheduler"),
    runs: (limit = 20) => get<RunsResponse>(`/api/scheduler/runs?limit=${limit}`),
    findings: (status: string, limit = 50) =>
      get<FindingsResponse>(`/api/scheduler/findings?status=${encodeURIComponent(status)}&limit=${limit}`),
    /** Always sends jobId (contract C2); B1 ignores it and runs the incremental job. */
    startRun: (jobId: string) =>
      call<{ run: SchedulerRun }>(fetcher, "/api/scheduler/runs", post({ actor: DEMO_ACTOR, jobId }), "run"),
    dismiss: (findingId: string, reason: string) =>
      call<{ finding: Finding }>(
        fetcher,
        `/api/scheduler/findings/${encodeURIComponent(findingId)}/dismiss`,
        post({ actor: DEMO_ACTOR, reason: reason.trim() }),
        "dismiss",
      ),
    abandon: (runId: string, reason: string) =>
      call<{ run: SchedulerRun }>(
        fetcher,
        `/api/scheduler/runs/${encodeURIComponent(runId)}/abandon`,
        post({ actor: DEMO_ACTOR, reason: reason.trim() }),
        "abandon",
      ),
  };
}

// ---- Validation ----

/** Client-side check before a dismiss or abandon; the server checks again. */
export function validateReason(reason: string): string | null {
  return reason.trim() ? null : "A reason is required.";
}

// ---- View models ----

export type Tone = "ok" | "bad" | "active" | "attention" | "muted" | "neutral";

/** Tone for any run or finding status; an unknown status is neutral and shown as-is. */
export function statusTone(status: string): Tone {
  switch (status) {
    case "succeeded":
    case "resolved":
      return "ok";
    case "failed":
      return "bad";
    case "running":
      return "active";
    case "open":
      return "attention";
    case "dismissed":
    case "superseded":
      return "muted";
    default:
      return "neutral";
  }
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

/** What a manual run's 200 response actually says. A 200 can carry a failed run. */
export function runOutcome(run: SchedulerRun | null | undefined): { tone: Tone; text: string } {
  if (!run) return { tone: "bad", text: "The server returned no run." };
  const f = (run.summary as { findings?: Record<string, unknown> } | null)?.findings;
  if (run.status === "succeeded") {
    const counts = f ? countsText(f) : "";
    return { tone: "ok", text: `Run ${run.runId} succeeded${counts ? `: ${counts}` : ""}.` };
  }
  if (run.status === "failed") {
    const err = run.error ? `${run.error.code} at ${run.error.stage}: ${run.error.message}` : "no error recorded";
    return { tone: "bad", text: `Run ${run.runId} failed (${err}). Checkpoint and findings were not changed by it.` };
  }
  return { tone: statusTone(run.status), text: `Run ${run.runId} is ${statusLabel(run.status)}.` };
}

/** "2 created, 1 updated" from any counts record; zero entries are left out. */
export function countsText(counts: Record<string, unknown>): string {
  return Object.entries(counts)
    .filter(([, n]) => typeof n === "number" && n > 0)
    .map(([k, n]) => `${n} ${statusLabel(k)}`)
    .join(", ");
}

export function windowText(w: Partial<ChangeWindow> | null | undefined): string {
  if (!w || typeof w.fromAuditId !== "number" || typeof w.toAuditId !== "number") return "unknown";
  return w.fromAuditId === w.toAuditId ? `no new audit rows (at #${w.toAuditId})` : `audit #${w.fromAuditId + 1} to #${w.toAuditId}`;
}

const KNOWN_SUMMARY = new Set(["window", "eventsRead", "relevantEvents", "ignoredSchedulerEvents", "assessments", "findings", "limitations"]);

/**
 * Summary lines for a run. Every field may be missing (contract C2: a
 * periodic run leaves incremental fields empty and adds its own). Fields this
 * code does not know are listed generically rather than dropped.
 */
export function summaryLines(summary: unknown): { label: string; value: string }[] {
  if (!summary || typeof summary !== "object") return [];
  const s = summary as Record<string, unknown>;
  const out: { label: string; value: string }[] = [];
  if (s.window) out.push({ label: "Window", value: windowText(s.window as Partial<ChangeWindow>) });
  const num = (k: string, label: string) => {
    if (typeof s[k] === "number") out.push({ label, value: String(s[k]) });
  };
  num("eventsRead", "Audit rows read");
  num("relevantEvents", "Relevant changes");
  num("ignoredSchedulerEvents", "Scheduler rows ignored");
  if (Array.isArray(s.assessments)) out.push({ label: "Assets assessed", value: String(s.assessments.length) });
  if (s.findings && typeof s.findings === "object") {
    out.push({ label: "Findings", value: countsText(s.findings as Record<string, unknown>) || "no changes" });
  }
  for (const [k, v] of Object.entries(s)) {
    if (KNOWN_SUMMARY.has(k) || v === undefined || v === null) continue;
    out.push({ label: k, value: typeof v === "object" ? compact(v) : String(v) });
  }
  return out;
}

function compact(v: unknown): string {
  const text = JSON.stringify(v);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

/** Assessments of a run, defensively (missing or malformed => empty). */
export function assessmentsOf(run: SchedulerRun): { assetId: string; outcome: string; reason: string; overlaps: string }[] {
  const list = (run.summary as { assessments?: unknown } | null)?.assessments;
  if (!Array.isArray(list)) return [];
  return list.map((a) => ({
    assetId: String(a?.assetId ?? "?"),
    outcome: String(a?.outcome ?? "unknown"),
    reason: String(a?.reason ?? ""),
    overlaps: a?.overlaps && typeof a.overlaps === "object" ? countsText(a.overlaps) : "",
  }));
}

export function checkpointText(j: JobOverview): string {
  if (!j.checkpoint) return "No checkpoint (not run yet, or this job does not use the audit checkpoint)";
  return `Audit row #${j.checkpoint.lastAuditId}${j.checkpoint.runId ? ` (run ${j.checkpoint.runId})` : ""}`;
}

/** A job can be started when nothing is in flight locally and the server reports no running run. */
export function canStartRun(j: JobOverview, inFlight: boolean): boolean {
  return !inFlight && !j.running;
}

/** Filter options for findings: "any" plus every status the server counts, open first. */
export function findingStatusOptions(counts: Record<string, number> | null | undefined): string[] {
  const keys = Object.keys(counts ?? {});
  const order = ["open", "dismissed", "resolved", "superseded"];
  keys.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
  if (!keys.includes("open")) keys.unshift("open");
  return ["any", ...keys];
}

export function sideText(s: OverlapSide | null | undefined): { label: string; value: string }[] {
  if (!s) return [];
  return [
    { label: "Asset", value: `${s.name ?? "?"} (${s.assetId ?? "?"})` },
    { label: "Origin", value: s.origin ?? "?" },
    { label: "Scope", value: `${s.product ?? "?"} · ${s.market ?? "?"}` },
    { label: "Tier", value: s.tier ?? "?" },
    { label: "Owner", value: s.ownerId ?? "none" },
    { label: "KPIs", value: Array.isArray(s.kpiIds) && s.kpiIds.length ? s.kpiIds.join(", ") : "none" },
    {
      label: "Usage",
      value: `${s.packUsers ?? "unknown"} users/month (pack) · ${s.appOpens90d ?? 0} app opens (90d)`,
    },
  ];
}

export function shortTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  return iso.replace("T", " ").replace(/\.\d+Z$|Z$/, " UTC");
}

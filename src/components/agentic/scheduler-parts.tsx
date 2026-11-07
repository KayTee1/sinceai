"use client";

// T24 (B4): small presentational parts of the Scheduler tab.
import { useId, useState } from "react";
import type { Finding, SchedulerRun } from "@/services/scheduler/types";
import {
  assessmentsOf,
  checkpointText,
  jobTitle,
  runTriggerText,
  simDecisionTone,
  shortTime,
  sideText,
  statusLabel,
  statusTone,
  summaryLines,
  validateReason,
  type JobOverview,
  type SimStatusResponse,
  type Tone,
} from "@/lib/scheduler-client";

const TONE: Record<Tone, string> = {
  ok: "bg-[#eef7e4] text-green-deep",
  bad: "bg-[#fdeeee] text-danger",
  active: "bg-[#e6f4fc] text-[#00609a]",
  attention: "bg-[#fdf3e6] text-warn",
  muted: "bg-canvas text-ink-3",
  neutral: "border border-line-strong text-ink-2",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`rounded-sm px-1.5 py-px text-[10px] font-bold uppercase tracking-wide ${TONE[statusTone(status)]}`}>
      {statusLabel(status)}
    </span>
  );
}

export function Notice({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`rounded-sm px-3 py-2 text-xs ${TONE[tone]}`}>
      {children}
    </div>
  );
}

function Rows({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-ink-3">{r.label}</dt>
          <dd className="min-w-0 break-words text-ink-2">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A reason box with client-side validation; the server error is shown by the caller. */
function ReasonForm({
  placeholder,
  submitLabel,
  busy,
  onCancel,
  onSubmit,
}: {
  placeholder: string;
  submitLabel: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const problem = validateReason(reason);
  const errorId = useId();
  const showProblem = touched && !!problem;
  return (
    <div className="mt-2 space-y-1.5">
      <textarea
        aria-label={placeholder}
        aria-invalid={showProblem}
        aria-describedby={showProblem ? errorId : undefined}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        autoFocus
        placeholder={placeholder}
        className="w-full resize-none rounded-sm border border-line-strong px-2 py-1.5 text-xs focus:border-blue focus:outline-none"
      />
      {showProblem && (
        <p id={errorId} role="alert" className="text-danger">
          {problem}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onCancel} className="px-2 py-1 text-ink-3 hover:text-ink">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setTouched(true);
            if (!problem) onSubmit(reason);
          }}
          className="rounded-sm bg-navy px-3 py-1 font-semibold text-white disabled:bg-line-strong"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

export function JobCard({
  j,
  busy,
  starting,
  canRun,
  onRun,
  onAbandon,
}: {
  j: JobOverview;
  busy: boolean;
  starting: boolean;
  canRun: boolean;
  onRun: () => void;
  onAbandon: (runId: string, reason: string) => Promise<boolean>;
}) {
  const [abandoning, setAbandoning] = useState(false);
  const runs = Object.entries(j.runs ?? {}).filter(([k]) => k !== "total");
  return (
    <li className="rounded-sm border border-line bg-surface p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">{j.job.title}</div>
          <div className="text-ink-3">
            {j.job.jobId} · mode {j.job.mode} · triggers {j.job.triggers.join(", ") || "none"}
          </div>
        </div>
        <button
          type="button"
          disabled={!canRun}
          onClick={onRun}
          title={j.running ? "A run of this job is in progress" : "Start a manual run as the demo manager"}
          className="shrink-0 rounded-sm bg-blue px-3 py-1 font-semibold text-white hover:bg-[#007fc4] disabled:bg-line-strong"
        >
          {starting ? "Running…" : "Run now"}
        </button>
      </div>
      <p className="mt-1.5 text-ink-2">{j.job.description}</p>
      <div className="mt-2">
        <Rows
          rows={[
            { label: "Checkpoint", value: checkpointText(j) },
            { label: "Pending audit rows", value: <span className="tabular">{j.pendingAuditRows}</span> },
            {
              label: "Runs",
              value: (
                <span className="tabular">
                  {j.runs?.total ?? 0} total{runs.length ? ` (${runs.map(([k, n]) => `${n} ${statusLabel(k)}`).join(", ")})` : ""}
                </span>
              ),
            },
            {
              label: "Latest run",
              value: j.latestRun ? (
                <span className="flex flex-wrap items-center gap-1">
                  <StatusPill status={j.latestRun.status} /> {j.latestRun.runId} · {shortTime(j.latestRun.startedAt)}
                </span>
              ) : (
                "never run"
              ),
            },
            ...(j.job.rules?.length
              ? [{ label: "Rules", value: j.job.rules.map((r) => `${r.ruleId}@${r.version}`).join(", ") }]
              : []),
          ]}
        />
      </div>
      {j.job.limitations?.length > 0 && (
        <div className="mt-2">
          <div className="label">Limitations (not treated as healthy)</div>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-ink-2">
            {j.job.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      {j.running && (
        <div className="mt-2 rounded-sm border border-line bg-canvas p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1">
              <StatusPill status={j.running.status} /> {j.running.runId} since {shortTime(j.running.startedAt)}
            </span>
            {!busy && !abandoning && (
              <button type="button" onClick={() => setAbandoning(true)} className="text-danger hover:underline">
                Abandon stuck run…
              </button>
            )}
          </div>
          {abandoning && (
            <ReasonForm
              placeholder="Why abandon it? (marks it failed; audited)"
              submitLabel="Abandon run"
              busy={busy}
              onCancel={() => setAbandoning(false)}
              onSubmit={async (reason) => {
                // Keep the form and its text if the request fails.
                if (await onAbandon(j.running!.runId, reason)) setAbandoning(false);
              }}
            />
          )}
        </div>
      )}
    </li>
  );
}

export function RunRow({ run }: { run: SchedulerRun }) {
  const [open, setOpen] = useState(false);
  const lines = summaryLines(run.summary);
  const assessments = open ? assessmentsOf(run) : [];
  return (
    <li className="rounded-sm border border-line bg-surface p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status={run.status} />
            <span className="font-medium text-ink">{run.runId}</span>
          </div>
          <div className="mt-0.5 text-ink-3">
            {run.jobId} · {runTriggerText(run)} · sim date {run.simDate}
          </div>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} className="shrink-0 text-blue hover:underline">
          {open ? "Hide" : "Details"}
        </button>
      </div>
      <div className="mt-1.5">
        <Rows
          rows={[
            { label: "Started", value: shortTime(run.startedAt) },
            { label: "Completed", value: shortTime(run.completedAt) },
            ...lines,
            ...(run.error
              ? [
                  {
                    label: "Error",
                    value: (
                      <span className="text-danger">
                        {run.error.code} ({run.error.stage}): {run.error.message}
                        {run.error.actor ? ` · by ${run.error.actor}` : ""}
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>
      {open && (
        <div className="mt-2 space-y-1">
          <div className="label">Assessments</div>
          {assessments.length === 0 ? (
            <p className="text-ink-3">None recorded for this run.</p>
          ) : (
            <ul className="space-y-0.5">
              {assessments.map((a, i) => (
                <li key={`${a.assetId}-${i}`} className="text-ink-2">
                  <span className="font-medium text-ink">{a.assetId}</span> · {a.outcome}
                  {a.overlaps ? ` · overlaps: ${a.overlaps}` : ""} — {a.reason}
                </li>
              ))}
            </ul>
          )}
          {Array.isArray(run.summary?.limitations) && run.summary.limitations.length > 0 && (
            <>
              <div className="label pt-1">Run limitations</div>
              <ul className="list-disc pl-4 text-ink-2">
                {run.summary.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function FindingCard({
  f,
  busy,
  onDismiss,
}: {
  f: Finding;
  busy: boolean;
  onDismiss: (findingId: string, reason: string) => Promise<boolean>;
}) {
  const [dismissing, setDismissing] = useState(false);
  const ev = f.evidence;
  return (
    <li className="rounded-sm border border-line bg-surface p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status={f.status} />
            <span className="rounded-sm bg-[#f1ecfa] px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-[#5b3e96]">
              Observation
            </span>
            <span className="text-ink-3">
              {f.ruleId}@{f.ruleVersion}
            </span>
          </div>
          <div className="mt-1 text-sm font-medium leading-snug text-ink">
            {ev?.mergeAway?.name ?? f.assetIds[0]} overlaps {ev?.keep?.name ?? f.assetIds[1] ?? "?"}
          </div>
          <div className="text-ink-3">{f.findingId}</div>
        </div>
        <span className="tabular shrink-0 text-right text-ink-3">
          seen {f.observations}×<br />
          last {f.lastSeen?.simDate ?? "?"}
        </span>
      </div>

      <p className="mt-1.5 text-ink-3">
        An observation from the overlap rule, not a merge decision. Nothing changes unless a proposal is raised and approved in
        the Inbox.
      </p>

      {ev ? (
        <div className="mt-2 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-sm border border-line p-2">
              <div className="label">Suggested to merge away</div>
              <Rows rows={sideText(ev.mergeAway)} />
            </div>
            <div className="rounded-sm border border-line p-2">
              <div className="label">Suggested to keep</div>
              <Rows rows={sideText(ev.keep)} />
            </div>
          </div>
          <Rows
            rows={[
              { label: "Verdict", value: ev.verdict },
              { label: "Reasoning", value: ev.reason },
              { label: "Shared KPIs", value: ev.sharedKpis?.join(", ") || "none" },
              { label: "Kept adds", value: ev.extraKpis?.join(", ") || "nothing" },
              { label: "Downstream", value: ev.downstreamAssets?.join(", ") || "none" },
              { label: "Usage note", value: ev.usageNote || "–" },
              { label: "Changed asset", value: ev.changedAssetId },
              {
                label: "Triggers",
                value: ev.triggers?.length
                  ? ev.triggers.map((t) => `#${t.auditId} ${t.action} (${t.simDate})`).join(", ")
                  : "none",
              },
              {
                label: "Sources",
                value: ev.source?.length ? ev.source.map((s) => `${s.sheet}: ${s.ids.join(", ")}`).join("; ") : "none",
              },
              {
                label: "First seen",
                value: f.firstSeen ? `${f.firstSeen.simDate} · ${shortTime(f.firstSeen.at)} · ${f.firstSeen.runId}` : "–",
              },
              {
                label: "Last seen",
                value: f.lastSeen ? `${f.lastSeen.simDate} · ${shortTime(f.lastSeen.at)} · ${f.lastSeen.runId}` : "–",
              },
            ]}
          />
        </div>
      ) : (
        <p className="mt-2 text-ink-3">No evidence recorded.</p>
      )}

      {f.dismissal && (
        <div className="mt-2 rounded-sm bg-canvas p-2 text-ink-2">
          Dismissed by {f.dismissal.actor} (demo identity) on {f.dismissal.simDate}: &ldquo;{f.dismissal.reason}&rdquo;
        </div>
      )}

      {f.resolution && (
        <div className="mt-2 rounded-sm bg-canvas p-2 text-ink-2">Resolved: {f.resolution.reason}</div>
      )}

      {f.proposal && (
        <div className="mt-2 rounded-sm bg-[#e6f4fc] p-2 text-[#00609a]">
          Proposal {f.proposal.proposalId} ({f.proposal.sourceId} into {f.proposal.targetId}):{" "}
          {f.proposal.outcome === "pending" ? "waiting for a decision in the Inbox." : `${f.proposal.outcome}.`}
        </div>
      )}

      {f.status === "open" &&
        (dismissing ? (
          <ReasonForm
            placeholder="Why is this overlap not a concern? (required; audited)"
            submitLabel="Dismiss finding"
            busy={busy}
            onCancel={() => setDismissing(false)}
            onSubmit={async (reason) => {
              if (await onDismiss(f.findingId, reason)) setDismissing(false);
            }}
          />
        ) : (
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <span className="mr-auto text-ink-3">
              Raising a proposal from a finding is switched off until the merge approver fix is reviewed.
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDismissing(true)}
              className="rounded-sm border border-line-strong px-3 py-1 font-medium text-ink-2 hover:bg-canvas disabled:opacity-40"
            >
              Dismiss…
            </button>
          </div>
        ))}
    </li>
  );
}

const TONE_PILL = (tone: Tone, text: string) => (
  <span className={`rounded-sm px-1.5 py-px text-[10px] font-bold uppercase tracking-wide ${TONE[tone]}`}>{text}</span>
);

/**
 * B5 (T26): simulated-clock scheduling. Shows whether clock actions run due
 * jobs, the last simulated evaluation per job (date, decision, reason, run)
 * and whether each job is due now; "Check due jobs" runs the due ones at the
 * stored date. Everything shown comes from GET /api/scheduler/simulated.
 */
export function SimulatedClockCard({
  sim,
  busy,
  checking,
  onCheck,
}: {
  sim: SimStatusResponse;
  busy: boolean;
  checking: boolean;
  onCheck: () => void;
}) {
  return (
    <li className="rounded-sm border border-blue/40 bg-surface p-3 text-xs" aria-label="Simulated clock scheduling">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">Simulated clock</div>
          <div className="text-ink-3">
            Sim date <span className="tabular font-semibold text-ink-2">{sim.simDate}</span> ·{" "}
            {sim.settings.autoOnClock ? "clock actions run due jobs" : "clock actions do not run jobs (SCHEDULER_SIM_TRIGGER off)"}
            {sim.settings.reassessEveryDays ? ` · demo cadence: reassess every ${sim.settings.reassessEveryDays} day(s)` : ""}
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onCheck}
          title="Run the jobs that are due at the stored simulated date; the clock is not moved"
          className="shrink-0 rounded-sm bg-blue px-3 py-1 font-semibold text-white hover:bg-[#007fc4] disabled:bg-line-strong"
        >
          {checking ? "Checking…" : "Check due jobs"}
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {sim.jobs.map((j) => (
          <li key={j.jobId} className="rounded-sm bg-canvas px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-ink">{jobTitle(j.jobId)}</span>
              {TONE_PILL(j.due.due ? "attention" : "muted", j.due.due ? "due now" : "not due")}
            </div>
            <div className="text-ink-3">{j.due.reason}</div>
            <div className="mt-0.5 text-ink-2">
              {j.last ? (
                <>
                  Last evaluated <span className="tabular">{j.last.simDate}</span> ({statusLabel(j.last.source)}):{" "}
                  {TONE_PILL(simDecisionTone(j.last.decision), statusLabel(j.last.decision))}
                  {j.last.runId ? ` · run ${j.last.runId}` : ""}
                  <div className="text-ink-3">{j.last.reason}</div>
                </>
              ) : (
                "Not evaluated by the simulated clock yet."
              )}
            </div>
          </li>
        ))}
      </ul>
    </li>
  );
}

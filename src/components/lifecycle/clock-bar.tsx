"use client";

import { useState } from "react";
import { formatDate } from "@/lib/format";
import { useLifecycle } from "./lifecycle-context";

// God-mode clock control (D12), Manager only. 1 simulated day = 1 real second while running.
export function ClockBar() {
  const { data, busy, error, post } = useLifecycle();
  const [confirmReset, setConfirmReset] = useState(false);
  if (!data) return <div className="h-11 shrink-0 border-b border-line bg-surface" />;

  const { clock, nextDue, leaseDue, pending } = data;
  const escalated = pending.filter((p) => p.status === "escalated").length;

  return (
    <div className="flex h-11 shrink-0 items-center gap-4 border-b border-line bg-surface px-5 text-xs">
      <span className="label">Clock</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => post(clock.running ? "/api/clock/pause" : "/api/clock/resume")}
          aria-label={clock.running ? "Pause clock" : "Run clock"}
          className="flex h-7 w-7 items-center justify-center rounded-sm bg-navy text-white hover:bg-[#1b4a66] disabled:opacity-50"
        >
          {clock.running ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect x="1" y="1" width="3" height="8" fill="currentColor" />
              <rect x="6" y="1" width="3" height="8" fill="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M2 1 9 5 2 9Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <span className="tabular w-[92px] text-sm font-semibold text-ink">{formatDate(clock.date)}</span>
        <span className={`flex items-center gap-1 ${clock.running ? "text-green-deep" : "text-ink-3"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${clock.running ? "animate-pulse bg-green" : "bg-line-strong"}`} />
          {clock.running ? "Running · 1 day/s" : "Paused"}
        </span>
      </div>

      <div className="flex items-center gap-1">
        {[1, 30, 90].map((d) => (
          <button
            key={d}
            type="button"
            disabled={busy}
            onClick={() => post("/api/clock/advance", { days: d })}
            className="rounded-sm border border-line-strong px-2 py-1 font-medium text-ink-2 hover:border-blue hover:text-blue disabled:opacity-50"
          >
            +{d}d
          </button>
        ))}
        <button
          type="button"
          disabled={busy || !nextDue}
          onClick={() => post("/api/clock/advance", { toNextEvent: true })}
          className="rounded-sm border border-line-strong px-2 py-1 font-medium text-ink-2 hover:border-blue hover:text-blue disabled:opacity-50"
          title={nextDue ? `Next due event on ${formatDate(nextDue)}` : "Nothing is due"}
        >
          Next event{nextDue ? ` · ${formatDate(nextDue)}` : ""}
        </button>
      </div>

      <div className="ml-auto flex items-center gap-4 text-ink-2">
        {error && (
          <span className="max-w-[320px] truncate text-danger" title={error}>
            {error}
          </span>
        )}
        <Count label="Under review" value={leaseDue} warn={leaseDue > 0} />
        {escalated > 0 && <Count label="Escalated" value={escalated} warn />}
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (!confirmReset) return setConfirmReset(true);
            setConfirmReset(false);
            await post("/api/lifecycle/reset");
          }}
          onBlur={() => setConfirmReset(false)}
          className={`rounded-sm px-2 py-1 font-medium ${confirmReset ? "bg-danger text-white" : "text-ink-3 hover:text-ink"}`}
        >
          {confirmReset ? "Confirm reset" : "Reset demo"}
        </button>
      </div>
    </div>
  );
}

function Count({ label, value, warn }: { label: string; value?: number; warn?: boolean }) {
  return (
    <span className="whitespace-nowrap">
      <span className={`tabular font-semibold ${warn ? "text-warn" : "text-ink"}`}>{value ?? 0}</span> {label}
    </span>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/format";
import { useLifecycle } from "../lifecycle/lifecycle-context";

// Scheduled findings (T20): duplicate groups found by the 10-day scan. These
// are observations for triage; "Propose merge" sends merge proposals to the
// owners' approval inbox, "Dismiss" records why the group is fine.

type Finding = {
  id: string;
  firstSeen: string;
  lastSeen: string;
  assetIds: string[];
  similarity: number;
  status: "open" | "dismissed" | "proposed";
  reason: string | null;
  decidedBy: string | null;
  decidedOn: string | null;
  evidence: {
    fingerprintVersion: string;
    shared: string[];
    members: { assetId: string; features: string[]; hex: string }[];
    pairs: { a: string; b: string; similarity: number }[];
  };
};

type AssetInfo = {
  name: string;
  platform: string;
  type: string;
  model: string | null;
  owner: string | null;
  tier: string | null;
  status: string | null;
};

type Payload = {
  findings: Finding[];
  runs: { id: string; runDate: string; actor: string; assets: number; groups: number; newFindings: number }[];
  nextScan: string | null;
  fingerprinter: string;
  assets: Record<string, AssetInfo>;
};

type Filter = "open" | "proposed" | "dismissed";

const label = (f: string) =>
  f
    .replace(/^metric:/, "")
    .replace(/^product:/, "product ")
    .replace(/^market:/, "market ");

export function FindingsView() {
  const { data: lc, post, busy } = useLifecycle();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/findings", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Could not load findings");
    setPayload(j);
  }, []);

  // Reload when the simulated date moves (a scheduled scan may have run) or after actions.
  const clockDate = lc?.clock.date;
  const pending = lc?.pending.length;
  useEffect(() => {
    Promise.resolve()
      .then(load)
      .catch((e) => setError(e.message));
  }, [load, clockDate, pending]);

  const act = async (url: string, body: object) => {
    setError(null);
    if (await post(url, body)) await load();
  };

  const runs = payload?.runs ?? [];
  const last = runs[0];
  const items = (payload?.findings ?? []).filter((f) => f.status === filter);
  const count = (s: Filter) => (payload?.findings ?? []).filter((f) => f.status === s).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-line bg-surface px-6 py-3 text-xs">
        <span className="label">Duplicate scan · every 10 days</span>
        <span>
          {last
            ? `Last run ${formatDate(last.runDate)} by ${last.actor}: ${last.assets} dashboards, ${last.groups} groups, ${last.newFindings} new`
            : "Not run yet"}
        </span>
        <span className="text-ink-3">{payload?.nextScan ? `Next run ${formatDate(payload.nextScan)}` : ""}</span>
        <span className="text-ink-3" title="Swap-in point for the binary fingerprints">
          Fingerprint: {payload?.fingerprinter ?? "…"}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => act("/api/findings/scan", { actor: "manager" })}
          className="ml-auto rounded-sm bg-navy px-3 py-1.5 font-semibold text-white hover:bg-[#1b4a66] disabled:opacity-50"
        >
          Run scan now
        </button>
      </div>

      <div className="flex shrink-0 gap-1 border-b border-line bg-surface px-6 py-2">
        {(["open", "proposed", "dismissed"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-sm px-2.5 py-1 text-xs font-medium capitalize ${
              filter === f ? "bg-navy text-white" : "text-ink-2 hover:bg-canvas"
            }`}
          >
            {f} <span className="tabular opacity-70">{count(f)}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
        <div className="mx-auto max-w-[900px] space-y-3 p-6">
          {error && <p className="text-sm text-danger">{error}</p>}
          {!payload && <p className="text-sm text-ink-3">Loading findings…</p>}
          {payload && items.length === 0 && (
            <p className="rounded-sm border border-line bg-surface p-6 text-sm text-ink-3">
              {filter === "open"
                ? runs.length
                  ? "No open duplicate groups. Next scan runs automatically."
                  : "The first scan runs on the next simulated day, or press Run scan now."
                : `No ${filter} findings.`}
            </p>
          )}
          {items.map((f) => (
            <FindingCard key={f.id} f={f} assets={payload!.assets} busy={busy} act={act} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FindingCard({
  f,
  assets,
  busy,
  act,
}: {
  f: Finding;
  assets: Record<string, AssetInfo>;
  busy: boolean;
  act: (url: string, body: object) => Promise<void>;
}) {
  const [target, setTarget] = useState(f.assetIds[0]);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const open = f.status === "open";

  return (
    <div className="rounded-sm border border-line bg-surface text-xs">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <div className="text-sm font-semibold">
            {Math.round(f.similarity * 100)}% similar · {f.assetIds.length} dashboards
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {f.evidence.shared.map((s) => (
              <span key={s} className="rounded-full border border-line-strong bg-canvas px-2 py-0.5 text-ink-2">
                {label(s)}
              </span>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right text-ink-3">
          <div>First seen {formatDate(f.firstSeen)}</div>
          <div>Last seen {formatDate(f.lastSeen)}</div>
        </div>
      </div>

      <ul className="divide-y divide-line">
        {f.assetIds.map((id) => {
          const a = assets[id];
          const m = f.evidence.members.find((x) => x.assetId === id);
          const extra = (m?.features ?? []).filter((x) => !f.evidence.shared.includes(x));
          return (
            <li key={id} className="flex items-start gap-3 px-4 py-2">
              {open && (
                <input
                  type="radio"
                  name={`target-${f.id}`}
                  checked={target === id}
                  onChange={() => setTarget(id)}
                  className="mt-1"
                  aria-label={`Keep ${a?.name ?? id}`}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-medium text-ink">
                  {a?.name ?? id} <span className="font-normal text-ink-3">{id}</span>
                  {open && target === id && <span className="ml-2 font-semibold text-green-deep">keep</span>}
                  {a?.status === "archived" && <span className="ml-2 text-warn">archived</span>}
                </div>
                <div className="text-ink-3">
                  {a?.platform} {a?.type} · {a?.tier ?? "?"} · owner {a?.owner ?? "missing"} · model {a?.model ?? "–"}
                  {extra.length > 0 && <> · also {extra.map(label).join(", ")}</>}
                </div>
              </div>
              <code
                className="hidden shrink-0 font-mono text-[10px] text-ink-3 md:block"
                title="Fingerprint bits (hex)"
              >
                {m?.hex.slice(0, 16)}…
              </code>
            </li>
          );
        })}
      </ul>

      {open ? (
        <div className="border-t border-line px-4 py-3">
          {dismissing ? (
            <div className="space-y-2">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                autoFocus
                placeholder="Why is this fine? e.g. legitimate regional variant"
                className="w-full resize-none rounded-sm border border-line-strong px-2 py-1.5 focus:border-blue focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setDismissing(false)} className="px-2 py-1 text-ink-3">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || !reason.trim()}
                  onClick={() => act(`/api/findings/${f.id}/dismiss`, { actor: "manager", reason })}
                  className="rounded-sm bg-navy px-3 py-1 font-semibold text-white disabled:bg-line-strong"
                >
                  Dismiss with reason
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <span className="mr-auto text-ink-3">
                Pick the dashboard to keep. The others&apos; owners get a merge proposal to approve.
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDismissing(true)}
                className="rounded-sm border border-line-strong px-3 py-1 font-medium text-ink-2 hover:bg-canvas"
              >
                Dismiss
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => act(`/api/findings/${f.id}/merge`, { actor: "manager", targetId: target })}
                className="rounded-sm bg-blue px-3 py-1 font-semibold text-white hover:bg-[#007fc4] disabled:bg-line-strong"
              >
                Propose merge
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-line px-4 py-2 text-ink-3">
          {f.status === "proposed" ? "Merge proposed" : "Dismissed"} by {f.decidedBy}
          {f.decidedOn ? ` on ${formatDate(f.decidedOn)}` : ""}
          {f.reason ? `: ${f.reason}` : ""}
        </div>
      )}
    </div>
  );
}

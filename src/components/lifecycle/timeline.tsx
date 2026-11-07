"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/format";
import { useLifecycle } from "./lifecycle-context";

type Entry = {
  id: number;
  simDate: string;
  actor: string;
  action: string;
  policyVersion: string | null;
  rationale: string;
};

type AssetState = { status: string; tier: string; ownerId: string | null } | null;

const LABEL: Record<string, string> = {
  lease_review_opened: "Lease review opened",
  review_escalated: "Escalated to data steward",
  proposal_approved: "Proposal approved",
  proposal_rejected: "Proposal rejected",
  proposal_closed: "Proposal closed (asset archived)",
  renewed: "Lease renewed",
  retired: "Retired and archived",
  restored: "Restored",
  ttl_expired: "Temporary expired",
  temporary_registered: "Temporary insight created",
  promoted: "Promoted",
  promotion_proposed: "Proposed for Team",
  build_proposed: "Build proposed",
  insight_built: "Insight built",
};

// Per-asset audit timeline (Manager), with Restore for archived assets.
export function Timeline({ assetId }: { assetId: string }) {
  const { data, post, busy } = useLifecycle();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [state, setState] = useState<AssetState>(null);
  const people = data?.people ?? {};
  // Reload when the clock or the inbox changes.
  const version = `${data?.clock.date}|${data?.pending.length}|${JSON.stringify(data?.counts)}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/assets/${assetId}/audit`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setEntries(j.audit ?? []);
        setState(j.state ?? null);
      })
      .catch(() => !cancelled && setEntries([]));
    return () => {
      cancelled = true;
    };
  }, [assetId, version]);

  // Restore is an owner action; owner-less assets are restored by the manager, logged as such.
  const restoreActor = state?.ownerId ?? "manager";

  return (
    <div className="rounded-sm border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h3 className="text-sm font-semibold">Lifecycle timeline</h3>
        {state?.status === "archived" && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              post(`/api/assets/${assetId}/restore`, { actor: restoreActor, reason: "Restored on request." })
            }
            title={`Restore as ${people[restoreActor]?.name ?? restoreActor}`}
            className="rounded-sm bg-blue px-3 py-1 text-xs font-semibold text-white hover:bg-[#007fc4] disabled:bg-line-strong"
          >
            Restore
          </button>
        )}
      </div>
      {entries === null ? (
        <div className="px-5 py-4 text-xs text-ink-3">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="px-5 py-4 text-xs text-ink-3">
          No lifecycle events yet. Advance the clock to reach this lease end.
        </div>
      ) : (
        <ol className="px-5 py-3">
          {entries.map((e, i) => (
            <li key={e.id} className="relative flex gap-3 pb-3 last:pb-0">
              {i < entries.length - 1 && <span className="absolute left-[4px] top-3 h-full w-px bg-line" aria-hidden />}
              <span
                className={`mt-1 h-[9px] w-[9px] shrink-0 rounded-full ${
                  e.action === "retired" || e.action === "ttl_expired"
                    ? "bg-warn"
                    : e.action === "restored" || e.action === "renewed"
                      ? "bg-green"
                      : "bg-blue"
                }`}
                aria-hidden
              />
              <div className="min-w-0 text-xs">
                <div className="flex flex-wrap gap-x-2">
                  <span className="font-semibold text-ink">{LABEL[e.action] ?? e.action}</span>
                  <span className="tabular text-ink-3">{formatDate(e.simDate)}</span>
                  <span className="text-ink-3">
                    by {people[e.actor]?.name ?? e.actor}
                    {e.policyVersion && (e.actor === "policy" || e.actor === "scheduler")
                      ? ` · ${e.policyVersion}`
                      : ""}
                  </span>
                </div>
                <p className="mt-0.5 text-ink-2">{e.rationale}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

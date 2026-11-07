"use client";

import { useState } from "react";
import { formatDate } from "@/lib/format";
import { useLifecycle, type PendingProposal } from "./lifecycle-context";

type Filter = "all" | "escalated" | "retire" | "renew" | "promote" | "build_temporary";

// Approval inbox (Manager). Approval follows each proposal's required approvers
// (Rule 11), so every card offers only its own approvers to decide as (D12).
// Reject needs a reason.
export function Inbox() {
  const { data } = useLifecycle();
  const [filter, setFilter] = useState<Filter>("all");
  if (!data) return <div className="p-5 text-sm text-ink-3">Loading inbox…</div>;

  const items = data.pending.filter((p) =>
    filter === "all" ? true : filter === "escalated" ? p.status === "escalated" : p.type === filter,
  );

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Approval inbox</h2>
          <span className="tabular text-xs text-ink-3">{data.pending.length} waiting</span>
        </div>
        <p className="text-xs text-ink-3">
          You decide as one of each card&apos;s approvers: the owner (lease reviews), a team Lead (promotions and
          builds), or the data steward once escalated.
        </p>
        <div className="flex gap-1">
          {(["all", "escalated", "retire", "renew", "promote", "build_temporary"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-sm px-2 py-1 text-xs font-medium capitalize ${
                filter === f ? "bg-navy text-white" : "text-ink-2 hover:bg-canvas"
              }`}
            >
              {f === "build_temporary" ? "build" : f}
            </button>
          ))}
        </div>
      </div>

      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-canvas p-3">
        {items.map((p) => (
          <ProposalCard key={p.id} p={p} />
        ))}
        {items.length === 0 && (
          <li className="p-4 text-center text-xs text-ink-3">
            {data.pending.length === 0
              ? "Nothing waiting. Advance the clock to reach lease ends."
              : "No proposals match."}
          </li>
        )}
      </ul>
    </div>
  );
}

function ProposalCard({ p }: { p: PendingProposal }) {
  const { data, post, busy } = useLifecycle();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  // Only active approvers can decide; defaults to the first one (the owner when active).
  const [chosen, setChosen] = useState<string | null>(null);
  const people = data?.people ?? {};
  const eligible = p.requiredApprovers.filter((id) => people[id]?.active);
  const decider = chosen && eligible.includes(chosen) ? chosen : (eligible[0] ?? null);
  const canDecide = decider !== null;
  const ev = p.evidence;

  const decide = async (action: "approve" | "reject") => {
    const ok = await post(`/api/proposals/${p.id}/decision`, { actor: decider, action, reason });
    if (ok) {
      setRejecting(false);
      setReason("");
    }
  };

  return (
    <li className="rounded-sm border border-line bg-surface p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <span
              className={`rounded-sm px-1.5 py-px text-[10px] font-bold uppercase tracking-wide ${
                p.type === "retire"
                  ? "bg-[#fdf3e6] text-warn"
                  : p.type === "promote"
                    ? "bg-[#eef7e4] text-green-deep"
                    : p.type === "build_temporary"
                      ? "bg-navy text-white"
                      : "bg-[#e6f4fc] text-[#00609a]"
              }`}
            >
              {p.type === "build_temporary" ? "build" : p.type}
            </span>
            {p.status === "escalated" && (
              <span className="rounded-sm bg-[#fdeeee] px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-danger">
                Escalated
              </span>
            )}
          </div>
          <div className="mt-1 text-sm font-medium leading-snug text-ink">{p.assetNames[0]}</div>
          <div className="text-ink-3">{p.assetIds[0]}</div>
        </div>
        <span className="tabular shrink-0 text-right text-ink-3">
          {p.dueOn ? `Due ${formatDate(p.dueOn)}` : `Since ${formatDate(p.createdOn)}`}
        </span>
      </div>

      {"kind" in ev && ev.kind === "build" ? (
        <div className="mt-2 space-y-1.5 text-ink-2">
          <p className="italic">&ldquo;{ev.requestText}&rdquo;</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <dt className="text-ink-3">Scope</dt>
            <dd>
              {ev.scope.product} · {ev.scope.market}
            </dd>
            <dt className="text-ink-3">Certified KPIs</dt>
            <dd>{ev.kpis.map((k) => k.name ?? k.kpiId).join(", ")}</dd>
            <dt className="text-ink-3">Gap (no asset)</dt>
            <dd className="text-warn">{ev.gaps.join(", ") || "–"}</dd>
            <dt className="text-ink-3">Requester</dt>
            <dd>
              {people[ev.requesterId]?.name ?? ev.requesterId}
              {ev.requesterSource === "team_mapping" ? " (our mapping)" : ""}
            </dd>
          </dl>
        </div>
      ) : "kind" in ev ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-ink-2">
          <dt className="text-ink-3">Used by ({ev.region})</dt>
          <dd>
            {ev.users.length} people · threshold {ev.threshold}
          </dd>
          <dt className="text-ink-3">Who</dt>
          <dd className="truncate" title={ev.users.map((u) => people[u]?.name ?? u).join(", ")}>
            {ev.users.map((u) => people[u]?.name ?? u).join(", ")}
          </dd>
          <dt className="text-ink-3">30-day expiry</dt>
          <dd className="text-warn">on hold{ev.ttlEnd ? ` (was ${formatDate(ev.ttlEnd)})` : ""}</dd>
        </dl>
      ) : (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-ink-2">
          <dt className="text-ink-3">Monthly users</dt>
          <dd className="tabular">
            {ev.avgMonthlyUsers ?? "unknown"} avg · {ev.usageMonths.length} mo
          </dd>
          <dt className="text-ink-3">App opens (90d)</dt>
          <dd className="tabular">{ev.appOpens90d}</dd>
          <dt className="text-ink-3">Owner</dt>
          <dd className={ev.ownerStatus === "active" ? "" : "text-warn"}>{ev.ownerStatus}</dd>
          <dt className="text-ink-3">Downstream</dt>
          <dd className={ev.downstreamAssets.length ? "text-warn" : ""}>
            {ev.downstreamAssets.length ? ev.downstreamAssets.join(", ") : "none"}
          </dd>
        </dl>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="text-ink-3">{eligible.length > 1 ? "Decide as:" : "Decides:"}</span>
        {p.requiredApprovers.length === 0 && <span className="text-warn">none assigned</span>}
        {p.requiredApprovers.map((id) => (
          <button
            key={id}
            type="button"
            disabled={!people[id]?.active}
            onClick={() => setChosen(id)}
            title={people[id]?.active ? `Decide as ${people[id]?.name ?? id}` : "Inactive: cannot decide"}
            className={`rounded-full border px-2 py-px ${
              decider === id
                ? "border-blue bg-[#e6f4fc] text-[#00609a]"
                : "border-line-strong text-ink-2 hover:border-blue disabled:border-line disabled:text-ink-3 disabled:line-through"
            }`}
          >
            {people[id]?.name ?? id}
            {people[id]?.role === "Data Steward" ? " (steward)" : ""}
            {people[id] && !people[id].active ? " (inactive)" : ""}
          </button>
        ))}
      </div>

      {rejecting ? (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            autoFocus
            placeholder={
              p.type === "retire"
                ? "Why keep it? (renews the lease)"
                : p.type === "promote"
                  ? "Why not promote? (expiry resumes)"
                  : p.type === "build_temporary"
                    ? "Why not build? (nothing is built)"
                    : "Why not renew? (retires it)"
            }
            className="w-full resize-none rounded-sm border border-line-strong px-2 py-1.5 text-xs focus:border-blue focus:outline-none"
          />
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setRejecting(false)} className="px-2 py-1 text-ink-3 hover:text-ink">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={() => decide("reject")}
              className="rounded-sm bg-navy px-3 py-1 font-semibold text-white disabled:bg-line-strong"
            >
              Reject with reason
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-end gap-1.5">
          {!canDecide && <span className="mr-auto text-warn">No active approver: waits for the steward</span>}
          <button
            type="button"
            disabled={busy || !canDecide}
            onClick={() => setRejecting(true)}
            className="rounded-sm border border-line-strong px-3 py-1 font-medium text-ink-2 hover:bg-canvas disabled:opacity-40"
          >
            Reject
          </button>
          <button
            type="button"
            disabled={busy || !canDecide}
            onClick={() => decide("approve")}
            className="rounded-sm bg-blue px-3 py-1 font-semibold text-white hover:bg-[#007fc4] disabled:bg-line-strong"
          >
            Approve
          </button>
        </div>
      )}
    </li>
  );
}

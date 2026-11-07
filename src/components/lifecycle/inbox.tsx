"use client";

import { useState } from "react";
import { formatDate } from "@/lib/format";
import { useLifecycle, type PendingProposal } from "./lifecycle-context";

type Filter = "all" | "escalated" | "retire" | "renew";

// Approval inbox (Manager). Approval follows the proposal's required approvers,
// so the manager picks who they are acting as (D12); reject needs a reason.
export function Inbox() {
  const { data, actingAs, setActingAs } = useLifecycle();
  const [filter, setFilter] = useState<Filter>("all");
  if (!data) return <div className="p-5 text-sm text-ink-3">Loading inbox…</div>;

  const items = data.pending.filter((p) =>
    filter === "all" ? true : filter === "escalated" ? p.status === "escalated" : p.type === filter,
  );
  // Keep the current identity selectable even after its last proposal is decided.
  const approverIds = [
    ...new Set([...data.pending.flatMap((p) => p.requiredApprovers), ...(actingAs ? [actingAs] : [])]),
  ].sort((a, b) => (data.people[a]?.name ?? a).localeCompare(data.people[b]?.name ?? b));

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Approval inbox</h2>
          <span className="tabular text-xs text-ink-3">{data.pending.length} waiting</span>
        </div>
        <label className="block text-xs text-ink-3">
          Acting as
          <select
            value={actingAs}
            onChange={(e) => setActingAs(e.target.value)}
            className="mt-1 block w-full rounded-sm border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink focus:border-blue focus:outline-none"
          >
            <option value="">Choose an approver…</option>
            {approverIds.map((id) => (
              <option key={id} value={id}>
                {data.people[id]?.name ?? id} · {data.people[id]?.role ?? "unknown role"}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-1">
          {(["all", "escalated", "retire", "renew"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-sm px-2 py-1 text-xs font-medium capitalize ${
                filter === f ? "bg-navy text-white" : "text-ink-2 hover:bg-canvas"
              }`}
            >
              {f}
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
  const { data, actingAs, setActingAs, post, busy } = useLifecycle();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const people = data?.people ?? {};
  const canDecide = p.requiredApprovers.includes(actingAs);
  const ev = p.evidence;

  const decide = async (action: "approve" | "reject") => {
    const ok = await post(`/api/proposals/${p.id}/decision`, { actor: actingAs, action, reason });
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
                p.type === "retire" ? "bg-[#fdf3e6] text-warn" : "bg-[#e6f4fc] text-[#00609a]"
              }`}
            >
              {p.type}
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

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="text-ink-3">Approvers:</span>
        {p.requiredApprovers.length === 0 && <span className="text-warn">none assigned</span>}
        {p.requiredApprovers.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setActingAs(id)}
            title="Act as this approver"
            className={`rounded-full border px-2 py-px ${
              actingAs === id
                ? "border-blue bg-[#e6f4fc] text-[#00609a]"
                : "border-line-strong text-ink-2 hover:border-blue"
            }`}
          >
            {people[id]?.name ?? id}
            {people[id]?.role === "Data Steward" ? " (steward)" : ""}
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
            placeholder={p.type === "retire" ? "Why keep it? (renews the lease)" : "Why not renew? (retires it)"}
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
          {!canDecide && <span className="mr-auto text-ink-3">Act as an approver to decide</span>}
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

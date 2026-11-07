"use client";

// Cards the chat renders from tool results (T21). The model's text stays short;
// the evidence and the buttons live here. Every decision is a human click:
// Approve / Reject go through the inbox's own card (decision API), "Use this"
// through POST /api/reuse, and "Submit build proposal" sends the exact submit
// command that the propose-build tool checks.
import { useState } from "react";
import type { AnalysisView, KpiCheckView, KpiChecksView } from "@/mastra/tools/steward-views";
import type { BuildProposalView } from "@/mastra/tools/build-tools";
import type { ProposalListView } from "@/mastra/tools/inbox-tools";
import { ProposalCard } from "../lifecycle/inbox";
import { useLifecycle } from "../lifecycle/lifecycle-context";

type Send = (text: string) => void;

function Card({ tag, tone = "plain", children }: { tag: string; tone?: "plain" | "good" | "warn" | "build"; children: React.ReactNode }) {
  const tagClass =
    tone === "good"
      ? "bg-[#eef7e4] text-green-deep"
      : tone === "warn"
        ? "bg-[#fdf3e6] text-warn"
        : tone === "build"
          ? "bg-navy text-white"
          : "bg-[#e6f4fc] text-[#00609a]";
  return (
    <div className="rounded-sm border border-line bg-surface p-3 text-xs">
      <span className={`rounded-sm px-1.5 py-px text-[10px] font-bold uppercase tracking-wide ${tagClass}`}>{tag}</span>
      <div className="mt-2">{children}</div>
    </div>
  );
}

const btn = "rounded-sm border border-line-strong px-3 py-1 font-medium text-ink-2 hover:bg-canvas disabled:opacity-40";
const btnPrimary = "rounded-sm bg-blue px-3 py-1 font-semibold text-white hover:bg-[#007fc4] disabled:bg-line-strong";

/** The scope a follow-up must name: only when the request needed a clarification. */
function confirmedScope(v: AnalysisView) {
  return v.clarification.needed && v.clarification.resolved ? v.clarification.resolved : null;
}

// ---------- analysis ----------

export function AnalysisCards({ v, send, busy }: { v: AnalysisView; send: Send; busy: boolean }) {
  const conflicts = v.kpiChecks.filter((k) => k.conflict);
  const kind = v.recommendation.kind;
  return (
    <div className="space-y-2">
      {kind === "clarify" && <ClarifyCard v={v} send={send} busy={busy} />}
      {kind === "reuse_candidates" && <ReuseCards v={v} send={send} busy={busy} />}
      {kind === "build_proposal" && <BuildCard v={v} send={send} busy={busy} />}
      {conflicts.length > 0 && <ConflictCard checks={conflicts} />}
    </div>
  );
}

function ClarifyCard({ v, send, busy }: { v: AnalysisView; send: Send; busy: boolean }) {
  return (
    <Card tag="Pick a scope" tone="warn">
      <p className="text-ink-2">{v.clarification.question}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(v.clarification.options ?? []).map((o) => (
          <button
            key={`${o.product}-${o.market}`}
            type="button"
            disabled={busy}
            onClick={() => send(`Use product ${o.product} and market ${o.market} for ${v.request.id}.`)}
            className={btn}
          >
            {o.product} · {o.market}
          </button>
        ))}
      </div>
    </Card>
  );
}

function ReuseCards({ v, send, busy }: { v: AnalysisView; send: Send; busy: boolean }) {
  // Complete matches first, then the rest in service order; at most three cards.
  const shown = [...v.candidates.shown].sort((a, b) => Number(b.coversAllMetrics) - Number(a.coversAllMetrics)).slice(0, 3);
  return (
    <div className="space-y-2">
      {shown.map((c, i) => (
        <ReuseCard key={c.assetId} v={v} c={c} best={i === 0} send={send} busy={busy} />
      ))}
      {v.candidates.total > shown.length && (
        <p className="text-[11px] text-ink-3">
          {v.candidates.total - shown.length} more partial match{v.candidates.total - shown.length === 1 ? "" : "es"} not shown.
        </p>
      )}
    </div>
  );
}

function ReuseCard({
  v,
  c,
  best,
  send,
  busy,
}: {
  v: AnalysisView;
  c: AnalysisView["candidates"]["shown"][number];
  best: boolean;
  send: Send;
  busy: boolean;
}) {
  const { data, refresh } = useLifecycle();
  const [state, setState] = useState<{ kind: "idle" | "saving" } | { kind: "done"; who: string } | { kind: "error"; msg: string }>({
    kind: "idle",
  });

  async function useThis() {
    setState({ kind: "saving" });
    try {
      const res = await fetch("/api/reuse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: v.request.id, assetId: c.assetId, answer: confirmedScope(v) ?? undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setState({ kind: "done", who: data?.people[json.requesterId]?.name ?? json.requesterId });
      refresh();
    } catch (e) {
      setState({ kind: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <Card tag={c.coversAllMetrics ? "Reuse · full match" : "Reuse · partial"} tone={c.coversAllMetrics ? "good" : "plain"}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium leading-snug text-ink">{c.name}</div>
          <div className="text-ink-3">
            {c.assetId} · {c.endorsement} · owner {c.owner.name ?? "none"}
            {c.owner.id && !c.owner.active ? " (inactive)" : ""}
          </div>
        </div>
        {best && <span className="shrink-0 text-[11px] font-medium text-green-deep">Recommended</span>}
      </div>
      <Facts label="Covers" items={c.known} />
      <Facts label="Gaps" items={c.gaps} warn />
      <Facts label="Unknown" items={c.unknown} muted />

      <div className="mt-2 flex items-center justify-end gap-1.5">
        {state.kind === "done" ? (
          <span className="mr-auto text-green-deep">Logged as used by {state.who} (our requester mapping)</span>
        ) : state.kind === "error" ? (
          <span className="mr-auto text-danger">{state.msg}</span>
        ) : null}
        {state.kind !== "done" && (
          <>
            <button
              type="button"
              disabled={busy || state.kind === "saving"}
              onClick={() => send(`${c.assetId} is not right for ${v.request.id}. What's the next option?`)}
              className={btn}
            >
              Not right
            </button>
            <button type="button" disabled={state.kind === "saving"} onClick={useThis} className={btnPrimary}>
              {state.kind === "saving" ? "Saving…" : "Use this"}
            </button>
          </>
        )}
      </div>
    </Card>
  );
}

function Facts({ label, items, warn, muted }: { label: string; items: string[]; warn?: boolean; muted?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1.5 grid grid-cols-[64px_1fr] gap-x-2">
      <span className="text-ink-3">{label}</span>
      <ul className={warn ? "text-warn" : muted ? "text-ink-3" : "text-ink-2"}>
        {items.slice(0, 4).map((x) => (
          <li key={x}>{x}</li>
        ))}
        {items.length > 4 && <li className="text-ink-3">+{items.length - 4} more</li>}
      </ul>
    </div>
  );
}

function BuildCard({ v, send, busy }: { v: AnalysisView; send: Send; busy: boolean }) {
  const scope = confirmedScope(v);
  const command = `Submit a build proposal for ${v.request.id}${scope ? ` with product ${scope.product} and market ${scope.market}` : ""}`;
  const gaps = v.metricCoverage.filter((m) => m.assetIds.length === 0);
  return (
    <Card tag="Nothing fits · build" tone="build">
      <dl className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-0.5 text-ink-2">
        <dt className="text-ink-3">Scope</dt>
        <dd>
          {v.clarification.resolved ? `${v.clarification.resolved.product} · ${v.clarification.resolved.market}` : "–"}
        </dd>
        <dt className="text-ink-3">Not covered</dt>
        <dd className="text-warn">
          {gaps.map((m) => `${m.canonicalMetric}${m.approvedKpiId ? ` (${m.approvedKpiId})` : ""}`).join(", ") || "–"}
        </dd>
        <dt className="text-ink-3">Built from</dt>
        <dd>
          {v.computability.map((c) => `${c.kpiId} ${c.status === "computable" ? "" : `(${c.status.replace(/_/g, " ")})`}`.trim()).join(", ")}
        </dd>
        <dt className="text-ink-3">Lifetime</dt>
        <dd>Temporary, 30 days unless used again</dd>
      </dl>
      {v.request.teamAuthored && (
        <p className="mt-1.5 text-[11px] font-medium text-warn">{v.request.id}: team-authored demo request, not from the Bayer pack</p>
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        <span className="mr-auto text-ink-3">A Lead in the requester&apos;s region approves it.</span>
        <button type="button" disabled={busy} onClick={() => send(command)} className={btnPrimary}>
          Submit build proposal
        </button>
      </div>
    </Card>
  );
}

// ---------- KPI definitions ----------

export function ConflictCard({ checks }: { checks: KpiCheckView[] }) {
  return (
    <Card tag={`KPI conflict${checks.length > 1 ? "s" : ""}`} tone="warn">
      <ul className="space-y-1.5">
        {checks.map((k) => (
          <li key={k.canonicalMetric}>
            <span className="font-medium text-ink">{k.canonicalMetric}</span>
            <span className="text-ink-2">
              {" "}
              · use <span className="font-semibold text-green-deep">{k.approvedKpiId ?? "no approved KPI"}</span>
            </span>
            <div className="text-ink-3">
              Not approved:{" "}
              {k.variants
                .filter((x) => x.id !== k.approvedKpiId)
                .map((x) => `${x.id} ${x.name} (${x.approvalStatus.replace(/_/g, " ")})`)
                .join(", ") || "–"}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function KpiChecksCards({ v }: { v: KpiChecksView }) {
  const conflicts = v.checks.filter((k) => k.conflict);
  return conflicts.length ? <ConflictCard checks={conflicts} /> : null;
}

// ---------- proposals ----------

/** Live inbox cards for the given proposal IDs; decided ones show as settled. */
function LiveProposals({ ids, emptyText }: { ids: string[]; emptyText: string }) {
  const { data } = useLifecycle();
  if (!data) return null;
  const byId = new Map(data.pending.map((p) => [p.id, p]));
  const open = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const settled = ids.filter((id) => !byId.has(id));
  return (
    <div className="space-y-2">
      {open.length > 0 && (
        <ul className="space-y-2">
          {open.map((p) => (
            <ProposalCard key={p.id} p={p} />
          ))}
        </ul>
      )}
      {settled.length > 0 && (
        <p className="text-[11px] text-ink-3">
          {settled.join(", ")}: decided, no longer waiting.
        </p>
      )}
      {ids.length === 0 && <p className="text-[11px] text-ink-3">{emptyText}</p>}
    </div>
  );
}

export function BuildProposalCards({ v }: { v: BuildProposalView }) {
  if (v.status === "proposed" || v.status === "already_proposed") {
    return <LiveProposals ids={[v.proposal.id]} emptyText="" />;
  }
  if (v.status === "intent_required") {
    return (
      <Card tag="Not submitted" tone="warn">
        <p className="text-ink-2">Nothing was stored. Use the Submit button on the build card.</p>
      </Card>
    );
  }
  return null;
}

export function ProposalListCards({ v }: { v: ProposalListView }) {
  return (
    <div className="space-y-1.5">
      <LiveProposals ids={v.proposals.map((p) => p.id)} emptyText="Nothing is waiting for a decision." />
      {v.total > v.shown && <p className="text-[11px] text-ink-3">Showing {v.shown} of {v.total}; the rest are in the inbox.</p>}
    </div>
  );
}

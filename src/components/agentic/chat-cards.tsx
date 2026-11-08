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
import type { MergeProposalView, RetireView } from "@/mastra/tools/estate-tools";
import type {
  ArchivedView,
  AssetView,
  DraftView,
  DuplicateView,
  EstateItemView,
  EstateSearchView,
  MergeSuggestionsView,
  PortfolioView,
  RestoreOfferView,
} from "@/mastra/tools/estate-views";
import { ProposalCard } from "../lifecycle/inbox";
import { useLifecycle, type LifecycleSnapshot } from "../lifecycle/lifecycle-context";
import { useNavigation } from "../navigation";

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
const DECIDED_TAG: Record<string, string> = {
  merged: "Merged",
  retired: "Retired",
  renewed: "Lease renewed",
  promoted: "Promoted",
  insight_built: "Insight built",
  temporary_registered: "Insight built",
  proposal_closed: "Closed",
};

/** Replaces a proposal card once it is decided: what happened, by whom, and where to look. */
function DecidedCard({ id, d }: { id: string; d: LifecycleSnapshot["decided"][string] | undefined }) {
  const { openAsset } = useNavigation();
  if (!d) return <p className="text-[11px] text-ink-3">{id}: decided, no longer waiting.</p>;
  const rejected = d.status === "rejected";
  const tag = rejected ? "Rejected" : d.status === "expired" ? "Closed" : (DECIDED_TAG[d.outcome] ?? "Approved");
  return (
    <Card tag={tag} tone={rejected || d.status === "expired" ? "warn" : "good"}>
      <p className="text-ink-2">
        <span className="font-medium text-ink">{id}</span> {d.summary}.
      </p>
      <p className="mt-0.5 text-[11px] text-ink-3">Live status: this replaces what the reply above said before the decision.</p>
      {d.open.length > 0 && (
        <div className="mt-2 flex flex-wrap justify-end gap-1.5">
          {d.open.map((o, i) => (
            <button
              key={o.assetId}
              type="button"
              onClick={() => openAsset(o.assetId)}
              className={i === 0 ? btnPrimary : "rounded-sm border border-line-strong px-3 py-1 font-medium text-ink-2 hover:bg-canvas"}
              title={`Open ${o.assetId} in the Dashboard tab`}
            >
              Open {o.assetId} <span className="font-normal opacity-80">({o.note})</span> →
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

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
      {settled.map((id) => (
        <DecidedCard key={id} id={id} d={data.decided?.[id]} />
      ))}
      {ids.length === 0 && <p className="text-[11px] text-ink-3">{emptyText}</p>}
    </div>
  );
}

export function BuildProposalCards({ v, send, busy }: { v: BuildProposalView; send: Send; busy: boolean }) {
  if (v.status === "duplicate") return <DuplicateCard v={v.duplicate} send={send} busy={busy} />;
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

// ---------- estate (T22) ----------

function AssetLine({ a }: { a: EstateItemView }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span>
        <span className="font-medium text-ink">{a.name}</span>{" "}
        <span className="text-ink-3">
          {a.assetId} · {a.scope} · {a.origin === "app" ? "built in app" : "catalog"}
        </span>
      </span>
      <span className={`shrink-0 text-[11px] ${a.status === "archived" ? "text-warn" : "text-ink-3"}`}>
        {a.status === "archived" ? "archived" : a.tier}
      </span>
    </div>
  );
}

const VERDICT: Record<DuplicateView["verdict"], { tag: string; tone: "good" | "warn" | "plain" | "build" }> = {
  reuse: { tag: "Already exists · reuse", tone: "good" },
  pending: { tag: "Already waiting for approval", tone: "warn" },
  restore: { tag: "Archived match · restore", tone: "warn" },
  partial: { tag: "Partly covered", tone: "plain" },
  none: { tag: "Nothing like it yet", tone: "build" },
};

export function DuplicateCard({ v, send, busy }: { v: DuplicateView; send: Send; busy: boolean }) {
  const meta = VERDICT[v.verdict];
  return (
    <Card tag={meta.tag} tone={meta.tone}>
      <p className="text-ink-2">{v.rationale}</p>
      <div className="mt-2 space-y-1">
        {[...v.active, ...v.archived, ...v.partial].slice(0, 4).map((a) => (
          <AssetLine key={a.assetId} a={a} />
        ))}
        {v.pending.map((p) => (
          <div key={p.proposalId} className="text-ink-3">
            {p.proposalId} for {p.requestId} · {p.status}
          </div>
        ))}
      </div>
      {v.verdict === "restore" && v.archived[0] && (
        <div className="mt-2 flex justify-end">
          <button type="button" disabled={busy} onClick={() => send(`Can we restore ${v.archived[0].assetId} instead?`)} className={btn}>
            Restore instead
          </button>
        </div>
      )}
    </Card>
  );
}

export function EstateSearchCard({ v }: { v: EstateSearchView }) {
  if (v.total === 0) return <p className="text-[11px] text-ink-3">Nothing in the estate matches.</p>;
  return (
    <Card tag={`${v.total} in the estate`}>
      <div className="space-y-1">
        {v.assets.map((a) => (
          <AssetLine key={a.assetId} a={a} />
        ))}
      </div>
      {v.total > v.shown && <p className="mt-1.5 text-[11px] text-ink-3">Showing {v.shown} of {v.total}.</p>}
    </Card>
  );
}

export function ArchivedCards({ v }: { v: ArchivedView }) {
  if (v.total === 0) return <p className="text-[11px] text-ink-3">Nothing archived matches.</p>;
  return (
    <Card tag={`${v.total} archived`} tone="warn">
      <ul className="space-y-1.5">
        {v.assets.map((a) => (
          <li key={a.assetId}>
            <AssetLine a={a} />
            <div className="text-ink-3">
              {a.archivedOn ? `Archived ${a.archivedOn}` : "Archived"} · restores to {a.restoresTo}
              {a.archivedBecause ? ` · ${a.archivedBecause}` : ""}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function RestoreCard({ v }: { v: RestoreOfferView }) {
  const { post, busy } = useLifecycle();
  const [chosen, setChosen] = useState(v.restorers[0]?.id ?? "");
  const [done, setDone] = useState(false);
  async function restore() {
    const ok = await post(`/api/assets/${v.asset.assetId}/restore`, {
      actor: chosen,
      reason: "Restored from chat instead of building a new one.",
    });
    if (ok) setDone(true);
  }
  return (
    <Card tag="Restore instead of building" tone="warn">
      <AssetLine a={v.asset} />
      <p className="mt-1 text-ink-3">{v.next}</p>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
        {done ? (
          <span className="mr-auto text-green-deep">Restored by {v.restorers.find((r) => r.id === chosen)?.name ?? chosen}</span>
        ) : v.restorers.length === 0 ? (
          <span className="mr-auto text-warn">Nobody active can restore it</span>
        ) : (
          <>
            <span className="mr-auto text-ink-3">Restore as:</span>
            {v.restorers.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setChosen(r.id)}
                className={`rounded-full border px-2 py-px ${chosen === r.id ? "border-blue bg-[#e6f4fc] text-[#00609a]" : "border-line-strong text-ink-2"}`}
              >
                {r.name}
              </button>
            ))}
            <button type="button" disabled={busy || !chosen} onClick={restore} className={btnPrimary}>
              Restore
            </button>
          </>
        )}
      </div>
    </Card>
  );
}

const LEASE_OUTCOME: Record<NonNullable<AssetView["lease"]>["outcome"], string> = {
  auto_renew: "renews automatically (in use)",
  steward_review: "data steward review (owner inactive)",
  retire_review: "retire review by the owner (unused)",
};

export function AssetCard({ v, send, busy }: { v: AssetView; send: Send; busy: boolean }) {
  const [retiring, setRetiring] = useState(false);
  const [reason, setReason] = useState("");
  const a = v.asset;
  const canRetire = a.status !== "archived" && v.openProposals.length === 0;
  return (
    <Card tag={a.origin === "app" ? "Built in app" : "Catalog asset"}>
      <AssetLine a={a} />
      <dl className="mt-1.5 grid grid-cols-[96px_1fr] gap-x-2 gap-y-0.5 text-ink-2">
        <dt className="text-ink-3">Owner</dt>
        <dd className={a.ownerActive ? "" : "text-warn"}>
          {a.owner ?? "none"}
          {a.owner && !a.ownerActive ? " (inactive)" : ""}
        </dd>
        <dt className="text-ink-3">{a.ttlEnd ? "Expires" : "Lease ends"}</dt>
        <dd>{a.ttlEnd ?? a.leaseEnd ?? "–"}</dd>
        <dt className="text-ink-3">KPIs</dt>
        <dd>{a.kpiIds.join(", ") || "–"}</dd>
        <dt className="text-ink-3">App use</dt>
        <dd className="tabular">
          {v.usage.appOpens} opens · {v.usage.appViewers} people{v.usage.lastOpened ? ` · last ${v.usage.lastOpened}` : ""}
        </dd>
        <dt className="text-ink-3">Pack users</dt>
        <dd className="tabular">{v.usage.packAvgMonthlyUsers ?? "unknown"} / month (last 3 months)</dd>
        {v.lease && (
          <>
            <dt className="text-ink-3">At lease end</dt>
            <dd className={v.lease.outcome === "auto_renew" ? "" : "text-warn"}>{LEASE_OUTCOME[v.lease.outcome]}</dd>
          </>
        )}
        {v.openProposals.length > 0 && (
          <>
            <dt className="text-ink-3">Waiting</dt>
            <dd>{v.openProposals.map((p) => `${p.id} (${p.type})`).join(", ")}</dd>
          </>
        )}
      </dl>
      {canRetire &&
        (retiring ? (
          <div className="mt-2 space-y-1.5">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
              placeholder="Why retire it? (e.g. duplicates AST-0135)"
              className="w-full rounded-sm border border-line-strong px-2 py-1.5 text-xs focus:border-blue focus:outline-none"
            />
            <div className="flex justify-end gap-1.5">
              <button type="button" onClick={() => setRetiring(false)} className="px-2 py-1 text-ink-3 hover:text-ink">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !reason.trim() || /[?\n]/.test(reason)}
                onClick={() => send(`Propose retiring ${a.assetId} because ${reason.trim().replace(/\.$/, "")}`)}
                className={btnPrimary}
              >
                Send to owner
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={() => setRetiring(true)} className={btn}>
              Propose retire
            </button>
          </div>
        ))}
    </Card>
  );
}

export function PortfolioCard({ v }: { v: PortfolioView }) {
  const tiers = ["certified", "team", "personal", "temporary", "archived", "underReview"] as const;
  return (
    <Card tag="Estate">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {tiers.map((t) => (
          <div key={t}>
            <div className="text-[10px] uppercase tracking-wide text-ink-3">{t === "underReview" ? "in review" : t}</div>
            <div className="tabular text-sm font-semibold text-ink">{v.now[t]}</div>
            <div className="tabular text-[10px] text-ink-3">was {v.before[t]}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-ink-3">
        {v.pending.total} waiting ({v.pending.escalated} escalated)
        {v.nextEvent ? ` · next: ${v.nextEvent.kind} for ${v.nextEvent.id} on ${v.nextEvent.date}` : ""}
      </p>
    </Card>
  );
}

export function DraftCard({ v }: { v: DraftView }) {
  return (
    <p className="text-[11px] text-ink-3">
      Drafted <span className="font-medium text-ink-2">{v.requestId}</span> · {v.product} · {v.market} · {v.metrics.join(", ")} (drafted in
      chat, not a Bayer request)
    </p>
  );
}

export function RetireCards({ v }: { v: RetireView }) {
  if (v.status === "proposed") return <LiveProposals ids={[v.proposalId]} emptyText="" />;
  return (
    <Card tag="Not submitted" tone="warn">
      <p className="text-ink-2">Nothing was stored. Use Propose retire on the asset card and give a reason.</p>
    </Card>
  );
}

// ---------- merge (T22) ----------

const MERGE_TAG: Record<MergeSuggestionsView["suggestions"][number]["verdict"], { tag: string; tone: "good" | "warn" | "plain" }> = {
  merge: { tag: "Merge suggested", tone: "good" },
  keep_both: { tag: "Keep both · target too broad", tone: "warn" },
  partial: { tag: "Partial overlap · keep both", tone: "plain" },
};

function UsageLine({ s }: { s: MergeSuggestionsView["suggestions"][number]["keep"] }) {
  return (
    <span className="tabular text-ink-3">
      {s.packUsers ?? "?"} users/mo (last 3 mo) · {s.appOpens90d} app opens · {s.kpiIds.length} KPIs
    </span>
  );
}

export function MergeSuggestionsCards({ v, send, busy }: { v: MergeSuggestionsView; send: Send; busy: boolean }) {
  if (v.total === 0) return <p className="text-[11px] text-ink-3">No overlapping dashboards found.</p>;
  return (
    <div className="space-y-2">
      {v.suggestions.map((x) => {
        const meta = MERGE_TAG[x.verdict];
        return (
          <Card key={`${x.mergeAway.assetId}-${x.keep.assetId}`} tag={meta.tag} tone={meta.tone}>
            <div className="space-y-1.5">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-ink-3">{x.verdict === "merge" ? "Merge away" : "Asked about"}</div>
                <AssetLine a={x.mergeAway} />
                <UsageLine s={x.mergeAway} />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-ink-3">{x.verdict === "merge" ? "Keep" : "Overlaps with"}</div>
                <AssetLine a={x.keep} />
                <UsageLine s={x.keep} />
              </div>
            </div>
            <p className="mt-1.5 text-ink-2">{x.reason}</p>
            {x.tierWarning && <p className="mt-1 text-warn">{x.tierWarning}</p>}
            {x.verdict === "merge" && (
              <div className="mt-2 flex items-center justify-end gap-2">
                <span className="mr-auto text-ink-3">
                  Both owners approve: {[x.mergeAway.approver, x.keep.approver].filter(Boolean).join(" and ") || "nobody active"}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => send(`Propose merging ${x.mergeAway.assetId} into ${x.keep.assetId}`)}
                  className={btnPrimary}
                >
                  Propose merge
                </button>
              </div>
            )}
          </Card>
        );
      })}
      <p className="text-[11px] text-ink-3">{v.note}</p>
    </div>
  );
}

export function MergeProposalCards({ v }: { v: MergeProposalView }) {
  if (v.status === "proposed") return <LiveProposals ids={[v.proposalId]} emptyText="" />;
  return (
    <Card tag="Not submitted" tone="warn">
      <p className="text-ink-2">Nothing was stored. Use Propose merge on a merge suggestion.</p>
    </Card>
  );
}

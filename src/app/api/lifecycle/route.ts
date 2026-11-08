import { connection } from "next/server";
import { db } from "@/db/client";
import {
  getPortfolioCounts,
  getRecentAudit,
  listAssetStates,
  listPendingProposals,
  nextDueEvent,
} from "@/services/lifecycle";
import { withLifecycle } from "@/lib/lifecycle-server";

// Clock, inbox, state counts and latest audit rows in one read for the UI,
// plus display names for the assets and people the inbox mentions.
export async function GET() {
  await connection();
  return withLifecycle(async (clock) => {
    const client = db();
    const [states, pending, next, audit, assetNames, owners, portfolio, decidedRows] = await Promise.all([
      listAssetStates(client),
      listPendingProposals(client),
      nextDueEvent(client),
      getRecentAudit(client, 30),
      client.execute(`SELECT asset_id, asset_name FROM Analytics_Assets`),
      client.execute(`SELECT owner_id, owner_name, role, scope, status FROM Owners`),
      getPortfolioCounts(client),
      // Recently closed proposals with the action that closed them, so a chat card
      // can say what happened instead of only "no longer waiting".
      client.execute(
        `SELECT p.id, p.status, p.asset_ids, p.evidence,
                (SELECT a.action FROM audit_log a WHERE a.proposal_id = p.id ORDER BY a.id DESC LIMIT 1) AS last_action,
                (SELECT group_concat(d.actor, ' and ') FROM decisions d WHERE d.proposal_id = p.id AND d.action = CASE p.status WHEN 'approved' THEN 'approve' WHEN 'rejected' THEN 'reject' END) AS actors
         FROM proposals p WHERE p.status NOT IN ('open', 'escalated') ORDER BY p.rowid DESC LIMIT 100`,
      ),
    ]);
    // In-app views per dashboard (manager relevance check, D22).
    const views = await client.execute({
      sql: `SELECT u.asset_id, COUNT(*) AS opens, COUNT(DISTINCT u.user_id) AS viewers,
                   SUM(u.sim_date > date(?, '-30 day')) AS last30, MAX(u.sim_date) AS lastOpened
            FROM usage_events u GROUP BY u.asset_id`,
      args: [clock.date],
    });
    const appUsage = Object.fromEntries(
      views.rows.map((r) => [
        r.asset_id as string,
        {
          opens: Number(r.opens),
          viewers: Number(r.viewers),
          last30: Number(r.last30),
          lastOpened: r.lastOpened as string,
        },
      ]),
    );
    const counts: Record<string, number> = {};
    for (const s of states) {
      const key = s.status === "archived" ? "archived" : s.tier;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const names: Record<string, string> = {};
    for (const r of assetNames.rows) names[r.asset_id as string] = r.asset_name as string;
    for (const s of states) if (s.name) names[s.assetId] = s.name;
    return {
      clock: { date: clock.date, running: clock.running },
      nextDue: next?.date ?? null,
      counts,
      leaseDue: states.filter((s) => s.status === "lease_due").length,
      pending: pending.map((p) => ({
        ...p,
        assetNames:
          p.type === "build_temporary" && "kind" in p.evidence && p.evidence.kind === "build"
            ? [`New insight · ${p.evidence.scope.product} · ${p.evidence.scope.market}`]
            : p.assetIds.map((id) => names[id] ?? id),
      })),
      audit,
      decided: Object.fromEntries(decidedRows.rows.map((r) => [r.id as string, decidedSummary(r as unknown as DecidedRow)])),
      portfolio,
      appUsage,
      people: Object.fromEntries(
        owners.rows.map((o) => [
          o.owner_id as string,
          {
            name: o.owner_name as string,
            role: o.role as string,
            region: o.scope as string,
            active: o.status === "active",
          },
        ]),
      ),
    };
  });
}

type DecidedRow = { status: unknown; asset_ids: unknown; evidence: unknown; last_action: unknown; actors: unknown };

export type DecidedProposal = {
  status: string;
  /** The audit action that closed it (merged, retired, renewed, promoted, insight_built, proposal_closed, ...). */
  outcome: string;
  summary: string;
  /** Dashboards to open from the chat, most useful first (merge: the kept one, then the archived one). */
  open: { assetId: string; note: string }[];
};

/** One line on how a closed proposal ended, e.g. "approved by OWN-008 and OWN-022: merged; AST-0323 archived (restorable)". */
function decidedSummary(r: DecidedRow): DecidedProposal {
  const status = String(r.status);
  const actors = r.actors ? ` by ${String(r.actors)}` : "";
  const asset = (JSON.parse(String(r.asset_ids)) as string[])[0] ?? "";
  const ev = JSON.parse(String(r.evidence)) as { kind?: string; targetId?: string };
  const what: Record<string, string> = {
    merged: `merged into ${ev.targetId ?? "the target"}; ${asset} archived (restorable)`,
    retired: `${asset} retired and archived (restorable)`,
    renewed: `${asset} lease renewed`,
    promoted: `${asset} promoted to Team`,
    insight_built: "insight built",
    temporary_registered: "insight built",
    proposal_closed: `closed without a decision: ${asset} was archived`,
  };
  const outcome = String(r.last_action ?? status);
  const result = what[outcome];
  const head = status === "expired" ? "closed" : `${status}${actors}`;
  const archived = ["merged", "retired", "proposal_closed"].includes(outcome) && status !== "rejected";
  const open =
    outcome === "merged" && ev.targetId
      ? [
          { assetId: ev.targetId, note: "kept, users now go here" },
          { assetId: asset, note: "archived, restorable" },
        ]
      : asset
        ? [{ assetId: asset, note: archived ? "archived, restorable" : status === "rejected" ? "unchanged" : "updated" }]
        : [];
  return { status, outcome, summary: result && status !== "rejected" ? `${head}: ${result}` : head, open };
}


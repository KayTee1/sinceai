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
    const [states, pending, next, audit, assetNames, owners, portfolio] = await Promise.all([
      listAssetStates(client),
      listPendingProposals(client),
      nextDueEvent(client),
      getRecentAudit(client, 30),
      client.execute(`SELECT asset_id, asset_name FROM Analytics_Assets`),
      client.execute(`SELECT owner_id, owner_name, role, scope, status FROM Owners`),
      getPortfolioCounts(client),
    ]);
    // In-app views per app or team dashboard (manager relevance check, D20).
    const views = await client.execute({
      sql: `SELECT u.asset_id, COUNT(*) AS opens, COUNT(DISTINCT u.user_id) AS viewers,
                   SUM(u.sim_date > date(?, '-30 day')) AS last30, MAX(u.sim_date) AS lastOpened
            FROM usage_events u JOIN asset_state s ON s.asset_id = u.asset_id
            WHERE s.origin IN ('team', 'app') GROUP BY u.asset_id`,
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
    const boards = Object.fromEntries(
      states
        .filter((s) => s.origin === "team")
        .map((s) => [s.assetId, { tier: s.tier, status: s.status, leaseEnd: s.leaseEnd, ownerId: s.ownerId }]),
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
      portfolio,
      appUsage,
      boards,
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

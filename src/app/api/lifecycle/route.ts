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

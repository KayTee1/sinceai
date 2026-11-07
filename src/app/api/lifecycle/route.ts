import { connection } from "next/server";
import { db } from "@/db/client";
import { getRecentAudit, listAssetStates, listPendingProposals, nextDueEvent } from "@/services/lifecycle";
import { withLifecycle } from "@/lib/lifecycle-server";

// Clock, inbox, state counts and latest audit rows in one read for the UI.
export async function GET() {
  await connection();
  return withLifecycle(async (clock) => {
    const client = db();
    const [states, pending, next, audit] = await Promise.all([
      listAssetStates(client),
      listPendingProposals(client),
      nextDueEvent(client),
      getRecentAudit(client, 30),
    ]);
    const counts: Record<string, number> = {};
    for (const s of states) {
      const key = s.status === "archived" ? "archived" : s.tier;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return {
      clock: { date: clock.date, running: clock.running },
      nextDue: next?.date ?? null,
      counts,
      leaseDue: states.filter((s) => s.status === "lease_due").length,
      pending,
      audit,
    };
  });
}

import { connection } from "next/server";
import { db } from "@/db/client";
import { runSimulatedTriggers, simSettings, simulatedStatus } from "@/services/scheduler";
import { body } from "@/lib/lifecycle-server";
import { withScheduler, withSchedulerAction } from "@/lib/scheduler-server";

// B5 (T26): simulated-clock scheduling. GET: settings, the last simulated
// evaluation per job and whether each job is due at the stored date (read-only).
export async function GET() {
  await connection();
  return withScheduler(() => simulatedStatus(db()));
}

// { actor } — "Check due jobs now": runs the jobs due at the stored simulated
// date (never ticks the clock). Same gate as manual runs (SCHEDULER_DEMO_ACTIONS=1,
// manager). Repeating it at the same date runs nothing new (already_processed).
export async function POST(req: Request) {
  const b = await body(req);
  return withSchedulerAction(b.actor, async () => ({
    result: await runSimulatedTriggers(db(), { source: "manual_check", reassessEveryDays: simSettings().reassessEveryDays }),
  }));
}

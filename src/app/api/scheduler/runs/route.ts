import { connection } from "next/server";
import { db } from "@/db/client";
import { countRuns, listRuns, runIncremental } from "@/services/scheduler";
import { body } from "@/lib/lifecycle-server";
import { withScheduler, withSchedulerAction } from "@/lib/scheduler-server";

// Recent scheduler runs, newest first (?limit=, default 20).
export async function GET(req: Request) {
  await connection();
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 20) || 20;
  return withScheduler(async () => ({ runs: await listRuns(db(), { limit }), counts: await countRuns(db()) }));
}

// { actor } — manual incremental run. Manager only, and only with SCHEDULER_DEMO_ACTIONS=1 (see services/scheduler/access.ts).
// 200 with the finished run (succeeded or failed); 409 while another run is in progress.
export async function POST(req: Request) {
  const b = await body(req);
  return withSchedulerAction(b.actor, async (actor) => ({ run: await runIncremental(db(), { actor }) }));
}

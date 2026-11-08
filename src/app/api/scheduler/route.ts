import { connection } from "next/server";
import { db } from "@/db/client";
import { schedulerOverview } from "@/services/scheduler";
import { withScheduler } from "@/lib/scheduler-server";

// Scheduler overview: available job, checkpoint, run counts, latest run, finding counts.
export async function GET() {
  await connection();
  return withScheduler(() => schedulerOverview(db()));
}

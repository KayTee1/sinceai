import { connection } from "next/server";
import { db } from "@/db/client";
import { SchedulerError, getRun } from "@/services/scheduler";
import { withScheduler } from "@/lib/scheduler-server";

// One scheduler run with its window, assessments, finding counts and error.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;
  return withScheduler(async () => {
    const run = await getRun(db(), id);
    if (!run) throw new SchedulerError(`Unknown run ${id}`, "not_found");
    return { run };
  });
}

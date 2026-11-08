import { connection } from "next/server";
import { db } from "@/db/client";
import { SchedulerError, getFinding } from "@/services/scheduler";
import { withScheduler } from "@/lib/scheduler-server";

// One finding with its evidence and dismissal state.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;
  return withScheduler(async () => {
    const finding = await getFinding(db(), id);
    if (!finding) throw new SchedulerError(`Unknown finding ${id}`, "not_found");
    return { finding };
  });
}

import { db } from "@/db/client";
import { abandonRun } from "@/services/scheduler";
import { body } from "@/lib/lifecycle-server";
import { requireText, withSchedulerAction } from "@/lib/scheduler-server";

// { actor, reason } — marks a run left running by a crash as failed (audited). Manager only, demo gate.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req);
  return withSchedulerAction(b.actor, async (actor) => ({
    run: await abandonRun(db(), { runId: id, actor, reason: requireText(b.reason, "reason") }),
  }));
}

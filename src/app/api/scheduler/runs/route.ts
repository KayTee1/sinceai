import { connection } from "next/server";
import { db } from "@/db/client";
import { countRuns, listRuns, parseJobFilter, parseJobId, runJob } from "@/services/scheduler";
import { body } from "@/lib/lifecycle-server";
import { withScheduler, withSchedulerAction } from "@/lib/scheduler-server";

// Recent scheduler runs, newest first (?jobId= incremental_overlap | periodic_reassessment, ?limit=, default 20).
// Unknown jobId => 400. `counts` follow the same job filter.
export async function GET(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams;
  const limit = Number(q.get("limit") ?? 20) || 20;
  return withScheduler(async () => {
    const jobId = parseJobFilter(q.get("jobId"));
    return { runs: await listRuns(db(), { jobId, limit }), counts: await countRuns(db(), jobId) };
  });
}

// { actor, jobId? } — manual run of one job (default incremental_overlap; unknown jobId => 400).
// Manager only, and only with SCHEDULER_DEMO_ACTIONS=1 (see services/scheduler/access.ts).
// 200 with the finished run (succeeded or failed); 409 while another run of that job is in progress.
export async function POST(req: Request) {
  const b = await body(req);
  return withSchedulerAction(b.actor, async (actor) => ({ run: await runJob(db(), { jobId: parseJobId(b.jobId), actor }) }));
}

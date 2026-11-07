import { db } from "@/db/client";
import { runDuplicateScan } from "@/services/duplicates";
import { body, requireString, withLifecycle } from "@/lib/lifecycle-server";

// "Run scan now": the same scan the 10-day job runs (production: a real cron calls this).
export async function POST(req: Request) {
  const b = await body(req);
  return withLifecycle(async (clock) => runDuplicateScan(db(), clock.date, requireString(b.actor ?? "manager", "actor")));
}

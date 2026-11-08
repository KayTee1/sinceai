import { connection } from "next/server";
import { db } from "@/db/client";
import { latestRun } from "@/services/pipeline";
import { withLifecycle } from "@/lib/lifecycle-server";

// The newest request pipeline run with its step events (Pipeline view).
export async function GET() {
  await connection();
  return withLifecycle(async () => ({ run: await latestRun(db()) }));
}

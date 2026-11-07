import { connection } from "next/server";
import { db } from "@/db/client";
import { nextDueEvent } from "@/services/lifecycle";
import { withLifecycle } from "@/lib/lifecycle-server";

export async function GET() {
  await connection();
  return withLifecycle(async (clock) => ({
    clock: { date: clock.date, running: clock.running },
    nextDue: (await nextDueEvent(db()))?.date ?? null,
  }));
}

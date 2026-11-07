import { connection } from "next/server";
import { db } from "@/db/client";
import { listPendingProposals } from "@/services/lifecycle";
import { withLifecycle } from "@/lib/lifecycle-server";

// Approval inbox: open and escalated proposals.
export async function GET() {
  await connection();
  return withLifecycle(async () => ({ proposals: await listPendingProposals(db()) }));
}

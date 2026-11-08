import { connection } from "next/server";
import { db } from "@/db/client";
import { listFindings, type FindingStatus } from "@/services/scheduler";
import { withScheduler } from "@/lib/scheduler-server";

// Findings with evidence (?status=open|dismissed|resolved|superseded|any, ?assetId=, ?limit=); unknown status => 400.
export async function GET(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams;
  return withScheduler(() =>
    listFindings(db(), {
      status: (q.get("status") ?? "any") as FindingStatus | "any",
      assetId: q.get("assetId") ?? undefined,
      limit: Number(q.get("limit") ?? 50) || 50,
    }),
  );
}

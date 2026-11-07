import { connection } from "next/server";
import { db } from "@/db/client";
import { listFindings } from "@/services/scheduler";
import { withScheduler } from "@/lib/scheduler-server";

// Findings with evidence (?status=open|dismissed|any, ?assetId=, ?limit=).
export async function GET(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams;
  return withScheduler(() =>
    listFindings(db(), {
      status: (q.get("status") ?? "any") as "open" | "dismissed" | "any",
      assetId: q.get("assetId") ?? undefined,
      limit: Number(q.get("limit") ?? 50) || 50,
    }),
  );
}

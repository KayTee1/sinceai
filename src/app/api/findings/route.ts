import { connection } from "next/server";
import { db } from "@/db/client";
import { listFindings, listScanRuns, nextScanDate, fingerprinter } from "@/services/duplicates";
import { listAssetStates } from "@/services/lifecycle";
import { withLifecycle } from "@/lib/lifecycle-server";

// Scheduled findings (T20): duplicate groups from the 10-day scan, for triage.
export async function GET() {
  await connection();
  return withLifecycle(async () => {
    const client = db();
    const [findings, runs, next, states, assets] = await Promise.all([
      listFindings(client),
      listScanRuns(client),
      nextScanDate(client),
      listAssetStates(client),
      client.execute(`SELECT a.asset_id, a.asset_name, a.platform, a.asset_type, a.model_id, o.owner_name
                      FROM Analytics_Assets a LEFT JOIN Owners o ON o.owner_id = a.owner_id`),
    ]);
    const state = new Map(states.map((s) => [s.assetId, s]));
    const ids = new Set(findings.flatMap((f) => f.assetIds));
    const info = Object.fromEntries(
      assets.rows
        .filter((r) => ids.has(r.asset_id as string))
        .map((r) => [
          r.asset_id as string,
          {
            name: r.asset_name as string,
            platform: r.platform as string,
            type: r.asset_type as string,
            model: r.model_id as string | null,
            owner: (r.owner_name as string | null) ?? null,
            tier: state.get(r.asset_id as string)?.tier ?? null,
            status: state.get(r.asset_id as string)?.status ?? null,
          },
        ]),
    );
    return { findings, runs, nextScan: next, fingerprinter: fingerprinter.version, assets: info };
  });
}

// Demo fallback (no model): runs the governed request pipeline for one stored
// request, exactly as the chat's runRequestPipeline tool does, but with the
// template step summaries instead of the model's wording. The run appears in
// the Agentic › Pipeline view. It is NOT a live AI interaction; say so when used.
// Usage: npx tsx src/mastra/workflows/request-pipeline-cli.ts TEAM-REQ-01 [product market]
// Uses DATABASE_FILE (default data/private/steward.db); writes a pipeline run.
import { DB_FILE } from "../../db/paths";
import { openDb } from "../../db/open";
import { ensureLifecycle, tick } from "../../services/lifecycle";
import { createRequestPipeline, templateSummary } from "./request-pipeline";

async function main() {
  const [requestId, product, market] = process.argv.slice(2);
  if (!requestId) throw new Error("Usage: request-pipeline-cli.ts <REQUEST_ID> [product market]");
  const db = openDb(DB_FILE);
  try {
    const pipeline = createRequestPipeline({
      getDb: () => db,
      today: async (d) => {
        await ensureLifecycle(d);
        return (await tick(d)).date;
      },
      summarize: templateSummary,
    });
    const answer = product && market ? { product, market } : undefined;
    const r = await pipeline.run({ requestId, answer });
    console.log(`Deterministic fallback (no model): ${r.runId} · ${requestId} · path ${r.path ?? "none"} · ${r.status}`);
    console.log(`Recommendation: ${r.analysis?.recommendation.kind ?? "n/a"}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

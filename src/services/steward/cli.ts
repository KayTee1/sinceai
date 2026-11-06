// Prints the structured analysis for one business request as JSON.
// Usage: npx tsx src/services/steward/cli.ts REQ-0001 [product market]
// Reads DATABASE_FILE (default data/private/steward.db); never writes.
import { DB_FILE } from "../../db/paths";
import { openDb } from "../../db/open";
import { analyzeRequest } from "./analyze";

async function main() {
  const [id, product, market] = process.argv.slice(2);
  if (!id) throw new Error("Usage: cli.ts <REQUEST_ID> [product market]");
  const db = openDb(DB_FILE);
  try {
    const answer = product && market ? { product, market } : undefined;
    console.log(JSON.stringify(await analyzeRequest(db, id, answer), null, 2));
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

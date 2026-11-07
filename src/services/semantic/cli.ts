// Prints one KPI computation as JSON, with filters and provenance.
// Usage: npx tsx src/services/semantic/cli.ts <KPI_ID> <PRODUCT_IDS> <MARKET_IDS> <YYYY-MM-01> [value_type] [--by-market]
//   IDs are comma-separated, e.g. KPI-004 P-NUB DE,FR 2026-10-01
// Reads DATABASE_FILE (default data/private/steward.db); never writes.
import { DB_FILE } from "../../db/paths";
import { openDb } from "../../db/open";
import { computeKpi, computeKpiByMarket } from "./compute";
import type { ValueType } from "./types";

async function main() {
  const args = process.argv.slice(2);
  const byMarket = args.includes("--by-market");
  const [kpiId, products, markets, month, valueType] = args.filter((a) => a !== "--by-market");
  if (!kpiId || !products || !markets || !month) {
    throw new Error("Usage: cli.ts <KPI_ID> <PRODUCT_IDS> <MARKET_IDS> <YYYY-MM-01> [value_type] [--by-market]");
  }
  const query = {
    kpiId,
    productIds: products.split(","),
    marketIds: markets.split(","),
    month,
    valueType: valueType as ValueType | undefined,
  };
  const db = openDb(DB_FILE);
  try {
    const out = byMarket ? await computeKpiByMarket(db, query) : await computeKpi(db, query);
    console.log(JSON.stringify(out, null, 2));
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

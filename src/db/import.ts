// Imports the Bayer data pack (XLSX) into a new local SQLite file.
// Usage: npm run db:import [path/to/pack.xlsx]
// Never overwrites: if the database file exists, delete it first to reimport.
// See import-workbook.ts for validation and provenance details.
import readXlsxFile from "read-excel-file/node";
import { existsSync } from "node:fs";
import { DB_FILE } from "./paths";
import { importWorkbook } from "./import-workbook";

const XLSX = process.argv[2] ?? "data/private/pack.xlsx";

async function main() {
  if (!existsSync(XLSX)) throw new Error(`Workbook not found: ${XLSX}`);
  const sheets = await readXlsxFile(XLSX);
  const { dest, tables } = await importWorkbook({ sheets, dest: DB_FILE });
  for (const t of tables) console.log(`${t.name.padEnd(24)} ${t.rows} rows`);
  console.log(`\nWrote ${dest}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

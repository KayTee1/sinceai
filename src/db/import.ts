// Imports the Bayer data pack (XLSX) into a local SQLite file, read-only copy.
// Usage: npm run db:import [path/to/pack.xlsx]
import readXlsxFile from "read-excel-file/node";
import { createClient, type InValue } from "@libsql/client";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DB_FILE } from "./paths";

const XLSX = process.argv[2] ?? "data/private/pack.xlsx";
// Presentation sheets, not tables.
const SKIP = new Set(["START_HERE", "Package_Overview"]);

function toValue(v: unknown): InValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "boolean") return v ? 1 : 0;
  return v as InValue;
}

function columnType(values: unknown[]): "REAL" | "TEXT" {
  const present = values.filter((v) => v !== null && v !== undefined);
  return present.length > 0 && present.every((v) => typeof v === "number") ? "REAL" : "TEXT";
}

async function main() {
  if (!existsSync(XLSX)) throw new Error(`Workbook not found: ${XLSX}`);
  mkdirSync(dirname(DB_FILE), { recursive: true });
  rmSync(DB_FILE, { force: true });
  const db = createClient({ url: `file:${DB_FILE}` });

  const sheets = await readXlsxFile(XLSX);
  for (const { sheet, data } of sheets) {
    if (SKIP.has(sheet)) continue;
    const [header, ...rows] = data;
    const cols = (header as unknown[]).map(String);
    const types = cols.map((_, i) => columnType(rows.map((r) => r[i])));
    const ddl = cols.map((c, i) => `"${c}" ${types[i]}`).join(", ");
    const insert = `INSERT INTO "${sheet}" VALUES (${cols.map(() => "?").join(", ")})`;
    await db.batch(
      [
        `CREATE TABLE "${sheet}" (${ddl})`,
        ...rows.map((r) => ({ sql: insert, args: cols.map((_, i) => toValue(r[i])) })),
      ],
      "write",
    );
    console.log(`${sheet.padEnd(24)} ${rows.length} rows`);
  }
  db.close();
  console.log(`\nWrote ${DB_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

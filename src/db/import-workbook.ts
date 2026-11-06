// Non-destructive import of the Bayer builder pack into a new SQLite file.
//
// - Validates the parsed workbook first (sheet set, headers, row counts).
// - Writes to a temporary file next to the destination, then publishes it with
//   a hard link, which fails if the destination exists. An existing database
//   is never deleted or overwritten; on any failure the temporary file is
//   removed and the destination is left untouched.
// - Keeps every original column and value (blanks stay NULL, Excel dates are
//   ISO strings) and adds `_source_row`, the exact Excel row of each record.
import { createClient, type InValue } from "@libsql/client";
import { existsSync, linkSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { EXPECTED_ROW_COUNTS, PRESENTATION_SHEETS, SOURCE_ROW_COLUMN } from "./expected";

export type ParsedSheet = { sheet: string; data: unknown[][] };

export type ImportResult = { dest: string; tables: { name: string; rows: number }[] };

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class ImportError extends Error {}

export function validateSheets(
  sheets: ParsedSheet[],
  expected: Record<string, number> = EXPECTED_ROW_COUNTS,
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const { sheet, data } of sheets) {
    if (PRESENTATION_SHEETS.has(sheet)) continue;
    seen.add(sheet);
    if (!(sheet in expected)) {
      errors.push(`Unexpected sheet: ${sheet}`);
      continue;
    }
    if (!IDENTIFIER.test(sheet)) errors.push(`Sheet name not a plain identifier: ${sheet}`);
    const [header, ...rows] = data;
    if (!header || header.length === 0) {
      errors.push(`${sheet}: missing header row`);
      continue;
    }
    const cols = header.map((c) => (typeof c === "string" ? c.trim() : c));
    const names = new Set<string>();
    cols.forEach((c, i) => {
      if (typeof c !== "string" || c === "") errors.push(`${sheet}: empty header in column ${i + 1}`);
      else if (!IDENTIFIER.test(c)) errors.push(`${sheet}: header not a plain identifier: ${c}`);
      else if (c === SOURCE_ROW_COLUMN) errors.push(`${sheet}: header uses reserved name ${c}`);
      else if (names.has(c)) errors.push(`${sheet}: duplicate header ${c}`);
      else names.add(c);
    });
    if (rows.length !== expected[sheet]) {
      errors.push(`${sheet}: expected ${expected[sheet]} data rows, found ${rows.length}`);
    }
  }
  for (const sheet of Object.keys(expected)) {
    if (!seen.has(sheet)) errors.push(`Missing sheet: ${sheet}`);
  }
  return errors;
}

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

function removeDbFiles(file: string) {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
}

export async function importWorkbook(opts: {
  sheets: ParsedSheet[];
  dest: string;
  expected?: Record<string, number>;
}): Promise<ImportResult> {
  const { sheets, dest, expected = EXPECTED_ROW_COUNTS } = opts;
  if (existsSync(dest)) {
    throw new ImportError(`Refusing to overwrite existing database: ${dest}. Delete it first to reimport.`);
  }
  const errors = validateSheets(sheets, expected);
  if (errors.length > 0) {
    throw new ImportError(`Workbook failed validation; nothing written:\n- ${errors.join("\n- ")}`);
  }

  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  const tables: ImportResult["tables"] = [];
  try {
    const db = createClient({ url: `file:${tmp}` });
    try {
      for (const { sheet, data } of sheets) {
        if (PRESENTATION_SHEETS.has(sheet)) continue;
        const [header, ...rows] = data;
        const cols = header.map((c) => String(c).trim());
        const types = cols.map((_, i) => columnType(rows.map((r) => r[i])));
        const ddl = [...cols.map((c, i) => `"${c}" ${types[i]}`), `"${SOURCE_ROW_COLUMN}" INTEGER NOT NULL`].join(", ");
        const insert = `INSERT INTO "${sheet}" VALUES (${[...cols, SOURCE_ROW_COLUMN].map(() => "?").join(", ")})`;
        await db.batch(
          [
            `CREATE TABLE "${sheet}" (${ddl})`,
            // Header is Excel row 1, so data row i sits at row i + 2.
            ...rows.map((r, i) => ({ sql: insert, args: [...cols.map((_, c) => toValue(r[c])), i + 2] })),
          ],
          "write",
        );
        tables.push({ name: sheet, rows: rows.length });
      }
    } finally {
      db.close();
    }
    try {
      linkSync(tmp, dest); // fails with EEXIST instead of replacing
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ImportError(`Refusing to overwrite existing database: ${dest}. Delete it first to reimport.`);
      }
      throw err;
    }
  } finally {
    removeDbFiles(tmp);
  }
  return { dest, tables };
}

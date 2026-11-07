// TEAM-AUTHORED lifecycle fixture (ours, not Bayer data). Clock starts
// 2026-11-01; last_modified dates are chosen so each lease ends on a known day.
import type { ParsedSheet } from "../../src/db/import-workbook";

const sheet = (name: string, header: string[], rows: unknown[][]): ParsedSheet => ({ sheet: name, data: [header, ...rows] });

const asset = (id: string, owner: string | null, endorsement: string, lastModified: string) => [
  id, `Fixture ${id}`, "SM-1", "Alphazol", "DE", owner, "active", endorsement, "Dashboard", "Power BI", "WS-1", lastModified,
];

const usage = (id: string, users: number) =>
  ["2026-08-01", "2026-09-01", "2026-10-01"].map((m) => [id, m, users * 3, users]);

export const LIFECYCLE_SHEETS: ParsedSheet[] = [
  sheet("Owners", ["owner_id", "owner_name", "role", "scope", "status"], [
    ["OWN-1", "Active Owner", "Commercial Lead", "EMEA", "active"],
    ["OWN-2", "Inactive Owner", "Analyst", "EMEA", "inactive"],
    ["OWN-3", "Other Owner", "Analyst", "EMEA", "active"],
    ["OWN-S", "EMEA Steward", "Data Steward", "EMEA", "active"],
    ["OWN-G", "Global Steward", "Data Steward", "Global", "active"],
    ["OWN-L", "EMEA Lead", "Supply Analytics Lead", "EMEA", "active"],
  ]),
  sheet(
    "Analytics_Assets",
    [
      "asset_id", "asset_name", "model_id", "product_scope", "market_scope", "owner_id", "lifecycle_status", "endorsement",
      "asset_type", "platform", "workspace_id", "last_modified",
    ],
    [
      asset("AST-LOW", "OWN-1", "none", "2026-08-10"), // lease ends 2026-11-08; low usage -> retire
      asset("AST-HIGH", "OWN-1", "certified", "2026-08-12"), // lease ends 2026-11-10; renew
      asset("AST-INACT", "OWN-2", "none", "2026-08-10"), // inactive owner
      asset("AST-DEP", "OWN-1", "promoted", "2026-08-10"), // has downstream dependents
      asset("AST-NOOWN", null, "none", "2026-08-10"), // missing owner
      asset("AST-OLD", "OWN-1", "none", "2025-11-15"), // three whole periods -> lease ends 2026-11-10
    ],
  ),
  sheet("Asset_Usage", ["asset_id", "month", "views", "unique_users"], [
    ...usage("AST-LOW", 2),
    ...usage("AST-HIGH", 80),
    ...usage("AST-INACT", 1),
    ...usage("AST-DEP", 3),
    ...usage("AST-NOOWN", 0),
    ...usage("AST-OLD", 40),
  ]),
  sheet("Lineage_Edges", ["source_id", "target_id", "edge_type", "relationship"], [
    ["AST-DEP", "AST-HIGH", "ASSET_TO_ASSET", "embedded / derived"],
    ["SM-1", "AST-LOW", "MODEL_TO_ASSET", "semantic dependency"],
  ]),
];

export const LIFECYCLE_EXPECTED: Record<string, number> = Object.fromEntries(
  LIFECYCLE_SHEETS.map((s) => [s.sheet, s.data.length - 1]),
);

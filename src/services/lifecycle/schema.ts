// App-owned lifecycle tables. Imported pack tables are never written; these
// live next to them in the same SQLite file and can be reset for the demo.
import type { Client } from "@libsql/client";
import { CLOCK_START, LEASE_DAYS, POLICY_VERSION, TTL_DAYS, seededLeaseEnd } from "./policy";
import type { Tier } from "./types";

const APP_TABLES = [
  "app_clock",
  "asset_state",
  "proposals",
  "decisions",
  "audit_log",
  "archive_snapshots",
  "usage_events",
  "insights",
  "chat_requests",
  "runs",
  "run_events",
];

const DDL = [
  `CREATE TABLE IF NOT EXISTS app_clock (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     sim_date TEXT NOT NULL, running INTEGER NOT NULL, anchor_ms INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS asset_state (
     asset_id TEXT PRIMARY KEY, origin TEXT NOT NULL, name TEXT, owner_id TEXT,
     tier TEXT NOT NULL, status TEXT NOT NULL, lease_end TEXT, ttl_end TEXT,
     prev_tier TEXT, source_endorsement TEXT)`,
  `CREATE TABLE IF NOT EXISTS proposals (
     id TEXT PRIMARY KEY, version INTEGER NOT NULL, type TEXT NOT NULL, asset_ids TEXT NOT NULL,
     rationale TEXT NOT NULL, evidence TEXT NOT NULL, required_approvers TEXT NOT NULL,
     status TEXT NOT NULL, created_on TEXT NOT NULL, due_on TEXT)`,
  `CREATE TABLE IF NOT EXISTS decisions (
     proposal_id TEXT NOT NULL, version INTEGER NOT NULL, actor TEXT NOT NULL,
     action TEXT NOT NULL, reason TEXT, sim_date TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT, sim_date TEXT NOT NULL, actor TEXT NOT NULL,
     action TEXT NOT NULL, asset_id TEXT, proposal_id TEXT, policy_version TEXT,
     rationale TEXT NOT NULL, evidence TEXT, created_at TEXT NOT NULL)`,
  // Append-only: the database itself refuses edits and deletes.
  `CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
     BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
     BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END`,
  `CREATE TABLE IF NOT EXISTS archive_snapshots (
     asset_id TEXT NOT NULL, sim_date TEXT NOT NULL, snapshot TEXT NOT NULL)`,
  // Temporary insights built by the app (step 4): computed values with their
  // query, filters and source rows, so every number traces to source rows.
  `CREATE TABLE IF NOT EXISTS insights (
     id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, request_id TEXT NOT NULL, name TEXT NOT NULL,
     owner_id TEXT NOT NULL, scope TEXT NOT NULL, results TEXT NOT NULL, built_on TEXT NOT NULL, built_by TEXT NOT NULL)`,
  // App-generated usage, kept apart from the pack's Asset_Usage (D10).
  // T22: requests drafted from typed chat questions (ours, labelled; never in Business_Requests).
  `CREATE TABLE IF NOT EXISTS chat_requests (
     request_id TEXT PRIMARY KEY, request_date TEXT NOT NULL, product_context TEXT NOT NULL,
     market_context TEXT NOT NULL, request_text TEXT NOT NULL, created_on TEXT NOT NULL)`,
  // T23: request pipeline runs and their step events (ARCHITECTURE contract 1).
  `CREATE TABLE IF NOT EXISTS runs (
     run_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, scope TEXT, path TEXT, status TEXT NOT NULL,
     proposal_id TEXT, asset_id TEXT, created_on TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS run_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, step TEXT NOT NULL, agent TEXT NOT NULL,
     status TEXT NOT NULL, summary TEXT NOT NULL, evidence TEXT NOT NULL, ts TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS usage_events (
     asset_id TEXT NOT NULL, user_id TEXT NOT NULL, sim_date TEXT NOT NULL, origin TEXT NOT NULL)`,
];

// Initial tier mapping is a team assumption (SCOPE, Data).
export const TIER_BY_ENDORSEMENT: Record<string, Tier> = { certified: "certified", promoted: "team", none: "personal" };

export async function hasLifecycle(db: Client): Promise<boolean> {
  const r = await db.execute(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_clock'`);
  if (r.rows.length === 0) return false;
  return (await db.execute(`SELECT 1 FROM app_clock`)).rows.length > 0;
}

/** Creates and seeds the lifecycle tables once. Safe to call on every request. */
export async function ensureLifecycle(db: Client, nowMs = Date.now()): Promise<void> {
  if (await hasLifecycle(db)) {
    // Already seeded: only add tables introduced since (all CREATE IF NOT EXISTS).
    await db.batch(DDL, "write");
    await removeTeamBoards(db);
    return;
  }
  await seed(db, nowMs);
}

/** Demo reset: drops app-owned tables (including the audit log) and reseeds. Pack tables are untouched. */
export async function resetLifecycle(db: Client, nowMs = Date.now()): Promise<void> {
  await db.batch(APP_TABLES.map((t) => `DROP TABLE IF EXISTS ${t}`), "write");
  await seed(db, nowMs);
}

// D22 replaces D20: employees open the real catalog dashboards, so the four
// team boards (origin "team", DSH-*) are no longer seeded. Remove them from
// databases seeded before; app-owned rows only, the audit log is untouched.
async function removeTeamBoards(db: Client) {
  await db.batch(
    [
      `DELETE FROM proposals WHERE json_extract(asset_ids, '$[0]') IN (SELECT asset_id FROM asset_state WHERE origin = 'team')`,
      `DELETE FROM usage_events WHERE asset_id IN (SELECT asset_id FROM asset_state WHERE origin = 'team')`,
      `DELETE FROM asset_state WHERE origin = 'team'`,
    ],
    "write",
  );
}

async function seed(db: Client, nowMs: number) {
  const assets = await db.execute(`SELECT asset_id, owner_id, endorsement, last_modified FROM Analytics_Assets`);
  await db.batch(
    [
      ...DDL,
      `DELETE FROM asset_state`,
      `DELETE FROM app_clock`,
      // Starts paused after reset (D12).
      { sql: `INSERT INTO app_clock (id, sim_date, running, anchor_ms) VALUES (1, ?, 0, ?)`, args: [CLOCK_START, nowMs] },
      ...assets.rows.map((a) => ({
        sql: `INSERT INTO asset_state (asset_id, origin, owner_id, tier, status, lease_end, source_endorsement)
              VALUES (?, 'pack', ?, ?, 'active', ?, ?)`,
        args: [
          a.asset_id as string,
          (a.owner_id as string | null) ?? null,
          TIER_BY_ENDORSEMENT[a.endorsement as string] ?? "personal",
          seededLeaseEnd(a.last_modified as string | null, CLOCK_START),
          a.endorsement as string,
        ],
      })),
      {
        sql: `INSERT INTO audit_log (sim_date, actor, action, rationale, policy_version, created_at)
              VALUES (?, 'system', 'lifecycle_reset', ?, ?, ?)`,
        args: [
          CLOCK_START,
          `Seeded ${assets.rows.length} imported assets; leases ${LEASE_DAYS} days from last_modified periods, TTL ${TTL_DAYS} days for Temporary.`,
          POLICY_VERSION,
          new Date(nowMs).toISOString(),
        ],
      },
    ],
    "write",
  );
}

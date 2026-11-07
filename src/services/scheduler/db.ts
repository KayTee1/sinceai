// Scheduler database access (T24): short write transactions on
// scheduler-owned connections, and a scheduler-owned read client for
// evaluation. The app's shared client (src/db/client.ts) is only read to find
// the database file; the scheduler never writes through it or closes it.
//
// Driver behaviour this relies on (libsql 0.5.29 / @libsql/client 0.18, local
// file, rollback journal; reproduced for T24 F1 and pinned in
// tests/scheduler.test.ts "driver behaviour"):
// - A statement that fails with SQLITE_BUSY stays resumable inside its native
//   connection until it is run again or garbage-collected. ROLLBACK,
//   interrupt() and closing the connection do not end it.
// - A failed BEGIN IMMEDIATE holds no lock: other connections read and write
//   normally. Only reusing that connection fails later ("cannot commit
//   transaction - SQL statements in progress"). @libsql/client puts such a
//   connection back in its pool, which is how the first B1 version stayed
//   stuck after the other writer had finished.
// - A COMMIT that fails with SQLITE_BUSY (another connection holds a read
//   lock) keeps its lock, blocking every other writer, until that same
//   statement object is run again. After ROLLBACK, running it again fails
//   with "no transaction is active" and the lock is released.
// - A non-BUSY error inside a transaction (constraint, RAISE) followed by
//   ROLLBACK leaves no lock.
// - The driver's busy timeout is a synchronous wait that blocks the Node event
//   loop, so a lock held elsewhere in this process cannot clear during it.
//   Lock waits here are asynchronous retries instead.
//
// So every attempt opens its own connection and closes it afterwards, and:
// - BEGIN IMMEDIATE fails busy: nothing is held; the connection is closed and
//   never reused; the next attempt opens a new one.
// - Inside the transaction no statement needs more than the RESERVED lock
//   (cache_spill is off, so pages are not written to the file before COMMIT),
//   so none can fail busy; readers are not blocked while `fn` runs.
// - COMMIT fails: roll back, run the same COMMIT statement once more so it
//   releases its lock now, close. If it failed busy the whole attempt is
//   retried (`fn` runs again from fresh reads); otherwise the error is thrown.
// No garbage collection, interrupt or shared-client close is involved, and a
// lock is never held across an asynchronous wait. `fn` must only run
// statements on `tx` (no timers or network) so the transaction stays short.
import Database from "libsql";
import { createClient, type Client, type InArgs, type InStatement, type ResultSet, type Transaction } from "@libsql/client";
import { SchedulerError } from "./types";

/** Total lock wait before giving up (ms). */
export const LOCK_WAIT_MS = 2_000;

/**
 * Tests only: shorten the lock wait, see each scheduler-owned write connection
 * right after it opens, or observe which statement met SQLITE_BUSY.
 */
export const schedulerDbTesting: {
  lockWaitMs: number;
  onOpen?: (conn: Database.Database) => void;
  onBusy?: (statement: "BEGIN" | "COMMIT") => void;
} = { lockWaitMs: LOCK_WAIT_MS };

export const isBusy = (err: unknown) =>
  (err as { code?: unknown })?.code === "SQLITE_BUSY" || /SQLITE_BUSY|database is locked/i.test(String((err as Error)?.message ?? err));

/** The lock stayed taken for the whole wait. Nothing of the transaction was written. */
export class LockTimeoutError extends SchedulerError {
  constructor(waitedMs: number) {
    super("The database stayed busy; try again", "conflict", { lockWaitMs: waitedMs });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const files = new WeakMap<Client, string>();

/** The file behind the app's client (PRAGMA database_list), so the scheduler can open its own connections to it. */
export async function databaseFile(db: Client): Promise<string> {
  const known = files.get(db);
  if (known) return known;
  const r = await db.execute(`SELECT file FROM pragma_database_list WHERE name = 'main'`);
  const file = (r.rows[0]?.file as string | undefined) ?? "";
  if (!file) throw new SchedulerError("The scheduler needs a file database (an in-memory database has no file to open)", "invalid");
  files.set(db, file);
  return file;
}

// Positional values only, converted as @libsql/client does for the types scheduler and lifecycle code pass.
function bind(args: InArgs | undefined): unknown[] {
  if (!args) return [];
  if (!Array.isArray(args)) throw new SchedulerError("Named arguments are not supported in scheduler transactions", "invalid");
  return args.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v instanceof Date ? v.valueOf() : v));
}

function result(rows: Record<string, unknown>[], rowsAffected: number, lastInsertRowid?: bigint): ResultSet {
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  return {
    columns,
    columnTypes: columns.map(() => ""),
    rows: rows as unknown as ResultSet["rows"],
    rowsAffected,
    lastInsertRowid,
    toJSON: () => ({ columns, rows, rowsAffected }),
  };
}

function exec(conn: Database.Database, stmt: InStatement): ResultSet {
  const { sql, args } = typeof stmt === "string" ? { sql: stmt, args: undefined } : stmt;
  const s = conn.prepare(sql);
  if (s.reader) return result(s.all(bind(args)) as Record<string, unknown>[], 0);
  const info = s.run(bind(args));
  return result([], info.changes, BigInt(info.lastInsertRowid));
}

/**
 * The transaction `fn` gets: `execute` (rows by column name) on the
 * scheduler's connection. Commit, rollback and close belong to writeTx; the
 * other methods are unused by scheduler and lifecycle code and fail loudly.
 */
function txOn(conn: Database.Database): Transaction {
  const unsupported = (name: string) => () => {
    throw new SchedulerError(`${name} is not available inside a scheduler transaction`, "invalid");
  };
  const tx = {
    execute: async (stmtOrSql: InStatement, args?: InArgs) => exec(conn, typeof stmtOrSql === "string" ? { sql: stmtOrSql, args } : stmtOrSql),
    batch: unsupported("batch"),
    executeMultiple: unsupported("executeMultiple"),
    rollback: unsupported("rollback"),
    commit: unsupported("commit"),
    close: unsupported("close"),
    closed: false,
  };
  return tx as unknown as Transaction;
}

function rollbackQuietly(conn: Database.Database) {
  try {
    if (conn.inTransaction) conn.prepare("ROLLBACK").run();
  } catch {
    // The connection is closed right after.
  }
}

type Attempt<T> = { busy: true } | { busy: false; out: T };

async function attempt<T>(conn: Database.Database, fn: (tx: Transaction) => Promise<T>): Promise<Attempt<T>> {
  conn.exec("PRAGMA cache_spill = OFF");
  try {
    conn.prepare("BEGIN IMMEDIATE").run();
  } catch (err) {
    if (!isBusy(err)) throw err;
    schedulerDbTesting.onBusy?.("BEGIN");
    return { busy: true };
  }
  let out: T;
  try {
    out = await fn(txOn(conn));
  } catch (err) {
    rollbackQuietly(conn);
    throw err;
  }
  const commit = conn.prepare("COMMIT");
  try {
    commit.run();
  } catch (err) {
    rollbackQuietly(conn);
    try {
      commit.run(); // ends the failed COMMIT so it gives up its lock now; "no transaction is active" is expected
    } catch {
      // expected
    }
    if (!isBusy(err)) throw err;
    schedulerDbTesting.onBusy?.("COMMIT");
    return { busy: true };
  }
  return { busy: false, out };
}

/**
 * Runs `fn` in a write transaction on a scheduler-owned connection and
 * commits; rolls back on any error. Waits for the lock with asynchronous
 * retries, each on a new connection, and throws LockTimeoutError once the
 * wait is spent (nothing of `fn` is then committed).
 */
export async function writeTx<T>(db: Client, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const file = await databaseFile(db);
  const wait = schedulerDbTesting.lockWaitMs;
  const deadline = Date.now() + wait;
  for (let i = 0; ; i++) {
    const conn = new Database(file);
    try {
      schedulerDbTesting.onOpen?.(conn);
      const r = await attempt(conn, fn);
      if (!r.busy) return r.out;
    } finally {
      conn.close();
    }
    if (Date.now() >= deadline) throw new LockTimeoutError(wait);
    await sleep(Math.min(10 * 2 ** i, 200) + Math.floor(Math.random() * 10));
  }
}

/**
 * Runs read-only `fn` on a scheduler-owned client that is closed afterwards,
 * so a read that fails (e.g. SQLITE_BUSY during another process's commit)
 * cannot leave a poisoned connection in the app's shared pool.
 */
export async function withReadClient<T>(db: Client, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = createClient({ url: `file:${await databaseFile(db)}` });
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

// Scheduler write transactions: short, serialized in-process, with a bounded
// wait for the SQLite write lock.
//
// Why serialize: with @libsql/client 0.18 / libsql 0.5 on a local file, a
// statement that fails with SQLITE_BUSY (BEGIN IMMEDIATE, or a write inside a
// deferred transaction) keeps its read lock until the statement object is
// garbage-collected, even after ROLLBACK. Until then every COMMIT on the
// file fails with SQLITE_BUSY (reproduced while building T24). So scheduler
// writes in this process never race each other for the lock: they queue
// here. The partial unique index on scheduler_runs still guards against a
// second process.
//
// Why also wait: another process (a CLI next to the dev server) can hold the
// lock briefly. Each attempt rolls back fully and re-runs `fn`, which reads
// its state afresh. This is a lock wait, not a stale-run timeout. When the
// budget is spent the caller gets SchedulerError("conflict").
import type { Client, Transaction } from "@libsql/client";
import { SchedulerError } from "./types";

/** Total lock wait before giving up (ms). */
export const LOCK_WAIT_MS = 2_000;

export const isBusy = (err: unknown) => /SQLITE_BUSY|database is locked/i.test(String((err as Error)?.message ?? err));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let queue: Promise<unknown> = Promise.resolve();

/** Runs `fn` after every scheduler write queued before it has settled. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

async function withLockWait<T>(attempt: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (!isBusy(err)) throw err;
      if (Date.now() >= deadline) throw new SchedulerError("The database stayed busy; try again", "conflict");
      await sleep(Math.min(10 * 2 ** i, 200) + Math.floor(Math.random() * 10));
    }
  }
}

/** Runs `fn` in a write transaction and commits; rolls back on any error. */
export function writeTx<T>(db: Client, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return serialized(() =>
    withLockWait(async () => {
      const tx = await db.transaction("write");
      try {
        const out = await fn(tx);
        await tx.commit();
        return out;
      } catch (err) {
        await tx.rollback().catch(() => undefined);
        throw err;
      } finally {
        tx.close();
      }
    }),
  );
}

/** A single autocommit statement, queued and waited the same way. */
export function writeOne(db: Client, stmt: { sql: string; args: (string | number | null)[] }) {
  return serialized(() => withLockWait(() => db.execute(stmt)));
}

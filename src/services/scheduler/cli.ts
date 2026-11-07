// Operator CLI for the governance scheduler (T24). Whoever can run this can
// already write the database file, so it is the authorized manual path while
// HTTP actions are off (see access.ts).
// Usage (reads DATABASE_FILE, default data/private/steward.db):
//   npx tsx src/services/scheduler/cli.ts status
//   npx tsx src/services/scheduler/cli.ts run <actor>
//   npx tsx src/services/scheduler/cli.ts findings [open|dismissed|any]
//   npx tsx src/services/scheduler/cli.ts dismiss <findingId> <actor> <reason...>
//   npx tsx src/services/scheduler/cli.ts abandon <runId> <actor> <reason...>
import { DB_FILE } from "../../db/paths";
import { openDb } from "../../db/open";
import { abandonRun, dismissFinding, listFindings, runIncremental, schedulerOverview } from "./index";

async function main() {
  const [cmd, a, b, ...rest] = process.argv.slice(2);
  const db = openDb(DB_FILE);
  try {
    let out: unknown;
    if (cmd === "status") out = await schedulerOverview(db);
    else if (cmd === "run" && a) out = await runIncremental(db, { actor: a });
    else if (cmd === "findings") out = await listFindings(db, { status: (a as "open" | "dismissed" | "any" | undefined) ?? "open" });
    else if (cmd === "dismiss" && a && b) out = await dismissFinding(db, { findingId: a, actor: b, reason: rest.join(" ") });
    else if (cmd === "abandon" && a && b) out = await abandonRun(db, { runId: a, actor: b, reason: rest.join(" ") });
    else throw new Error("Usage: cli.ts status | run <actor> | findings [status] | dismiss <findingId> <actor> <reason> | abandon <runId> <actor> <reason>");
    console.log(JSON.stringify(out, null, 2));
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

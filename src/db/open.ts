import { createClient, type Client } from "@libsql/client";
import { existsSync } from "node:fs";

// Opens an existing SQLite file without the Next.js `server-only` guard, so
// backend services can be called from scripts and tests. Services take the
// Client as a parameter; the app keeps using src/db/client.ts. Refuses a
// missing file instead of silently creating an empty database.
export function openDb(file: string): Client {
  if (!existsSync(file)) throw new Error(`Database not found: ${file}. Run npm run db:import first.`);
  return createClient({ url: `file:${file}` });
}

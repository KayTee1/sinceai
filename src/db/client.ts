import "server-only";
import { createClient, type Client } from "@libsql/client";
import { DB_FILE } from "./paths";

let client: Client | undefined;

export function db(): Client {
  client ??= createClient({ url: `file:${DB_FILE}` });
  return client;
}

export async function rows<T>(sql: string, args: (string | number | null)[] = []): Promise<T[]> {
  const res = await db().execute({ sql, args });
  return res.rows as unknown as T[];
}

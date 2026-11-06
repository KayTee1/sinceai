import path from "node:path";

// Absolute path so `next dev`, scripts and Mastra all open the same file.
export const DB_FILE = path.resolve(
  /* turbopackIgnore: true */ process.cwd(),
  process.env.DATABASE_FILE ?? "data/private/steward.db",
);

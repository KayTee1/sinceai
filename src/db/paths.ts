import path from "node:path";

// Absolute path so `next dev`, scripts and Mastra all open the same file.
// An empty DATABASE_FILE (as in .env.example) falls back to the default.
export const DB_FILE = path.resolve(
  /* turbopackIgnore: true */ process.cwd(),
  process.env.DATABASE_FILE?.trim() || "data/private/steward.db",
);

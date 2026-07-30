import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 CLI config. The runtime client connects through the
// better-sqlite3 driver adapter in src/db.ts; this file serves the CLI
// (migrate / generate / seed).
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    // Mirrors FNB_DB_FILE in src/db.ts so migrate/seed can target a throwaway db.
    url: `file:${process.env.FNB_DB_FILE ?? path.join("data", "fnb.db")}`,
  },
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
});

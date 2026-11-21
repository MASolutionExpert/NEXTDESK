import { detectRunningServer } from "./_db-admin.ts";
import { runDatabaseMigrations, getAppliedMigrations } from "../db/migrate.ts";
import { closeDatabase } from "../db/prisma.ts";

const startedAt = Date.now();
const allowOnline =
  process.argv.includes("--allow-online") ||
  process.env.ALLOW_ONLINE_MIGRATE === "true";

if (!allowOnline) {
  const { running, port } = await detectRunningServer();
  if (running) {
    console.error(
      `Refusing to run migrations while server is running on port ${port}. Stop the server first (or pass --allow-online).`,
    );
    process.exit(1);
  }
}

console.log("[db-migrations] Checking PostgreSQL schema & Prisma 7 migrations...");
try {
  const result = await runDatabaseMigrations({
    backupBeforeMigrate: process.env.NODE_ENV === "production",
    quiet: false,
  });
  const applied = await getAppliedMigrations().catch(() => []);
  console.log(
    `[db-migrations] Complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s. ` +
      `Baseline applied: ${result.baselined ? "yes" : "no"}. ` +
      `Applied Prisma migrations: ${applied.length}.`,
  );
  await closeDatabase().catch(() => {});
  process.exit(0);
} catch (error: any) {
  console.error(String(error?.message || error));
  console.error("[db-migrations] Migration FAILED. Live database was not modified beyond the failed step.");
  await closeDatabase().catch(() => {});
  process.exit(1);
}

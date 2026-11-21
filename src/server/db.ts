import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  projectRootDir,
  serverRootDir,
  describePgTarget,
  getPostgresTimeouts,
  resolveDatabaseUrl,
} from "./db/connectionConfig.ts";
import {
  prisma,
  pgPool,
  pgQuery,
  pgGetRow,
  pgGetAll,
  pgRun,
  withPgTransaction,
  withPrismaTransaction,
  closeDatabase,
} from "./db/prisma.ts";
import {
  runDatabaseMigrations,
  runPostgresPreflight,
  getAppliedMigrations,
} from "./db/migrate.ts";
import { ensureSystemSecrets } from "./lib/secrets.ts";

// Re-export Prisma 7 + PostgreSQL primitives
export {
  prisma,
  pgPool,
  pgQuery,
  pgGetRow,
  pgGetAll,
  pgRun,
  withPgTransaction,
  withPrismaTransaction,
  closeDatabase,
  describePgTarget,
  getPostgresTimeouts,
  resolveDatabaseUrl,
  runDatabaseMigrations,
  runPostgresPreflight,
  getAppliedMigrations,
};

// Re-export all domain repositories
export * from "./db/usersRepo.ts";
export * from "./db/chatsRepo.ts";
export * from "./db/messagesRepo.ts";
export * from "./db/remoteChannelsRepo.ts";
export * from "./db/adminRepo.ts";

const dataDir = path.resolve(
  process.env.DATA_DIR || path.resolve(projectRootDir, "data"),
);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * NextDesk is exclusively PostgreSQL-backed via Prisma 7.
 * Retained as a constant-true helper for compatibility with callers.
 */
export function isPostgresMode(): boolean {
  return true;
}

export function getRow(sql: string, params: unknown = []) {
  return pgGetRow(sql, params);
}

export function getAll(sql: string, params: unknown = []) {
  return pgGetAll(sql, params);
}

export function run(sql: string, params: unknown = []) {
  return pgRun(sql, params);
}

export function adminGetRow(sql: string, params: unknown = []) {
  return pgGetRow(sql, params);
}

export function adminGetAll(sql: string, params: unknown = []) {
  return pgGetAll(sql, params);
}

export function adminRun(sql: string, params: unknown = []) {
  return pgRun(sql, params);
}

export function adminSave(): void {
  // No-op: PostgreSQL persists every committed transaction durably.
}

export async function adminTransaction<T>(
  callback: (queryRun: (sql: string, params?: unknown) => Promise<any>) => Promise<T>,
): Promise<T> {
  return withPgTransaction(async (tx) => {
    const queryRun = (sql: string, params: unknown = []) => tx.query(sql, params);
    return callback(queryRun);
  });
}

export async function getCurrentSchemaVersion(): Promise<number> {
  const applied = await getAppliedMigrations().catch(() => []);
  return applied.length;
}

// Automatically apply pending Prisma 7 migrations & ensure system secrets on boot.
// Guarded so `next build` static analysis never attempts a live DB connection.
const shouldSkipAutoInit =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.SKIP_DB_INIT === "true";

if (!shouldSkipAutoInit) {
  if (process.env.SKIP_AUTO_MIGRATE !== "true") {
    await runDatabaseMigrations({
      backupBeforeMigrate: process.env.NODE_ENV === "production",
      quiet: process.env.NODE_ENV === "test",
    });
  }
  await ensureSystemSecrets({
    dbRun: pgRun,
    dbGetRow: pgGetRow,
    projectRootDir,
    serverDir: serverRootDir,
    fsImpl: fs,
    pathImpl: path,
    cryptoImpl: crypto,
  });
}

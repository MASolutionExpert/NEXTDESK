import { pgGetAll, pgGetRow, pgRun } from "../../../src/server/db/prisma.ts";
import { runDatabaseMigrations } from "../../../src/server/db/migrate.ts";

let migrationsReadyPromise: Promise<void> | null = null;

async function ensureSchemaReady(): Promise<void> {
  if (!migrationsReadyPromise) {
    migrationsReadyPromise = runDatabaseMigrations({
      backupBeforeMigrate: false,
      quiet: true,
    }).then(() => undefined);
  }
  await migrationsReadyPromise;
}

const TRUNCATE_TABLES = [
  "admin_audit_logs",
  "remote_channel_queue",
  "remote_channel_provider_state",
  "remote_channel_sources",
  "pending_presigned_uploads",
  "push_subscriptions",
  "hidden_chat_messages",
  "chat_message_reads",
  "chat_message_files",
  "chat_messages",
  "chat_mutes",
  "chat_left_members",
  "group_removed_members",
  "hidden_chats",
  "chat_members",
  "sessions",
  "chats",
  "users",
  "departments",
  "app_settings",
  "meta",
];

export async function resetTestTables(): Promise<void> {
  await ensureSchemaReady();
  await pgRun(
    `TRUNCATE TABLE ${TRUNCATE_TABLES.join(", ")} RESTART IDENTITY CASCADE`,
  );
}

export async function createTestDb(options: { truncate?: boolean } = {}) {
  await ensureSchemaReady();
  if (options.truncate !== false) {
    await resetTestTables();
  }

  return {
    run: (sql: string, params: unknown[] = []) => pgRun(sql, params),
    getRow: (sql: string, params: unknown[] = []) => pgGetRow(sql, params),
    getAll: (sql: string, params: unknown[] = []) => pgGetAll(sql, params),
    async tableExists(tableName: string): Promise<boolean> {
      const row = await pgGetRow<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ?
        ) AS exists`,
        [tableName],
      );
      return Boolean(row?.exists);
    },
    async hasColumn(tableName: string, columnName: string): Promise<boolean> {
      const row = await pgGetRow<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ? AND column_name = ?
        ) AS exists`,
        [tableName, columnName],
      );
      return Boolean(row?.exists);
    },
    // Shared pgPool stays alive across Vitest files; close is a safe no-op.
    close() {},
  };
}

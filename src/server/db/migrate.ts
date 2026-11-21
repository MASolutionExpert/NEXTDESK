import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  describePgTarget,
  getPostgresTimeouts,
  projectRootDir,
  resolveDatabaseUrl,
} from "./connectionConfig.ts";
import { pgGetAll, pgGetRow, pgQuery, pgRun } from "./prisma.ts";

const dataDir = path.resolve(
  process.env.DATA_DIR || path.resolve(projectRootDir, "data"),
);
const backupDir = path.join(dataDir, "backups");

export const BASELINE_MIGRATION_NAME = "0001_init";

/**
 * Additive, 100% non-destructive column guards for existing live NextDesk
 * PostgreSQL databases upgrading from older pre-Prisma schemas.
 * NEVER drops tables, NEVER truncates data, NEVER runs destructive resets.
 */
const ADDITIVE_COLUMN_GUARDS: Array<[string, string, string]> = [
  ["users", "nickname", "TEXT"],
  ["users", "avatar_url", "TEXT"],
  ["users", "avatar_storage_driver", "TEXT DEFAULT 'local'"],
  ["users", "avatar_storage_key", "TEXT"],
  ["users", "avatar_encryption_type", "TEXT DEFAULT 'none'"],
  ["users", "color", "TEXT"],
  ["users", "status", "TEXT NOT NULL DEFAULT 'online'"],
  ["users", "role", "TEXT NOT NULL DEFAULT 'user'"],
  ["users", "banned", "INTEGER NOT NULL DEFAULT 0"],
  ["users", "verified", "INTEGER NOT NULL DEFAULT 0"],
  ["users", "department_id", "INTEGER"],
  ["users", "language", "TEXT NOT NULL DEFAULT 'fa'"],
  ["users", "last_seen", "TEXT"],
  ["chats", "group_username", "TEXT"],
  ["chats", "group_visibility", "TEXT NOT NULL DEFAULT 'public'"],
  ["chats", "invite_token", "TEXT"],
  ["chats", "created_by_user_id", "TEXT"],
  ["chats", "group_color", "TEXT"],
  ["chats", "allow_member_invites", "INTEGER NOT NULL DEFAULT 1"],
  ["chats", "group_avatar_url", "TEXT"],
  ["chats", "verified", "INTEGER NOT NULL DEFAULT 0"],
  ["chats", "auto_add_new_users", "INTEGER NOT NULL DEFAULT 0"],
  ["chats", "department_id", "INTEGER"],
  ["chat_messages", "client_request_id", "TEXT"],
  ["chat_messages", "read_at", "TEXT"],
  ["chat_messages", "read_by_user_id", "TEXT"],
  ["chat_messages", "reply_to_message_id", "TEXT"],
  ["chat_messages", "edited", "INTEGER NOT NULL DEFAULT 0"],
  ["chat_messages", "edited_body", "TEXT"],
  ["chat_messages", "hidden_everyone_at", "TEXT"],
  ["chat_messages", "forwarded_from_chat_id", "TEXT"],
  ["chat_messages", "forwarded_from_label", "TEXT"],
  ["chat_messages", "forwarded_from_user_id", "TEXT"],
  ["chat_messages", "forwarded_from_username", "TEXT"],
  ["chat_messages", "forwarded_from_avatar_url", "TEXT"],
  ["chat_messages", "forwarded_from_color", "TEXT"],
  ["chat_messages", "expires_at", "TEXT"],
  ["chat_message_files", "width_px", "INTEGER"],
  ["chat_message_files", "height_px", "INTEGER"],
  ["chat_message_files", "duration_seconds", "DOUBLE PRECISION"],
  ["chat_message_files", "expires_at", "TEXT"],
  ["chat_message_files", "storage_driver", "TEXT DEFAULT 'local'"],
  ["chat_message_files", "storage_key", "TEXT"],
  ["chat_message_files", "processing_status", "TEXT DEFAULT 'ready'"],
  ["chat_message_files", "blurhash", "TEXT"],
  ["chat_message_files", "waveform", "TEXT"],
  ["chat_message_files", "thumb_storage_key", "TEXT"],
  ["chat_message_files", "encryption_type", "TEXT DEFAULT 'none'"],
  ["push_subscriptions", "message_preview", "INTEGER NOT NULL DEFAULT 1"],
  ["remote_channel_sources", "source_url", "TEXT"],
  ["remote_channel_sources", "source_title", "TEXT"],
  ["remote_channel_sources", "source_avatar_url", "TEXT"],
  ["remote_channel_sources", "last_remote_message_id", "INTEGER"],
  ["remote_channel_sources", "source_version", "INTEGER NOT NULL DEFAULT 1"],
  ["remote_channel_sources", "sync_metadata", "INTEGER NOT NULL DEFAULT 0"],
  ["remote_channel_sources", "stream_media", "INTEGER NOT NULL DEFAULT 0"],
  ["remote_channel_sources", "paused", "INTEGER NOT NULL DEFAULT 0"],
  ["remote_channel_queue", "source_version", "INTEGER NOT NULL DEFAULT 1"],
];

const TIMESTAMP_DEFAULT_COLUMNS: Array<[string, string]> = [
  ["admin_audit_logs", "ts"],
  ["chat_left_members", "left_at"],
  ["chat_message_files", "created_at"],
  ["chat_message_reads", "read_at"],
  ["chat_messages", "created_at"],
  ["chat_mutes", "updated_at"],
  ["chats", "created_at"],
  ["departments", "created_at"],
  ["group_removed_members", "removed_at"],
  ["hidden_chat_messages", "hidden_at"],
  ["hidden_chats", "hidden_at"],
  ["pending_presigned_uploads", "created_at"],
  ["push_subscriptions", "created_at"],
  ["push_subscriptions", "updated_at"],
  ["remote_channel_provider_state", "updated_at"],
  ["remote_channel_queue", "created_at"],
  ["remote_channel_sources", "created_at"],
  ["remote_channel_sources", "updated_at"],
  ["sessions", "created_at"],
  ["sessions", "last_seen"],
  ["users", "created_at"],
];

export async function runPostgresPreflight(): Promise<void> {
  const target = describePgTarget();
  const timeouts = getPostgresTimeouts();
  const startedAt = Date.now();
  try {
    await pgQuery("SELECT 1");
  } catch (error: any) {
    const elapsedMs = Date.now() - startedAt;
    const code = error?.code || error?.cause?.code || "";
    const detail = error?.message || String(error);
    const targetSummary = `${target.user}@${target.host}:${target.port}/${target.database} (ssl=${target.ssl ? "on" : "off"})`;
    throw new Error(
      `PostgreSQL preflight failed after ${elapsedMs}ms for ${targetSummary}${code ? ` [${code}]` : ""}: ${detail}\n` +
        `  Configured timeouts: connect=${timeouts.connectionTimeoutMs}ms, statement=${timeouts.statementTimeoutMs}ms.\n` +
        `  Check DATABASE_URL / POSTGRES_URL / POSTGRES_* in .env and verify PostgreSQL is running.`,
    );
  }
}

export function createPostgresPreMigrationBackup(tag = "pre-migrate"): string | null {
  if (process.env.SKIP_PRE_MIGRATION_BACKUP === "true") return null;
  try {
    const probe = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
    if (probe.status !== 0 || probe.error) {
      return null;
    }
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `nextdesk-${tag}-${stamp}.sql`);
    const url = resolveDatabaseUrl();
    const backupTimeoutMs = Math.max(
      5_000,
      Number(process.env.DB_BACKUP_TIMEOUT_MS || 60_000),
    );
    const env = {
      ...process.env,
      PGCONNECT_TIMEOUT: String(
        Math.max(5, Math.ceil(getPostgresTimeouts().connectionTimeoutMs / 1000)),
      ),
    };
    const result = spawnSync(
      "pg_dump",
      ["--file", backupPath, "--no-owner", "--no-privileges", "--dbname", url],
      {
        env,
        encoding: "utf8",
        timeout: backupTimeoutMs,
        killSignal: "SIGTERM",
      },
    );
    if (result.status !== 0) {
      try {
        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      } catch {}
      console.warn(
        `[db-migrations] Best-effort pre-migration pg_dump skipped (exit ${result.status}): ${String(result.stderr || "").trim().slice(0, 300)}`,
      );
      return null;
    }
    console.log(`[db-migrations] Pre-migration backup written: ${backupPath}`);
    return backupPath;
  } catch {
    return null;
  }
}

function getPrismaBinPath(): string {
  const localBin = path.join(projectRootDir, "node_modules", ".bin", "prisma");
  if (fs.existsSync(localBin)) return localBin;
  return "prisma";
}

function runPrismaCli(args: string[]): { ok: boolean; stdout: string; stderr: string; status: number } {
  const prismaBin = getPrismaBinPath();
  const env = {
    ...process.env,
    DATABASE_URL: resolveDatabaseUrl(),
  };
  const result = spawnSync(prismaBin, args, {
    cwd: projectRootDir,
    env,
    encoding: "utf8",
    timeout: Math.max(30_000, Number(process.env.DB_MIGRATION_TIMEOUT_MS || 180_000)),
  });
  return {
    ok: result.status === 0 && !result.error,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || (result.error ? result.error.message : "")),
    status: result.status ?? 1,
  };
}

export async function alignLegacyLiveDatabaseNonDestructively(): Promise<void> {
  const initSqlPath = path.join(
    projectRootDir,
    "prisma",
    "migrations",
    BASELINE_MIGRATION_NAME,
    "migration.sql",
  );
  if (fs.existsSync(initSqlPath)) {
    const sql = fs.readFileSync(initSqlPath, "utf8");
    const statements = sql
      .split(";")
      .map((s) =>
        s
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await pgRun(stmt);
    }
  }

  for (const [table, column, definition] of ADDITIVE_COLUMN_GUARDS) {
    await pgRun(
      `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${definition}`,
    );
  }

  await pgRun(
    `ALTER TABLE "remote_channel_queue" ALTER COLUMN "created_message_id" TYPE TEXT`,
  ).catch(() => {});

  for (const [table, column] of TIMESTAMP_DEFAULT_COLUMNS) {
    await pgRun(
      `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT (CURRENT_TIMESTAMP::text)`,
    ).catch(() => {});
    await pgRun(
      `UPDATE "${table}" SET "${column}" = (CURRENT_TIMESTAMP::text) WHERE "${column}" = $1`,
      ["datetime('now')"],
    ).catch(() => {});
  }
}

export interface MigrateDatabaseResult {
  applied: boolean;
  baselinedLegacyDb: boolean;
  appliedMigrations: string[];
  backupPath: string | null;
}

export async function runDatabaseMigrations(options: {
  backupBeforeMigrate?: boolean;
  quiet?: boolean;
} = {}): Promise<MigrateDatabaseResult> {
  const { backupBeforeMigrate = true, quiet = false } = options;
  await runPostgresPreflight();

  const tables = await pgGetAll<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const tableSet = new Set(tables.map((r) => String(r.table_name).toLowerCase()));

  const hasPrismaTable = tableSet.has("_prisma_migrations");
  const hasExistingAppTables = tableSet.has("users") || tableSet.has("chats");

  let backupPath: string | null = null;
  let baselinedLegacyDb = false;

  const migrationsDir = path.join(projectRootDir, "prisma", "migrations");
  const diskMigrations = fs.existsSync(migrationsDir)
    ? fs
        .readdirSync(migrationsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(migrationsDir, d.name, "migration.sql")))
        .map((d) => d.name)
        .sort()
    : [];

  let appliedBefore = new Set<string>();
  if (hasPrismaTable) {
    const appliedRows = await pgGetAll<{ migration_name: string }>(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    ).catch(() => []);
    appliedBefore = new Set(appliedRows.map((r) => r.migration_name));
  }

  const pendingOnDisk = diskMigrations.filter((name) => !appliedBefore.has(name));

  if (backupBeforeMigrate && hasExistingAppTables && (pendingOnDisk.length > 0 || !hasPrismaTable)) {
    backupPath = createPostgresPreMigrationBackup("pre-migration");
  }

  if (!hasPrismaTable && hasExistingAppTables) {
    if (!quiet) {
      console.log(
        "[db-migrations] Existing live PostgreSQL tables detected without _prisma_migrations; performing safe non-destructive baseline...",
      );
    }
    await alignLegacyLiveDatabaseNonDestructively();
    const resolveRes = runPrismaCli([
      "migrate",
      "resolve",
      "--applied",
      BASELINE_MIGRATION_NAME,
    ]);
    if (!resolveRes.ok) {
      throw new Error(
        `Failed to baseline existing live database (${BASELINE_MIGRATION_NAME}):\n${resolveRes.stderr || resolveRes.stdout}`,
      );
    }
    baselinedLegacyDb = true;
    appliedBefore.add(BASELINE_MIGRATION_NAME);
  }

  if (diskMigrations.length > 0) {
    const deployRes = runPrismaCli(["migrate", "deploy"]);
    if (!deployRes.ok) {
      throw new Error(
        `Prisma migrate deploy failed (exit ${deployRes.status}):\n${deployRes.stderr || deployRes.stdout}`,
      );
    }
    if (!quiet && deployRes.stdout.trim()) {
      console.log(deployRes.stdout.trim());
    }
  }

  const appliedAfterRows = await pgGetAll<{ migration_name: string }>(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at ASC`,
  ).catch(() => []);
  const appliedMigrations = appliedAfterRows.map((r) => r.migration_name);

  const latestMigration = appliedMigrations[appliedMigrations.length - 1] || BASELINE_MIGRATION_NAME;
  await pgRun(
    `INSERT INTO "meta" ("key", "value") VALUES ('prisma_schema_migration', $1) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"`,
    [latestMigration],
  ).catch(() => {});

  return {
    applied: pendingOnDisk.length > 0 || baselinedLegacyDb,
    baselinedLegacyDb,
    appliedMigrations,
    backupPath,
  };
}

export async function getAppliedMigrations(): Promise<
  Array<{
    migration_name: string;
    finished_at: string | null;
    applied_steps_count: number;
  }>
> {
  const exists = await pgGetRow<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations') AS exists`,
  );
  if (!exists?.exists) return [];
  return pgGetAll(
    `SELECT migration_name, finished_at::text AS finished_at, applied_steps_count FROM "_prisma_migrations" ORDER BY started_at ASC`,
  );
}

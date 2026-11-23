import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  describePgTarget,
  getBackupTimeoutMs,
  getMigrationTimeoutMs,
  getPostgresTimeouts,
  projectRootDir,
  resolveDatabaseUrl,
  shouldUseFallbackSslForUrl,
} from "./connectionConfig.ts";
import { pgGetAll, pgGetRow, pgQuery, pgRun } from "./prisma.ts";

export const BASELINE_MIGRATION_NAME = "0001_init";

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(projectRootDir, "data");
const backupDir = path.join(dataDir, "backups");

const ADDITIVE_COLUMN_GUARDS: Array<[string, string, string]> = [
  ["users", "nickname", "TEXT"],
  ["users", "avatar_url", "TEXT"],
  ["users", "avatar_storage_driver", "TEXT DEFAULT 'local'"],
  ["users", "avatar_storage_key", "TEXT"],
  ["users", "avatar_thumb_storage_key", "TEXT"],
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

export interface PostgresErrorClassification {
  category:
    | "connection_refused"
    | "dns"
    | "auth"
    | "missing_database"
    | "ssl"
    | "timeout"
    | "unknown";
  retryable: boolean;
  hint: string;
}

export function classifyPostgresError(error: any): PostgresErrorClassification {
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  const message = String(error?.message || error || "");
  const lower = message.toLowerCase();

  if (code === "ECONNREFUSED" || lower.includes("econnrefused")) {
    return {
      category: "connection_refused",
      retryable: true,
      hint: "PostgreSQL server is not listening on the configured host/port.",
    };
  }
  if (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    lower.includes("getaddrinfo")
  ) {
    return {
      category: "dns",
      retryable: true,
      hint: "Could not resolve the PostgreSQL hostname (DNS lookup failed).",
    };
  }
  if (
    code === "28P01" ||
    code === "28000" ||
    lower.includes("password authentication failed") ||
    lower.includes("no pg_hba.conf entry")
  ) {
    return {
      category: "auth",
      retryable: false,
      hint: "PostgreSQL rejected the credentials or host access rule (check user/password/pg_hba.conf).",
    };
  }
  if (code === "3D000" || /database .* does not exist/i.test(message)) {
    return {
      category: "missing_database",
      retryable: false,
      hint: "Configured PostgreSQL database does not exist yet.",
    };
  }
  if (
    code.startsWith("ERR_TLS") ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    lower.includes("ssl") ||
    lower.includes("tls") ||
    lower.includes("certificate")
  ) {
    return {
      category: "ssl",
      retryable: false,
      hint: "SSL/TLS handshake or certificate error (set POSTGRES_SSL=true for self-signed servers, adjust sslmode=, or set NODE_EXTRA_CA_CERTS).",
    };
  }
  if (
    code === "ETIMEDOUT" ||
    code === "57014" ||
    lower.includes("timeout") ||
    lower.includes("timed out")
  ) {
    return {
      category: "timeout",
      retryable: true,
      hint: "PostgreSQL connection or query timed out (check firewall, server load, or DB_CONNECTION_TIMEOUT_MS).",
    };
  }
  return {
    category: "unknown",
    retryable: true,
    hint: "Check DATABASE_URL / POSTGRES_URL / POSTGRES_* in .env and verify PostgreSQL is running.",
  };
}

export interface PostgresPreflightResult {
  latencyMs: number;
  attempts: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runPostgresPreflight(
  options: { maxAttempts?: number; retryDelayMs?: number } = {},
): Promise<PostgresPreflightResult> {
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 3));
  const retryDelayMs = Math.max(0, Math.trunc(options.retryDelayMs ?? 250));
  const target = describePgTarget();
  const timeouts = getPostgresTimeouts();
  const startedAt = Date.now();
  let lastError: any = null;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    const probeStart = Date.now();
    try {
      await pgQuery("SELECT 1");
      return {
        latencyMs: Date.now() - probeStart,
        attempts,
      };
    } catch (error: any) {
      lastError = error;
      const classified = classifyPostgresError(error);
      if (!classified.retryable || attempt >= maxAttempts) {
        break;
      }
      if (retryDelayMs > 0) {
        await sleep(retryDelayMs);
      }
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const classified = classifyPostgresError(lastError);
  const code = lastError?.code || lastError?.cause?.code || "";
  const detail = lastError?.message || String(lastError);
  const targetSummary = `${target.user}@${target.host}:${target.port}/${target.database} (ssl=${target.ssl ? "on" : "off"})`;
  throw new Error(
    `PostgreSQL preflight failed after ${attempts} probe(s) (${elapsedMs}ms) for ${targetSummary}` +
      `${code ? ` [${code}]` : ""} (${classified.category}): ${detail}\n` +
      `  Cause: ${classified.hint}\n` +
      `  Configured timeouts: connect=${timeouts.connectionTimeoutMs}ms, statement=${timeouts.statementTimeoutMs}ms.`,
  );
}

function safeUnlink(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

export function createPostgresPreMigrationBackup(tag = "pre-migrate"): string | null {
  if (process.env.SKIP_PRE_MIGRATION_BACKUP === "true") return null;
  let backupPath: string | null = null;
  try {
    const probe = spawnSync("pg_dump", ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    if (probe.status !== 0 || probe.error) {
      console.warn(
        "[db-migrations] pg_dump not found in PATH — skipping pre-migration backup (continuing without blocking).",
      );
      return null;
    }
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = path.join(backupDir, `nextdesk-${tag}-${stamp}.sql`);
    const url = resolveDatabaseUrl();
    const backupTimeoutMs = getBackupTimeoutMs();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PGCONNECT_TIMEOUT: String(
        Math.max(5, Math.ceil(getPostgresTimeouts().connectionTimeoutMs / 1000)),
      ),
    };
    if (shouldUseFallbackSslForUrl(url) && !env.PGSSLMODE) {
      env.PGSSLMODE = "require";
    }
    const startedAt = Date.now();
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
    const timedOut =
      (result.error as any)?.code === "ETIMEDOUT" ||
      result.signal === "SIGTERM" ||
      result.signal === "SIGKILL";
    if (timedOut) {
      safeUnlink(backupPath);
      console.warn(
        `[db-migrations] Pre-migration pg_dump timed out after ${backupTimeoutMs}ms (DB_BACKUP_TIMEOUT_MS); partial backup removed (continuing).`,
      );
      return null;
    }
    if (result.status !== 0 || result.error) {
      safeUnlink(backupPath);
      const reason = String(
        result.stderr || result.error?.message || `exit ${result.status}`,
      )
        .trim()
        .slice(0, 300);
      console.warn(
        `[db-migrations] Best-effort pre-migration pg_dump skipped (${reason}).`,
      );
      return null;
    }
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `[db-migrations] Pre-migration backup written in ${elapsedSec}s: ${backupPath}`,
    );
    return backupPath;
  } catch (err: any) {
    if (backupPath) safeUnlink(backupPath);
    console.warn(
      `[db-migrations] Best-effort pre-migration pg_dump failed: ${String(err?.message || err).slice(0, 200)}`,
    );
    return null;
  }
}

export function listDiskMigrations(): string[] {
  const migrationsDir = path.join(projectRootDir, "prisma", "migrations");
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        fs.existsSync(path.join(migrationsDir, d.name, "migration.sql")),
    )
    .map((d) => d.name)
    .sort();
}

function getPrismaBinPath(): string {
  const localBin = path.join(projectRootDir, "node_modules", ".bin", "prisma");
  if (fs.existsSync(localBin)) return localBin;
  return "prisma";
}

interface PrismaCliResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number;
  timedOut: boolean;
  timeoutMs: number;
  elapsedMs: number;
}

async function runPrismaCli(
  args: string[],
  options: { streamOutput?: boolean } = {},
): Promise<PrismaCliResult> {
  const { streamOutput = false } = options;
  const prismaBin = getPrismaBinPath();
  const timeoutMs = getMigrationTimeoutMs();
  const url = resolveDatabaseUrl();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: url,
  };
  if (shouldUseFallbackSslForUrl(url) && !env.PGSSLMODE) {
    env.PGSSLMODE = "require";
  }

  const startedAt = Date.now();
  return new Promise<PrismaCliResult>((resolve) => {
    const child = spawn(prismaBin, args, {
      cwd: projectRootDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let watchdog: NodeJS.Timeout | null = null;
    let forceKillTimer: NodeJS.Timeout | null = null;

    const cleanupTimers = () => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
    };

    const finish = (status: number) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      resolve({
        ok: !timedOut && status === 0,
        stdout,
        stderr,
        status,
        timedOut,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
      });
    };

    if (timeoutMs > 0) {
      watchdog = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
        } catch {}
        forceKillTimer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {}
        }, 5_000);
        forceKillTimer.unref?.();
      }, timeoutMs);
      watchdog.unref?.();
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (streamOutput) process.stdout.write(text);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      if (streamOutput) process.stderr.write(text);
    });

    child.on("error", (err: Error) => {
      stderr += (stderr ? "\n" : "") + (err?.message || String(err));
      finish(1);
    });

    child.on("close", (code: number | null) => {
      finish(code ?? 1);
    });
  });
}

async function runWithMigrationWatchdog<T>(
  label: string,
  task: () => Promise<T>,
): Promise<T> {
  const timeoutMs = getMigrationTimeoutMs();
  if (timeoutMs <= 0) {
    return task();
  }
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Migration watchdog aborted "${label}" after ${timeoutMs}ms (DB_MIGRATION_TIMEOUT_MS). ` +
                `Schema version was not advanced past this step. Run npm run db:doctor to inspect locks/connectivity, ` +
                `or set DB_MIGRATION_TIMEOUT_MS=0 to disable the watchdog for very large databases.`,
            ),
          );
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

export async function runDatabaseMigrations(
  options: {
    backupBeforeMigrate?: boolean;
    quiet?: boolean;
  } = {},
): Promise<MigrateDatabaseResult> {
  const { backupBeforeMigrate = true, quiet = false } = options;
  const preflight = await runPostgresPreflight();
  if (!quiet) {
    console.log(
      `[db-migrations] PostgreSQL preflight OK (${preflight.latencyMs}ms, ${preflight.attempts} probe(s)).`,
    );
  }

  const tables = await pgGetAll<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const tableSet = new Set(tables.map((r) => String(r.table_name).toLowerCase()));

  const hasPrismaTable = tableSet.has("_prisma_migrations");
  const hasExistingAppTables = tableSet.has("users") || tableSet.has("chats");

  let backupPath: string | null = null;
  let baselinedLegacyDb = false;

  const diskMigrations = listDiskMigrations();

  let appliedBefore = new Set<string>();
  if (hasPrismaTable) {
    const appliedRows = await pgGetAll<{ migration_name: string }>(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    ).catch(() => []);
    appliedBefore = new Set(appliedRows.map((r) => r.migration_name));
  }

  const pendingOnDisk = diskMigrations.filter((name) => !appliedBefore.has(name));

  if (!quiet) {
    const watchdogMs = getMigrationTimeoutMs();
    console.log(
      `[db-migrations] Schema state: ${appliedBefore.size}/${diskMigrations.length} applied, ` +
        `${pendingOnDisk.length} pending (watchdog=${watchdogMs > 0 ? `${watchdogMs}ms` : "disabled"}).`,
    );
  }

  if (
    backupBeforeMigrate &&
    hasExistingAppTables &&
    (pendingOnDisk.length > 0 || !hasPrismaTable)
  ) {
    backupPath = createPostgresPreMigrationBackup("pre-migration");
  }

  if (!hasPrismaTable && hasExistingAppTables) {
    const stepStart = Date.now();
    if (!quiet) {
      console.log(
        `[db-migrations] Existing live PostgreSQL tables detected without _prisma_migrations; performing safe non-destructive baseline (${BASELINE_MIGRATION_NAME})...`,
      );
    }
    await runWithMigrationWatchdog(
      `baseline:${BASELINE_MIGRATION_NAME}`,
      () => alignLegacyLiveDatabaseNonDestructively(),
    );
    const resolveRes = await runPrismaCli(
      ["migrate", "resolve", "--applied", BASELINE_MIGRATION_NAME],
      { streamOutput: !quiet },
    );
    if (resolveRes.timedOut) {
      throw new Error(
        `Migration watchdog aborted baseline resolve (${BASELINE_MIGRATION_NAME}) after ${resolveRes.timeoutMs}ms (DB_MIGRATION_TIMEOUT_MS). Schema version was not advanced.`,
      );
    }
    if (!resolveRes.ok) {
      throw new Error(
        `Failed to baseline existing live database (${BASELINE_MIGRATION_NAME}):\n${resolveRes.stderr || resolveRes.stdout}`,
      );
    }
    baselinedLegacyDb = true;
    appliedBefore.add(BASELINE_MIGRATION_NAME);
    if (!quiet) {
      console.log(
        `[db-migrations] Baseline ${BASELINE_MIGRATION_NAME} recorded in ${((Date.now() - stepStart) / 1000).toFixed(2)}s.`,
      );
    }
  }

  const remainingPending = diskMigrations.filter((name) => !appliedBefore.has(name));
  if (diskMigrations.length > 0 && (remainingPending.length > 0 || !hasPrismaTable)) {
    if (!quiet && remainingPending.length > 0) {
      console.log(
        `[db-migrations] Applying ${remainingPending.length} Prisma migration(s): ${remainingPending.join(", ")}`,
      );
    }
    const deployRes = await runPrismaCli(["migrate", "deploy"], {
      streamOutput: !quiet,
    });
    if (deployRes.timedOut) {
      throw new Error(
        `Migration watchdog aborted "prisma migrate deploy" (${remainingPending.join(", ") || "pending"}) after ${deployRes.timeoutMs}ms (DB_MIGRATION_TIMEOUT_MS). ` +
          `Schema version was not advanced past the timed-out migration. Run npm run db:doctor to inspect locks/connectivity, or set DB_MIGRATION_TIMEOUT_MS=0 for large migrations.`,
      );
    }
    if (!deployRes.ok) {
      throw new Error(
        `Prisma migrate deploy failed (exit ${deployRes.status}):\n${deployRes.stderr || deployRes.stdout}`,
      );
    }
    if (!quiet) {
      console.log(
        `[db-migrations] Prisma migrate deploy finished in ${(deployRes.elapsedMs / 1000).toFixed(2)}s.`,
      );
    }
  } else if (!quiet) {
    console.log("[db-migrations] Database schema is already up to date — no pending migrations.");
  }

  const appliedAfterRows = await pgGetAll<{ migration_name: string }>(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at ASC`,
  ).catch(() => []);
  const appliedMigrations = appliedAfterRows.map((r) => r.migration_name);

  const latestMigration =
    appliedMigrations[appliedMigrations.length - 1] || BASELINE_MIGRATION_NAME;
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

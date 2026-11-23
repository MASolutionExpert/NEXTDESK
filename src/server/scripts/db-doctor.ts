import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { serverDir } from "./_cli.ts";
import {
  describePgTarget,
  getBackupTimeoutMs,
  getMigrationTimeoutMs,
  getPostgresTimeouts,
} from "../db/connectionConfig.ts";
import { pgGetAll, pgGetRow, closeDatabase } from "../db/prisma.ts";
import {
  listDiskMigrations,
  runPostgresPreflight,
} from "../db/migrate.ts";

const projectRootDir = path.resolve(serverDir, "../..");
dotenv.config({ path: path.join(projectRootDir, ".env"), quiet: true });
dotenv.config({ path: path.join(serverDir, ".env"), override: true, quiet: true });

const CRITICAL_TABLES = [
  "meta",
  "app_settings",
  "departments",
  "users",
  "chats",
  "chat_members",
  "chat_left_members",
  "chat_messages",
  "chat_message_files",
  "chat_message_reads",
  "hidden_chat_messages",
  "hidden_chats",
  "chat_mutes",
  "group_removed_members",
  "sessions",
  "push_subscriptions",
  "remote_channel_sources",
  "remote_channel_queue",
  "remote_channel_provider_state",
  "pending_presigned_uploads",
  "admin_audit_logs",
];

const LEFTOVER_REBUILD_RE = /(_old|_new|_tmp|_backup|_rebuild)$/i;

const line = (msg = "") => process.stdout.write(`${msg}\n`);
const ok = (msg: string) => line(`  [OK]   ${msg}`);
const warn = (msg: string) => line(`  [WARN] ${msg}`);
const fail = (msg: string) => line(`  [FAIL] ${msg}`);
const section = (title: string) => line(`\n=== ${title} ===`);

export async function collectDiagnostics() {
  const report: any = {
    ok: false,
    readOnly: true,
    client: "postgres",
    engine: "postgres",
    orm: "prisma-7",
    target: describePgTarget(),
    latencyMs: null,
    dbServerVersion: null,
    appliedMigrations: [],
    pendingMigrations: [],
    failedMigrations: [],
    missingTables: [],
    leftoverTables: [],
    activeConnections: null,
    waitingLocks: null,
    findings: { ok: 0, warnings: 0, failures: 0 },
  };
  const record = (fn: (m: string) => void, msg: string) => {
    fn(msg);
    if (fn === ok) report.findings.ok += 1;
    else if (fn === warn) report.findings.warnings += 1;
    else if (fn === fail) report.findings.failures += 1;
  };

  section("Configuration");
  record(ok, "Database engine: PostgreSQL (Prisma 7 + @prisma/adapter-pg)");
  record(
    ok,
    `Target: ${report.target.user}@${report.target.host}:${report.target.port}/${report.target.database} (ssl=${report.target.ssl ? "on" : "off"}, mode=${report.target.mode})`,
  );
  const timeouts = getPostgresTimeouts();
  const migrationTimeoutMs = getMigrationTimeoutMs();
  const backupTimeoutMs = getBackupTimeoutMs();
  record(
    ok,
    `Timeouts: connect=${timeouts.connectionTimeoutMs}ms, acquire=${timeouts.acquireTimeoutMs}ms, statement=${timeouts.statementTimeoutMs}ms, idleInTx=${timeouts.idleInTransactionTimeoutMs}ms`,
  );
  record(
    ok,
    `Migration watchdog: ${migrationTimeoutMs > 0 ? `${migrationTimeoutMs}ms` : "disabled (0)"} | Backup timeout: ${backupTimeoutMs}ms`,
  );

  section("Connectivity");
  try {
    const preflight = await runPostgresPreflight({ maxAttempts: 3, retryDelayMs: 200 });
    report.latencyMs = preflight.latencyMs;
    record(
      ok,
      `PostgreSQL connectivity & credentials verified (${preflight.latencyMs}ms, ${preflight.attempts} probe(s)).`,
    );
  } catch (error: any) {
    record(
      fail,
      `Cannot connect to PostgreSQL: ${String(error?.message || error).slice(0, 500)}`,
    );
    return report;
  }

  section("Prisma 7 Migrations (read-only)");
  const diskMigrations = listDiskMigrations();
  try {
    const hasPrismaTable = await pgGetRow<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations') AS exists`,
    );
    if (!hasPrismaTable?.exists) {
      report.pendingMigrations = [...diskMigrations];
      record(
        warn,
        `_prisma_migrations table not found — ${diskMigrations.length} migration(s) pending (${diskMigrations.join(", ") || "none"}). Run: npm run db:migrate`,
      );
    } else {
      const rows = await pgGetAll<{
        migration_name: string;
        finished_at: string | null;
        rolled_back_at: string | null;
        applied_steps_count: number;
      }>(
        `SELECT migration_name, finished_at::text AS finished_at, rolled_back_at::text AS rolled_back_at, applied_steps_count FROM "_prisma_migrations" ORDER BY started_at ASC`,
      );
      const applied = rows.filter((r) => r.finished_at !== null && r.rolled_back_at === null);
      const failed = rows.filter((r) => r.finished_at === null && r.rolled_back_at === null);
      const appliedSet = new Set(applied.map((r) => r.migration_name));
      const pending = diskMigrations.filter((name) => !appliedSet.has(name));

      report.appliedMigrations = applied;
      report.pendingMigrations = pending;
      report.failedMigrations = failed.map((r) => r.migration_name);

      if (applied.length > 0) {
        record(
          ok,
          `Applied migrations: ${applied.length}/${diskMigrations.length} (latest: ${applied[applied.length - 1].migration_name}).`,
        );
      } else {
        record(warn, "No applied rows in _prisma_migrations yet — run npm run db:migrate.");
      }

      if (failed.length > 0) {
        record(
          fail,
          `Incomplete/failed migration(s) in _prisma_migrations: ${failed.map((r) => r.migration_name).join(", ")}.`,
        );
      }

      if (pending.length > 0) {
        record(
          warn,
          `${pending.length} migration(s) pending: ${pending.join(", ")} — run npm run db:migrate.`,
        );
      } else if (applied.length > 0) {
        record(ok, "No pending migrations on disk.");
      }
    }
  } catch (error: any) {
    record(
      warn,
      `Could not read _prisma_migrations: ${String(error?.message || error).slice(0, 200)}`,
    );
  }

  section("Schema");
  const tableSet = new Set<string>();
  const allTableNames: string[] = [];
  try {
    const rows = await pgGetAll<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    for (const row of rows) {
      if (row?.table_name) {
        const lower = String(row.table_name).toLowerCase();
        tableSet.add(lower);
        allTableNames.push(String(row.table_name));
      }
    }
  } catch (error: any) {
    record(
      fail,
      `Could not enumerate public tables: ${String(error?.message || error).slice(0, 300)}`,
    );
  }

  const missing = CRITICAL_TABLES.filter((t) => !tableSet.has(t));
  report.missingTables = missing;
  if (missing.length === 0) {
    record(ok, `All ${CRITICAL_TABLES.length} critical tables present.`);
  } else {
    record(
      fail,
      `Missing critical tables: ${missing.join(", ")} — run npm run db:migrate.`,
    );
  }

  const leftover = allTableNames.filter((t) => LEFTOVER_REBUILD_RE.test(t));
  report.leftoverTables = leftover;
  if (leftover.length === 0) {
    record(ok, "No leftover interrupted-migration rebuild tables found.");
  } else {
    record(
      warn,
      `Leftover temporary/rebuild tables detected: ${leftover.join(", ")}.`,
    );
  }

  section("Data & PostgreSQL Health");
  for (const table of ["users", "chats", "chat_messages", "departments"]) {
    if (!tableSet.has(table)) continue;
    try {
      const row = await pgGetRow(`SELECT COUNT(*) AS count FROM "${table}"`);
      record(ok, `${table}: ${Number(row?.count || 0)} row(s).`);
    } catch (error: any) {
      record(
        warn,
        `Could not count rows in ${table}: ${String(error?.message || error).slice(0, 200)}`,
      );
    }
  }

  try {
    const ver = await pgGetRow("SHOW server_version");
    report.dbServerVersion = ver?.server_version || null;
    if (report.dbServerVersion) {
      record(ok, `PostgreSQL server version: ${report.dbServerVersion}`);
    }
  } catch {}

  try {
    const sz = await pgGetRow(
      "SELECT pg_size_pretty(pg_database_size(current_database())) AS size",
    );
    if (sz?.size) record(ok, `Database size: ${sz.size}`);
  } catch {}

  try {
    const conn = await pgGetRow(
      "SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE state = 'active') AS active FROM pg_stat_activity WHERE datname = current_database()",
    );
    if (conn) {
      report.activeConnections = Number(conn.active || 0);
      record(
        ok,
        `Connections to database: ${Number(conn.total || 0)} total (${Number(conn.active || 0)} active).`,
      );
    }
  } catch {}

  try {
    const locks = await pgGetRow(
      "SELECT COUNT(*) AS waiting FROM pg_locks WHERE NOT granted",
    );
    if (locks) {
      const waiting = Number(locks.waiting || 0);
      report.waitingLocks = waiting;
      if (waiting > 0) {
        record(warn, `Blocking locks detected: ${waiting} ungranted lock wait(s).`);
      } else {
        record(ok, "No blocked/ungranted PostgreSQL lock waits.");
      }
    }
  } catch {}

  report.ok = report.findings.failures === 0;
  return report;
}

export async function runDoctor() {
  line("NextDesk PostgreSQL + Prisma 7 database doctor (read-only)");
  line(`Time: ${new Date().toISOString()}`);
  let report: any;
  try {
    report = await collectDiagnostics();
  } catch (error: any) {
    fail(
      `Doctor crashed: ${String(error?.stack || error?.message || error).slice(0, 800)}`,
    );
    report = { findings: { ok: 0, warnings: 0, failures: 1 } };
  } finally {
    await closeDatabase().catch(() => {});
  }
  section("Summary");
  const { ok: okCount, warnings, failures } = report.findings;
  line(`  ${okCount} check(s) OK, ${warnings} warning(s), ${failures} failure(s).`);
  if (failures > 0) {
    line();
    line("  Action: fix the [FAIL] items above, then re-run: npm run db:doctor");
    return 1;
  }
  if (warnings > 0) {
    line();
    line("  Action: review the [WARN] items above.");
    return 0;
  }
  line();
  line("  Database looks healthy.");
  return 0;
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  runDoctor()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

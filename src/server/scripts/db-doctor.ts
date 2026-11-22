import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { serverDir } from "./_cli.ts";
import { describePgTarget, getPostgresTimeouts } from "../db/connectionConfig.ts";
import { pgGetAll, pgGetRow, closeDatabase } from "../db/prisma.ts";
import { runPostgresPreflight, getAppliedMigrations } from "../db/migrate.ts";

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

const line = (msg = "") => process.stdout.write(`${msg}\n`);
const ok = (msg: string) => line(`  [OK]   ${msg}`);
const warn = (msg: string) => line(`  [WARN] ${msg}`);
const fail = (msg: string) => line(`  [FAIL] ${msg}`);
const section = (title: string) => line(`\n=== ${title} ===`);

export async function collectDiagnostics() {
  const report: any = {
    ok: false,
    client: "postgres",
    engine: "postgres",
    orm: "prisma-7",
    target: describePgTarget(),
    dbServerVersion: null,
    appliedMigrations: [],
    missingTables: [],
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
  record(ok, `Target: ${report.target.host}:${report.target.port}/${report.target.database} (ssl=${report.target.ssl})`);
  const timeouts = getPostgresTimeouts();
  record(
    ok,
    `Timeouts: connect=${timeouts.connectionTimeoutMs}ms, statement=${timeouts.statementTimeoutMs}ms, idleInTx=${timeouts.idleInTransactionTimeoutMs}ms`,
  );

  section("Connectivity");
  try {
    await runPostgresPreflight({ quiet: true });
    record(ok, "PostgreSQL connectivity & credentials verified.");
  } catch (error: any) {
    record(fail, `Cannot connect to PostgreSQL: ${String(error?.message || error).slice(0, 400)}`);
    return report;
  }

  section("Prisma 7 Migrations");
  try {
    const applied = await getAppliedMigrations();
    report.appliedMigrations = applied;
    if (applied.length > 0) {
      record(ok, `_prisma_migrations: ${applied.length} applied migration(s) (latest: ${applied[applied.length - 1].migration_name}).`);
    } else {
      record(warn, "No rows in _prisma_migrations yet — run npm run db:migrate.");
    }
  } catch (error: any) {
    record(warn, `Could not read _prisma_migrations: ${String(error?.message || error).slice(0, 200)}`);
  }

  section("Schema");
  const tableSet = new Set<string>();
  try {
    const rows = await pgGetAll(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    for (const row of rows) {
      if (row?.table_name) tableSet.add(String(row.table_name).toLowerCase());
    }
  } catch (error: any) {
    record(fail, `Could not enumerate public tables: ${String(error?.message || error).slice(0, 300)}`);
  }

  const missing = CRITICAL_TABLES.filter((t) => !tableSet.has(t));
  report.missingTables = missing;
  if (missing.length === 0) {
    record(ok, `All ${CRITICAL_TABLES.length} critical tables present.`);
  } else {
    record(fail, `Missing critical tables: ${missing.join(", ")} — run npm run db:migrate.`);
  }

  section("Data & Server Info");
  for (const table of ["users", "chats", "chat_messages", "departments"]) {
    if (!tableSet.has(table)) continue;
    try {
      const row = await pgGetRow(`SELECT COUNT(*) AS count FROM ${table}`);
      record(ok, `${table}: ${Number(row?.count || 0)} row(s).`);
    } catch (error: any) {
      record(warn, `Could not count rows in ${table}: ${String(error?.message || error).slice(0, 200)}`);
    }
  }

  try {
    const ver = await pgGetRow("SHOW server_version");
    report.dbServerVersion = ver?.server_version || null;
    if (report.dbServerVersion) record(ok, `PostgreSQL server version: ${report.dbServerVersion}`);
  } catch {}

  try {
    const sz = await pgGetRow("SELECT pg_size_pretty(pg_database_size(current_database())) AS size");
    if (sz?.size) record(ok, `Database size: ${sz.size}`);
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
    fail(`Doctor crashed: ${String(error?.stack || error?.message || error).slice(0, 800)}`);
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

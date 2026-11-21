import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// v1.1.0-dev.10 — hardened database layer:
//   * fail-fast Postgres timeouts (no infinite hangs)
//   * per-migration watchdog
//   * db:doctor diagnostics
// ---------------------------------------------------------------------------

describe("Postgres timeout hardening (db/knex.js)", () => {
  const originalEnv: any = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  test("defaults are fail-fast, not infinite", async () => {
    process.env.DB_CLIENT = "postgres";
    const knexModule: any = await import("../../../src/server/db/knex.ts");
    const timeouts: any = knexModule.getPostgresTimeouts();

    expect(timeouts.connectionTimeoutMs).toBeLessThanOrEqual(30_000);
    expect(timeouts.acquireTimeoutMs).toBeLessThanOrEqual(30_000);
    expect(timeouts.statementTimeoutMs).toBeLessThanOrEqual(60_000);
    expect(timeouts.idleInTransactionTimeoutMs).toBeLessThanOrEqual(60_000);
    expect(timeouts.connectionTimeoutMs).toBeGreaterThan(0);
  });

  test("env overrides are respected (large databases can raise limits)", async () => {
    process.env.DB_CLIENT = "postgres";
    process.env.DB_CONNECTION_TIMEOUT_MS = "45000";
    process.env.DB_STATEMENT_TIMEOUT_MS = "300000";
    process.env.DB_MIGRATION_TIMEOUT_MS_UNUSED = "junk";
    const knexModule: any = await import("../../../src/server/db/knex.ts");
    const timeouts: any = knexModule.getPostgresTimeouts();

    expect(timeouts.connectionTimeoutMs).toBe(45_000);
    expect(timeouts.statementTimeoutMs).toBe(300_000);
  });

  test("knex instance carries connection, pool and statement timeouts", async () => {
    process.env.DB_CLIENT = "postgres";
    process.env.POSTGRES_URL = "postgresql://user:secret@db.example.com:6543/chatdesk";
    const knexModule: any = await import("../../../src/server/db/knex.ts");
    const instance: any = knexModule.createKnexInstance();
    try {
      const config = instance.client.config;
      expect(config.acquireConnectionTimeout).toBeGreaterThan(0);
      expect(config.pool.min).toBe(0);
      expect(config.pool.createTimeoutMillis).toBeGreaterThan(0);
      expect(config.connection.connectionTimeoutMillis).toBeGreaterThan(0);
      expect(config.connection.statement_timeout).toBeGreaterThan(0);
      expect(config.connection.idle_in_transaction_session_timeout).toBeGreaterThan(0);
    } finally {
      await instance.destroy();
    }
  });

  test("describePgTarget never leaks the password", async () => {
    process.env.POSTGRES_URL =
      "postgresql://chatdesk:s3cr3t-p4ss@pg.internal.example:5432/chatdesk?sslmode=require";
    const knexModule: any = await import("../../../src/server/db/knex.ts");
    const target: any = knexModule.describePgTarget();

    expect(target.host).toBe("pg.internal.example");
    expect(target.port).toBe("5432");
    expect(target.database).toBe("chatdesk");
    expect(target.user).toBe("chatdesk");
    expect(target.ssl).toBe(true);
    expect(JSON.stringify(target)).not.toContain("s3cr3t-p4ss");
  });

  test("describePgTarget supports POSTGRES_* parts", async () => {
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_HOST = "10.0.0.5";
    process.env.POSTGRES_PORT = "5433";
    process.env.POSTGRES_DB = "chatdesk_prod";
    process.env.POSTGRES_USER = "chatdesk";
    const knexModule: any = await import("../../../src/server/db/knex.ts");
    const target: any = knexModule.describePgTarget();

    expect(target.mode).toBe("parts");
    expect(target.host).toBe("10.0.0.5");
    expect(target.port).toBe("5433");
    expect(target.database).toBe("chatdesk_prod");
    expect(JSON.stringify(target)).not.toContain("postgres");
    // Default password must never appear in the description.
    expect(JSON.stringify(target)).not.toContain(process.env.POSTGRES_PASSWORD || "\u0000");
  });
});

describe("Migration watchdog (db.js)", () => {
  const originalEnv: any = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  test("getMigrationTimeoutMs defaults to 120s and honors env", async () => {
    const dbModule: any = await import("../../../src/server/db.ts");
    expect(dbModule.getMigrationTimeoutMs()).toBe(120_000);

    process.env.DB_MIGRATION_TIMEOUT_MS = "5000";
    expect(dbModule.getMigrationTimeoutMs()).toBe(5_000);

    // 0 disables the watchdog.
    process.env.DB_MIGRATION_TIMEOUT_MS = "0";
    expect(dbModule.getMigrationTimeoutMs()).toBe(0);
  });

  test("withMigrationTimeout aborts a hung migration with a labeled error", async () => {
    const dbModule: any = await import("../../../src/server/db.ts");
    process.env.DB_MIGRATION_TIMEOUT_MS = "80";

    const hung: any = new Promise<any>(() => {});
    await expect(
      dbModule.withMigrationTimeout("036", hung),
    ).rejects.toThrow(/Migration 036 did not finish within 80ms/);
  });

  test("withMigrationTimeout passes successful results through", async () => {
    const dbModule: any = await import("../../../src/server/db.ts");
    process.env.DB_MIGRATION_TIMEOUT_MS = "5000";

    await expect(
      dbModule.withMigrationTimeout("042", Promise.resolve("done")),
    ).resolves.toBe("done");
  });
});

describe("db:doctor diagnostics", () => {
  const originalEnv: any = { ...process.env };
  let tempDataDir: any = null;

  beforeEach(() => {
    vi.resetModules();
    // Isolate the bootstrap DB (db.js runs migrations on import) in a temp dir
    // so the doctor tests never touch the repository's data/ directory.
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-doctor-"));
    process.env.DATA_DIR = tempDataDir;
    process.env.DB_CLIENT = "sqlite3";
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    if (tempDataDir) {
      try {
        fs.rmSync(tempDataDir, { recursive: true, force: true });
      } catch {}
      tempDataDir = null;
    }
  });

  test("collectDiagnostics stays strictly read-only on an uninitialized sqlite database", async () => {
    const doctorModule: any = await import("../../../src/server/scripts/db-doctor.ts");
    const report: any = await doctorModule.collectDiagnostics();

    expect(report.findings.failures).toBeGreaterThan(0);
    expect(report.currentSchemaVersion).toBe(0);
    expect(report.lines.join("\n")).toMatch(/missing critical table|schema/i);
  });

  test("collectDiagnostics reports a healthy sqlite schema", async () => {
    // Explicitly bootstrap & migrate the temp SQLite DB first, because db:doctor
    // is strictly read-only and must never run migrations as a side-effect.
    await import("../../../src/server/db.ts");
    const doctorModule: any = await import("../../../src/server/scripts/db-doctor.ts");
    const report: any = await doctorModule.collectDiagnostics();

    expect(report.findings.failures).toBe(0);
    expect(report.currentSchemaVersion).toBe(report.latestMigrationVersion);
    expect(report.lines.join("\n")).toContain("All 21 critical tables present.");
    expect(report.lines.join("\n")).toContain("No leftover table-rebuild tables");
  });

  test("collectDiagnostics survives an unreachable Postgres bootstrap without crashing", async () => {
    process.env.DB_CLIENT = "postgres";
    process.env.POSTGRES_URL = "postgresql://chatdesk:secret@127.0.0.1:1/chatdesk";
    process.env.DB_CONNECTION_TIMEOUT_MS = "500";
    vi.resetModules();

    const doctorModule: any = await import("../../../src/server/scripts/db-doctor.ts");
    const report: any = await doctorModule.collectDiagnostics();

    expect(report.findings.failures).toBeGreaterThan(0);
    expect(report.lines.join("\n")).toMatch(/bootstrap FAILED|Connection failed/);
    expect(report.lines.join("\n")).toContain("127.0.0.1:1");
    expect(report.lines.join("\n")).not.toContain("secret");
  });
});

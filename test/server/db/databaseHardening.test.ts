import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  buildPgPoolConfig,
  describePgTarget,
  getBackupTimeoutMs,
  getMigrationTimeoutMs,
  getPostgresTimeouts,
} from "../../../src/server/db/connectionConfig.ts";
import { classifyPostgresError } from "../../../src/server/db/migrate.ts";
import { collectDiagnostics } from "../../../src/server/scripts/db-doctor.ts";
import { createTestDb } from "./testDbHelper.ts";

describe("PostgreSQL connection hardening & db-doctor diagnostics", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  test("applies sensible default and custom PostgreSQL timeouts", () => {
    delete process.env.DB_CONNECTION_TIMEOUT_MS;
    delete process.env.DB_STATEMENT_TIMEOUT_MS;
    const defaults = getPostgresTimeouts();
    expect(defaults.connectionTimeoutMs).toBe(10_000);
    expect(defaults.statementTimeoutMs).toBe(30_000);

    process.env.DB_CONNECTION_TIMEOUT_MS = "4500";
    process.env.DB_STATEMENT_TIMEOUT_MS = "12000";
    const custom = getPostgresTimeouts();
    expect(custom.connectionTimeoutMs).toBe(4500);
    expect(custom.statementTimeoutMs).toBe(12000);
  });

  test("DB_MIGRATION_TIMEOUT_MS=0 disables watchdog; blank falls back to 120s default", () => {
    delete process.env.DB_MIGRATION_TIMEOUT_MS;
    expect(getMigrationTimeoutMs()).toBe(120_000);

    process.env.DB_MIGRATION_TIMEOUT_MS = "";
    expect(getMigrationTimeoutMs()).toBe(120_000);

    process.env.DB_MIGRATION_TIMEOUT_MS = "   ";
    expect(getMigrationTimeoutMs()).toBe(120_000);

    process.env.DB_MIGRATION_TIMEOUT_MS = "0";
    expect(getMigrationTimeoutMs()).toBe(0);

    process.env.DB_MIGRATION_TIMEOUT_MS = "45000";
    expect(getMigrationTimeoutMs()).toBe(45_000);
  });

  test("DB_BACKUP_TIMEOUT_MS defaults to 120s and enforces safe lower bound", () => {
    delete process.env.DB_BACKUP_TIMEOUT_MS;
    expect(getBackupTimeoutMs()).toBe(120_000);

    process.env.DB_BACKUP_TIMEOUT_MS = "0";
    expect(getBackupTimeoutMs()).toBe(120_000);

    process.env.DB_BACKUP_TIMEOUT_MS = "90000";
    expect(getBackupTimeoutMs()).toBe(90_000);
  });

  test("POSTGRES_SSL=true applies to URL targets unless explicit sslmode= is present in URL", () => {
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_SSL = "true";
    process.env.POSTGRES_URL = "postgresql://nextdesk:secret@pg.internal:5432/nextdesk";

    const noSslModePool = buildPgPoolConfig();
    expect(noSslModePool.ssl).toEqual({ rejectUnauthorized: false });
    expect(describePgTarget().ssl).toBe(true);

    // Explicit sslmode=disable in URL must override POSTGRES_SSL=true
    process.env.POSTGRES_URL =
      "postgresql://nextdesk:secret@pg.internal:5432/nextdesk?sslmode=disable";
    const disableSslPool = buildPgPoolConfig();
    expect(disableSslPool.ssl).toBeUndefined();
    expect(describePgTarget().ssl).toBe(false);

    // Explicit sslmode=verify-full in URL must override POSTGRES_SSL=true
    process.env.POSTGRES_URL =
      "postgresql://nextdesk:secret@pg.internal:5432/nextdesk?sslmode=verify-full";
    const verifyFullPool = buildPgPoolConfig();
    expect(verifyFullPool.ssl).toBeUndefined();
    expect(describePgTarget().ssl).toBe(true);
  });

  test("describePgTarget redacts passwords for URL and parts modes", () => {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_SSL;
    process.env.POSTGRES_URL =
      "postgresql://nextdesk:s3cr3t-p4ss@pg.internal.example:5432/nextdesk?sslmode=require";
    const urlTarget = describePgTarget();
    expect(urlTarget).toEqual({
      mode: "url",
      host: "pg.internal.example",
      port: "5432",
      database: "nextdesk",
      user: "nextdesk",
      ssl: true,
    });
    expect(JSON.stringify(urlTarget)).not.toContain("s3cr3t-p4ss");

    delete process.env.POSTGRES_URL;
    process.env.POSTGRES_HOST = "10.0.0.5";
    process.env.POSTGRES_PORT = "5433";
    process.env.POSTGRES_DB = "nextdesk_prod";
    process.env.POSTGRES_USER = "nd_user";
    process.env.POSTGRES_PASSWORD = "hidden-password";
    const partsTarget = describePgTarget();
    expect(partsTarget).toEqual({
      mode: "parts",
      host: "10.0.0.5",
      port: "5433",
      database: "nextdesk_prod",
      user: "nd_user",
      ssl: false,
    });
    expect(JSON.stringify(partsTarget)).not.toContain("hidden-password");

    const poolCfg = buildPgPoolConfig();
    expect(poolCfg.host).toBe("10.0.0.5");
    expect(poolCfg.port).toBe(5433);
    expect(poolCfg.min).toBe(0);
    expect(poolCfg.application_name).toBe("nextdesk");
  });

  test("classifyPostgresError provides actionable root causes", () => {
    expect(classifyPostgresError({ code: "ECONNREFUSED" }).category).toBe(
      "connection_refused",
    );
    expect(classifyPostgresError({ code: "ENOTFOUND" }).category).toBe("dns");
    expect(classifyPostgresError({ code: "28P01" })).toMatchObject({
      category: "auth",
      retryable: false,
    });
    expect(classifyPostgresError({ code: "3D000" })).toMatchObject({
      category: "missing_database",
      retryable: false,
    });
    expect(
      classifyPostgresError({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }).category,
    ).toBe("ssl");
    expect(classifyPostgresError({ code: "ETIMEDOUT" }).category).toBe("timeout");
  });

  test("collectDiagnostics reports a healthy read-only PostgreSQL + Prisma 7 schema", async () => {
    await createTestDb({ truncate: false });
    const report = await collectDiagnostics();
    expect(report.ok).toBe(true);
    expect(report.readOnly).toBe(true);
    expect(report.client).toBe("postgres");
    expect(report.orm).toBe("prisma-7");
    expect(typeof report.latencyMs).toBe("number");
    expect(report.missingTables).toEqual([]);
    expect(report.pendingMigrations).toEqual([]);
    expect(report.failedMigrations).toEqual([]);
    expect(report.leftoverTables).toEqual([]);
    expect(report.appliedMigrations.length).toBeGreaterThanOrEqual(1);
  });
});

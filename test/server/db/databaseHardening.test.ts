import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  buildPgPoolConfig,
  describePgTarget,
  getPostgresTimeouts,
} from "../../../src/server/db/connectionConfig.ts";
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

  test("describePgTarget redacts passwords for URL and parts modes", () => {
    delete process.env.DATABASE_URL;
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
    expect(poolCfg.application_name).toBe("nextdesk");
  });

  test("collectDiagnostics reports a healthy PostgreSQL + Prisma 7 schema", async () => {
    await createTestDb({ truncate: false });
    const report = await collectDiagnostics();
    expect(report.ok).toBe(true);
    expect(report.client).toBe("postgres");
    expect(report.orm).toBe("prisma-7");
    expect(report.missingTables).toEqual([]);
    expect(report.appliedMigrations.length).toBeGreaterThanOrEqual(1);
  });
});

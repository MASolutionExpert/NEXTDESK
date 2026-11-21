import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { readDbConfig } from "../../../src/server/settings/env.ts";

describe("readDbConfig (PostgreSQL-only)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("always uses postgres client even when DB_CLIENT is unset", () => {
    delete process.env.DB_CLIENT;
    const config = readDbConfig();
    expect(config.client).toBe("postgres");
  });

  test("parses PostgreSQL connection fields from POSTGRES_* environment variables", () => {
    process.env.POSTGRES_HOST = "db.example.com";
    process.env.POSTGRES_PORT = "5433";
    process.env.POSTGRES_DB = "nextdesk_prod";
    const config = readDbConfig();
    expect(config.client).toBe("postgres");
    expect(config.postgres.host).toBe("db.example.com");
    expect(config.postgres.port).toBe(5433);
    expect(config.postgres.database).toBe("nextdesk_prod");
  });
});

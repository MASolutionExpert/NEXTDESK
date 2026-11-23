import { describe, expect, test } from "vitest";
import {
  BASELINE_MIGRATION_NAME,
  getAppliedMigrations,
  runDatabaseMigrations,
} from "../../../src/server/db/migrate.ts";

describe("Prisma 7 PostgreSQL Migrations Integration", () => {
  test("applies baseline and records _prisma_migrations cleanly", async () => {
    const first = await runDatabaseMigrations({
      backupBeforeMigrate: false,
      quiet: true,
    });
    expect(first.appliedMigrations).toContain(BASELINE_MIGRATION_NAME);

    const applied = await getAppliedMigrations();
    expect(applied.map((r: any) => r.migration_name)).toContain(BASELINE_MIGRATION_NAME);
  });

  test("migration idempotency: running migrations twice on the same database does not fail", async () => {
    const first = await runDatabaseMigrations({
      backupBeforeMigrate: false,
      quiet: true,
    });
    const second = await runDatabaseMigrations({
      backupBeforeMigrate: false,
      quiet: true,
    });
    expect(second.appliedMigrations).toEqual(first.appliedMigrations);
  });
});

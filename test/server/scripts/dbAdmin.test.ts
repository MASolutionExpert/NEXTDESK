import { describe, expect, test, afterEach } from "vitest";
import { openDatabase } from "../../../src/server/scripts/_db-admin.ts";

describe("openDatabase Admin Utility (PostgreSQL + Prisma 7)", () => {
  let activeDb: Awaited<ReturnType<typeof openDatabase>> | null = null;

  afterEach(async () => {
    if (activeDb) {
      // Do not close shared global pgPool during Vitest suite
      activeDb = null;
    }
  });

  test("opens PostgreSQL database and provides standard admin DB API", async () => {
    activeDb = await openDatabase({ skipMigrations: true });
    expect(activeDb).toBeDefined();
    expect(typeof activeDb.getRow).toBe("function");
    expect(typeof activeDb.getAll).toBe("function");
    expect(typeof activeDb.run).toBe("function");
    expect(typeof activeDb.transaction).toBe("function");
    expect(typeof activeDb.save).toBe("function");
    expect(typeof activeDb.close).toBe("function");

    const row = await activeDb.getRow("SELECT 1 AS count");
    expect(Number(row?.count)).toBe(1);
    const rows = await activeDb.getAll("SELECT 1 AS count");
    expect(rows).toEqual([{ count: 1 }]);
  });

  test("runs Prisma 7 migrations and reports applied migration count", async () => {
    activeDb = await openDatabase();
    const version = await activeDb.getSchemaVersion();
    expect(version).toBeGreaterThanOrEqual(1);
  });
});

import { openDatabase } from "../../../src/server/scripts/_db-admin.ts";
import { migrations } from "../../../src/server/migrations/index.ts";

export async function createTestDb(options: any = {}) {
  return openDatabase({
    inMemory: true,
    skipMigrations: false,
    ...options,
  });
}

export async function createRawTestDb(options: any = {}) {
  return openDatabase({
    inMemory: true,
    skipMigrations: true,
    ...options,
  });
}

export { migrations };

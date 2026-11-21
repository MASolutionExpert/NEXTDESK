import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "./testDbHelper.ts";

describe("pending_presigned_uploads DB table and functions", () => {
  let db: Awaited<ReturnType<typeof createTestDb>> | null = null;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(() => {
    if (db) db.close();
  });

  test("Prisma 7 schema creates pending_presigned_uploads table", async () => {
    expect(await db!.tableExists("pending_presigned_uploads")).toBe(true);
  });

  test("inserts row into pending_presigned_uploads", async () => {
    const key = `uploads/${Date.now()}_test.png`;
    const nowIso = new Date().toISOString();
    await db!.run(
      "INSERT INTO pending_presigned_uploads (storage_key, user_id, created_at) VALUES (?, ?, ?)",
      [key, "user-123", nowIso],
    );
    const pending = await db!.getAll(
      "SELECT * FROM pending_presigned_uploads WHERE storage_key = ?",
      [key],
    );
    expect(pending).toHaveLength(1);
    expect(pending[0].storage_key).toBe(key);
  });

  test("deletes recorded keys when claimed or pruned", async () => {
    const key1 = `uploads/${Date.now()}_test1.png`;
    const key2 = `uploads/${Date.now()}_test2.png`;
    const nowIso = new Date().toISOString();
    await db!.run(
      "INSERT INTO pending_presigned_uploads (storage_key, user_id, created_at) VALUES (?, ?, ?)",
      [key1, "user-123", nowIso],
    );
    await db!.run(
      "INSERT INTO pending_presigned_uploads (storage_key, user_id, created_at) VALUES (?, ?, ?)",
      [key2, "user-123", nowIso],
    );
    await db!.run("DELETE FROM pending_presigned_uploads WHERE storage_key = ?", [key1]);
    const remaining = await db!.getAll(
      "SELECT storage_key FROM pending_presigned_uploads",
    );
    const keys = remaining.map((r) => r.storage_key);
    expect(keys).not.toContain(key1);
    expect(keys).toContain(key2);
  });

  test("supports created_at cutoff filtering for orphan pruning", async () => {
    const oldKey = "uploads/old_test.png";
    const newKey = "uploads/new_test.png";
    const oldIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const newIso = new Date().toISOString();
    await db!.run(
      "INSERT INTO pending_presigned_uploads (storage_key, user_id, created_at) VALUES (?, ?, ?)",
      [oldKey, "user-123", oldIso],
    );
    await db!.run(
      "INSERT INTO pending_presigned_uploads (storage_key, user_id, created_at) VALUES (?, ?, ?)",
      [newKey, "user-123", newIso],
    );
    const cutoffIso = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const expired = await db!.getAll(
      "SELECT storage_key FROM pending_presigned_uploads WHERE created_at <= ?",
      [cutoffIso],
    );
    const expiredKeys = expired.map((r) => r.storage_key);
    expect(expiredKeys).toContain(oldKey);
    expect(expiredKeys).not.toContain(newKey);
  });
});

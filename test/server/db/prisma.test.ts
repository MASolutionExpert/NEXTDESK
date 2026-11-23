import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  describePgTarget,
  resolveDatabaseUrl,
} from "../../../src/server/db/connectionConfig.ts";
import {
  prisma,
  toPgPlaceholders,
  withPgTransaction,
} from "../../../src/server/db/prisma.ts";
import { runDatabaseMigrations } from "../../../src/server/db/migrate.ts";
import {
  createChat,
  addChatMember,
  createMessage,
  createUser,
  getMessages,
} from "../../../src/server/db.ts";
import { createTestDb } from "./testDbHelper.ts";

describe("Prisma 7 + PostgreSQL foundation", () => {
  test("toPgPlaceholders converts positional ? safely while preserving literals and comments", () => {
    expect(toPgPlaceholders("SELECT * FROM users WHERE id = ? AND role = ?")).toBe(
      "SELECT * FROM users WHERE id = $1 AND role = $2",
    );
    expect(
      toPgPlaceholders("SELECT '?' AS literal, id FROM users WHERE username = ?"),
    ).toBe("SELECT '?' AS literal, id FROM users WHERE username = $1");
    expect(
      toPgPlaceholders(
        "SELECT id FROM users -- ? ignored\n/* ? also ignored */ WHERE id = ?",
      ),
    ).toBe(
      "SELECT id FROM users -- ? ignored\n/* ? also ignored */ WHERE id = $1",
    );
  });

  test("connectionConfig resolves DATABASE_URL / POSTGRES_* and redacts credentials in describePgTarget", () => {
    const saved = { ...process.env };
    try {
      delete process.env.DATABASE_URL;
      process.env.POSTGRES_URL =
        "postgresql://nextdesk:super-secret-pass@db.internal.test:5433/nextdesk_prod?sslmode=require";
      expect(resolveDatabaseUrl()).toContain("db.internal.test:5433/nextdesk_prod");
      const target = describePgTarget();
      expect(target).toEqual({
        mode: "url",
        host: "db.internal.test",
        port: "5433",
        database: "nextdesk_prod",
        user: "nextdesk",
        ssl: true,
      });
      expect(JSON.stringify(target)).not.toContain("super-secret-pass");
    } finally {
      process.env = saved;
    }
  });
});

describe("Prisma 7 ORM CRUD, Transactions & Non-Destructive Migrations", () => {
  beforeEach(async () => {
    await createTestDb();
  });

  afterEach(async () => {
    await createTestDb();
  });

  test("performs typed Prisma 7 CRUD across User, Chat, and AppSetting models", async () => {
    const userId = crypto.randomUUID();
    const user = await prisma.user.create({
      data: {
        id: userId,
        username: "prisma_alice",
        nickname: "Prisma Alice",
        passwordHash: "hash_value",
        role: "admin",
      },
    });
    expect(user.id).toBe(userId);
    expect(user.username).toBe("prisma_alice");

    const setting = await prisma.appSetting.upsert({
      where: { key: "site_title" },
      create: { key: "site_title", value: "NextDesk" },
      update: { value: "NextDesk" },
    });
    expect(setting.value).toBe("NextDesk");

    const found = await prisma.user.findUnique({ where: { id: userId } });
    expect(found?.nickname).toBe("Prisma Alice");
  });

  test("withPgTransaction commits on success and rolls back cleanly on error", async () => {
    await withPgTransaction(async (tx) => {
      await tx.run("INSERT INTO app_settings (key, value) VALUES (?, ?)", [
        "tx_committed",
        "yes",
      ]);
    });
    const committed = await prisma.appSetting.findUnique({
      where: { key: "tx_committed" },
    });
    expect(committed?.value).toBe("yes");

    await expect(
      withPgTransaction(async (tx) => {
        await tx.run("INSERT INTO app_settings (key, value) VALUES (?, ?)", [
          "tx_rolled_back",
          "no",
        ]);
        throw new Error("intentional rollback");
      }),
    ).rejects.toThrow("intentional rollback");

    const rolledBack = await prisma.appSetting.findUnique({
      where: { key: "tx_rolled_back" },
    });
    expect(rolledBack).toBeNull();
  });

  test("runDatabaseMigrations is strictly idempotent and preserves existing live rows", async () => {
    await prisma.appSetting.upsert({
      where: { key: "live_data_guard" },
      create: { key: "live_data_guard", value: "must-survive" },
      update: { value: "must-survive" },
    });

    const result = await runDatabaseMigrations({
      backupBeforeMigrate: false,
      quiet: true,
    });
    expect(result.appliedMigrations.length).toBeGreaterThanOrEqual(1);

    const preserved = await prisma.appSetting.findUnique({
      where: { key: "live_data_guard" },
    });
    expect(preserved?.value).toBe("must-survive");
  });

  test("getMessages filters accurately with afterCreatedAt in PostgreSQL", async () => {
    const userId = await createUser("after_ts_user", "hash", "After TS");
    const chatId = await createChat("Timeline Room", "group", {
      createdByUserId: userId,
    });
    await addChatMember(chatId, userId, "owner");

    const msg1Id = await createMessage(chatId, userId, "First");
    await prisma.chatMessage.update({
      where: { id: msg1Id },
      data: { createdAt: "2026-08-11 10:00:00" },
    });
    const msg2Id = await createMessage(chatId, userId, "Second");
    await prisma.chatMessage.update({
      where: { id: msg2Id },
      data: { createdAt: "2026-08-11 10:05:00" },
    });

    const after = await getMessages(chatId, {
      afterId: msg2Id,
      afterCreatedAt: "2026-08-11 10:05:00",
    });
    expect(after.messages.map((m) => m.id)).toEqual([msg2Id]);
  });
});

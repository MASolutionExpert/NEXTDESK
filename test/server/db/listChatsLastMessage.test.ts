import { describe, expect, test, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { createTestDb } from "./testDbHelper.ts";
import { storageEncryption } from "../../../src/server/lib/storageEncryption.ts";
import { listChatsForUser } from "../../../src/server/db.ts";

describe("listChatsForUser last_message ordering and update regression", () => {
  let db: Awaited<ReturnType<typeof createTestDb>> | null = null;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  test("listChatsForUser selects latest message by created_at regardless of UUID sort order", async () => {
    const userId = crypto.randomUUID();
    const chatId = crypto.randomUUID();
    await db!.run("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)", [
      userId,
      "alice",
      "hash",
    ]);
    await db!.run(
      "INSERT INTO chats (id, name, type, created_by_user_id) VALUES (?, ?, ?, ?)",
      [chatId, "Test Group", "group", userId],
    );
    await db!.run(
      "INSERT INTO chat_members (chat_id, user_id, role) VALUES (?, ?, ?)",
      [chatId, userId, "owner"],
    );

    const msg1Id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const msg1Body = storageEncryption.encryptText("First message");
    await db!.run(
      "INSERT INTO chat_messages (id, chat_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
      [msg1Id, chatId, userId, msg1Body, "2026-08-11 10:00:00"],
    );

    const msg2Id = "00000000-0000-4000-8000-000000000000";
    const msg2Body = storageEncryption.encryptText("Second message");
    await db!.run(
      "INSERT INTO chat_messages (id, chat_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
      [msg2Id, chatId, userId, msg2Body, "2026-08-11 10:05:00"],
    );

    const chats = await listChatsForUser(userId);
    expect(chats.length).toBe(1);
    expect(chats[0].last_message_id).toBe(msg2Id);
    expect(chats[0].last_message).toBe("Second message");
  });

  test("listChatsForUser updates last_message preview when latest message is edited", async () => {
    const userId = crypto.randomUUID();
    const chatId = crypto.randomUUID();
    await db!.run("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)", [
      userId,
      "alice",
      "hash",
    ]);
    await db!.run(
      "INSERT INTO chats (id, name, type, created_by_user_id) VALUES (?, ?, ?, ?)",
      [chatId, "Test Group", "group", userId],
    );
    await db!.run(
      "INSERT INTO chat_members (chat_id, user_id, role) VALUES (?, ?, ?)",
      [chatId, userId, "owner"],
    );

    const msgId = "11111111-1111-4111-8111-111111111111";
    const initialBody = storageEncryption.encryptText("Original text");
    await db!.run(
      "INSERT INTO chat_messages (id, chat_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
      [msgId, chatId, userId, initialBody, "2026-08-11 10:00:00"],
    );

    const editedBody = storageEncryption.encryptText("Edited text");
    await db!.run("UPDATE chat_messages SET edited_body = ? WHERE id = ?", [
      editedBody,
      msgId,
    ]);

    const chats = await listChatsForUser(userId);
    expect(chats.length).toBe(1);
    expect(chats[0].last_message_id).toBe(msgId);
    expect(chats[0].last_message).toBe("Edited text");
  });

  test("listChatsForUser updates last_message preview when latest message is deleted", async () => {
    const userId = crypto.randomUUID();
    const chatId = crypto.randomUUID();
    await db!.run("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)", [
      userId,
      "alice",
      "hash",
    ]);
    await db!.run(
      "INSERT INTO chats (id, name, type, created_by_user_id) VALUES (?, ?, ?, ?)",
      [chatId, "Test Group", "group", userId],
    );
    await db!.run(
      "INSERT INTO chat_members (chat_id, user_id, role) VALUES (?, ?, ?)",
      [chatId, userId, "owner"],
    );

    const msg1Id = "11111111-1111-4111-8111-111111111111";
    const msg1Body = storageEncryption.encryptText("First message");
    await db!.run(
      "INSERT INTO chat_messages (id, chat_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
      [msg1Id, chatId, userId, msg1Body, "2026-08-11 10:00:00"],
    );

    const msg2Id = "22222222-2222-4222-8222-222222222222";
    const msg2Body = storageEncryption.encryptText("Second message");
    await db!.run(
      "INSERT INTO chat_messages (id, chat_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
      [msg2Id, chatId, userId, msg2Body, "2026-08-11 10:05:00"],
    );

    await db!.run(
      "UPDATE chat_messages SET hidden_everyone_at = '2026-08-11 10:06:00' WHERE id = ?",
      [msg2Id],
    );

    const chats = await listChatsForUser(userId);
    expect(chats.length).toBe(1);
    expect(chats[0].last_message_id).toBe(msg1Id);
    expect(chats[0].last_message).toBe("First message");
  });
});

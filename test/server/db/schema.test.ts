import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createTestDb } from "./testDbHelper.ts";

describe("Database Schema Integration (PostgreSQL + Prisma 7)", () => {
  let dbHelper: Awaited<ReturnType<typeof createTestDb>> | null = null;

  beforeEach(async () => {
    dbHelper = await createTestDb({ truncate: false });
  });

  afterEach(() => {
    if (dbHelper) {
      dbHelper.close();
      dbHelper = null;
    }
  });

  test("creates all key tables in PostgreSQL", async () => {
    const keyTables = [
      "meta",
      "users",
      "chats",
      "chat_members",
      "chat_messages",
      "chat_message_files",
      "chat_message_reads",
      "hidden_chats",
      "hidden_chat_messages",
      "sessions",
      "push_subscriptions",
      "remote_channel_sources",
      "remote_channel_queue",
      "app_settings",
      "admin_audit_logs",
      "pending_presigned_uploads",
    ];
    for (const table of keyTables) {
      expect(await dbHelper!.tableExists(table), `table ${table} exists`).toBe(true);
    }
  });

  test("creates expected columns on key tables", async () => {
    expect(await dbHelper!.hasColumn("users", "id")).toBe(true);
    expect(await dbHelper!.hasColumn("users", "username")).toBe(true);
    expect(await dbHelper!.hasColumn("users", "password_hash")).toBe(true);
    expect(await dbHelper!.hasColumn("users", "role")).toBe(true);
    expect(await dbHelper!.hasColumn("users", "verified")).toBe(true);
    expect(await dbHelper!.hasColumn("users", "banned")).toBe(true);

    expect(await dbHelper!.hasColumn("chats", "id")).toBe(true);
    expect(await dbHelper!.hasColumn("chats", "name")).toBe(true);
    expect(await dbHelper!.hasColumn("chats", "type")).toBe(true);
    expect(await dbHelper!.hasColumn("chats", "allow_member_invites")).toBe(true);
    expect(await dbHelper!.hasColumn("chats", "verified")).toBe(true);
    expect(await dbHelper!.hasColumn("chats", "auto_add_new_users")).toBe(true);

    expect(await dbHelper!.hasColumn("chat_members", "chat_id")).toBe(true);
    expect(await dbHelper!.hasColumn("chat_members", "user_id")).toBe(true);
    expect(await dbHelper!.hasColumn("chat_members", "role")).toBe(true);

    expect(await dbHelper!.hasColumn("chat_messages", "id")).toBe(true);
    expect(await dbHelper!.hasColumn("chat_messages", "chat_id")).toBe(true);
    expect(await dbHelper!.hasColumn("chat_messages", "user_id")).toBe(true);
    expect(await dbHelper!.hasColumn("chat_messages", "body")).toBe(true);
    expect(await dbHelper!.hasColumn("chat_messages", "client_request_id")).toBe(true);
    expect(await dbHelper!.hasColumn("chat_messages", "edited")).toBe(true);
    expect(await dbHelper!.hasColumn("chat_messages", "edited_body")).toBe(true);
    expect(await dbHelper!.hasColumn("chat_messages", "hidden_everyone_at")).toBe(true);
    expect(await dbHelper!.hasColumn("chat_messages", "expires_at")).toBe(true);

    expect(await dbHelper!.hasColumn("remote_channel_sources", "id")).toBe(true);
    expect(await dbHelper!.hasColumn("remote_channel_sources", "chat_id")).toBe(true);
    expect(await dbHelper!.hasColumn("remote_channel_sources", "provider")).toBe(true);
    expect(await dbHelper!.hasColumn("remote_channel_sources", "paused")).toBe(true);

    expect(await dbHelper!.hasColumn("remote_channel_queue", "id")).toBe(true);
    expect(await dbHelper!.hasColumn("remote_channel_queue", "source_id")).toBe(true);
    expect(await dbHelper!.hasColumn("remote_channel_queue", "status")).toBe(true);

    expect(await dbHelper!.hasColumn("app_settings", "key")).toBe(true);
    expect(await dbHelper!.hasColumn("app_settings", "value")).toBe(true);
  });
});

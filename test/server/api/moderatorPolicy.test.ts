import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import { makeApp, makeUserStore } from "../helpers/makeApp.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const DM_CHAT_ID = "33333333-3333-4333-8333-333333333333";
const GROUP_CHAT_ID = "44444444-4444-4444-8444-444444444444";
const MSG_ID = "55555555-5555-4555-8555-555555555555";

describe("Moderator-only edit & delete policy", () => {
  const regularUser = { id: USER_ID, username: "alice", nickname: "Alice", role: "user" };
  const adminUser = { id: ADMIN_ID, username: "mod", nickname: "Mod", role: "admin" };

  function buildApp(extraDeps: Record<string, any> = {}) {
    const message = {
      id: MSG_ID,
      chat_id: DM_CHAT_ID,
      user_id: USER_ID,
      username: "alice",
      body: "Original text",
      created_at: new Date().toISOString(),
    };
    const instance = makeApp({
      userStore: makeUserStore([regularUser, adminUser]),
      deps: {
        findChatById: vi.fn((id: string) =>
          id === DM_CHAT_ID
            ? { id: DM_CHAT_ID, type: "dm", channel: "direct" }
            : id === GROUP_CHAT_ID
              ? { id: GROUP_CHAT_ID, type: "group", name: "General" }
              : null,
        ),
        isMember: vi.fn(() => true),
        listChatMembers: vi.fn(() => [regularUser, adminUser]),
        findMessageById: vi.fn((id: string) => (id === MSG_ID ? message : null)),
        updateMessageBody: vi.fn(() => true),
        deleteMessagesForEveryone: vi.fn(() => [MSG_ID]),
        hideMessagesForUser: vi.fn(() => true),
        hideChatsForUser: vi.fn(() => true),
        ...extraDeps,
      },
    });
    instance.sessionStore.createSession(USER_ID, "user-sid");
    instance.sessionStore.createSession(ADMIN_ID, "admin-sid");
    return instance;
  }

  test("rejects message edit from regular user with 403", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/messages/edit")
      .set("Cookie", "sid=user-sid")
      .send({ username: "alice", chatId: DM_CHAT_ID, messageId: MSG_ID, body: "Changed" });
    expect(res.status).toBe(403);
  });

  test("rejects message delete (everyone and self) from regular user with 403", async () => {
    const { app } = buildApp();
    const resEveryone = await request(app)
      .post("/api/messages/delete")
      .set("Cookie", "sid=user-sid")
      .send({ username: "alice", chatId: DM_CHAT_ID, messageIds: [MSG_ID], scope: "everyone" });
    expect(resEveryone.status).toBe(403);

    const resSelf = await request(app)
      .post("/api/messages/delete")
      .set("Cookie", "sid=user-sid")
      .send({ username: "alice", chatId: DM_CHAT_ID, messageIds: [MSG_ID], scope: "self" });
    expect(resSelf.status).toBe(403);
  });

  test("rejects hiding DM thread for regular user with 403, but allows hiding group chat", async () => {
    const { app } = buildApp();
    const dmRes = await request(app)
      .post("/api/chats/hide")
      .set("Cookie", "sid=user-sid")
      .send({ username: "alice", chatIds: [DM_CHAT_ID] });
    expect(dmRes.status).toBe(403);

    const groupRes = await request(app)
      .post("/api/chats/hide")
      .set("Cookie", "sid=user-sid")
      .send({ username: "alice", chatIds: [GROUP_CHAT_ID] });
    expect(groupRes.status).toBe(200);
  });

  test("allows admin to delete another participant's message for everyone and writes audit log", async () => {
    const writeAdminAuditLog = vi.fn();
    const { app } = buildApp({ writeAdminAuditLog });
    const res = await request(app)
      .post("/api/messages/delete")
      .set("Cookie", "sid=admin-sid")
      .send({ username: "mod", chatId: DM_CHAT_ID, messageIds: [MSG_ID], scope: "everyone" });
    expect(res.status).toBe(200);
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUsername: "mod",
        action: "message.delete.everyone",
      }),
    );
  });
});

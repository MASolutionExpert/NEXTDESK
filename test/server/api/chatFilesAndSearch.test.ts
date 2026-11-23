import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import { makeApp, makeUserStore } from "../helpers/makeApp.ts";

const ALICE_ID = "11111111-1111-4111-8111-111111111111";
const OUTSIDER_ID = "22222222-2222-4222-8222-222222222222";
const CHAT_ID = "33333333-3333-4333-8333-333333333333";
const MSG_ID = "44444444-4444-4444-8444-444444444444";

describe("Per-thread Files Gallery and Search APIs", () => {
  const alice = { id: ALICE_ID, username: "alice", nickname: "Alice", role: "user" };
  const outsider = { id: OUTSIDER_ID, username: "eve", nickname: "Eve", role: "user" };

  function buildApp(extraDeps: Record<string, any> = {}) {
    const instance = makeApp({
      userStore: makeUserStore([alice, outsider]),
      deps: {
        findChatById: vi.fn((id: string) => (id === CHAT_ID ? { id: CHAT_ID, type: "dm" } : null)),
        isMember: vi.fn((chatId: string, userId: string) => chatId === CHAT_ID && userId === ALICE_ID),
        listChatFilesForUser: vi.fn(async () => [
          {
            id: "file-1",
            message_id: MSG_ID,
            original_name: "invoice.pdf",
            stored_name: "invoice-stored.pdf",
            mime_type: "application/pdf",
            size_bytes: 2048,
            storage_key: null,
            thumb_key: null,
            created_at: "2026-11-23T10:00:00.000Z",
            sender_username: "alice",
            sender_nickname: "Alice",
          },
        ]),
        countChatFilesForUser: vi.fn(async () => 1),
        searchChatMessagesForUser: vi.fn(async () => ({
          matches: [
            {
              id: MSG_ID,
              chat_id: CHAT_ID,
              body: "Here is the invoice",
              created_at: "2026-11-23T10:00:00.000Z",
              username: "alice",
              nickname: "Alice",
            },
          ],
          total: 1,
          hasMore: false,
        })),
        ...extraDeps,
      },
    });
    instance.sessionStore.createSession(ALICE_ID, "alice-sid");
    instance.sessionStore.createSession(OUTSIDER_ID, "eve-sid");
    return instance;
  }

  test("GET /api/chats/:chatId/files enforces membership and returns files with pagination metadata", async () => {
    const { app } = buildApp();
    const forbidden = await request(app)
      .get(`/api/chats/${CHAT_ID}/files?username=eve`)
      .set("Cookie", "sid=eve-sid");
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .get(`/api/chats/${CHAT_ID}/files?username=alice&limit=20&offset=0`)
      .set("Cookie", "sid=alice-sid");
    expect(ok.status).toBe(200);
    expect(ok.body.total).toBe(1);
    expect(ok.body.files).toHaveLength(1);
    expect(ok.body.files[0].originalName).toBe("invoice.pdf");
    expect(ok.body.hasMore).toBe(false);
  });

  test("GET /api/chats/:chatId/search validates non-empty query, enforces membership, and returns matches", async () => {
    const { app } = buildApp();
    const emptyQ = await request(app)
      .get(`/api/chats/${CHAT_ID}/search?username=alice&q=`)
      .set("Cookie", "sid=alice-sid");
    expect(emptyQ.status).toBe(400);

    const forbidden = await request(app)
      .get(`/api/chats/${CHAT_ID}/search?username=eve&q=invoice`)
      .set("Cookie", "sid=eve-sid");
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .get(`/api/chats/${CHAT_ID}/search?username=alice&q=invoice`)
      .set("Cookie", "sid=alice-sid");
    expect(ok.status).toBe(200);
    expect(ok.body.total).toBe(1);
    expect(ok.body.matches[0].id).toBe(MSG_ID);
  });
});

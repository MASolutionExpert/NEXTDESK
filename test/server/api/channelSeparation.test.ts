import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import { makeApp, makeUserStore } from "../helpers/makeApp.ts";

const ALICE_ID = "11111111-1111-4111-8111-111111111111";
const BOB_ID = "22222222-2222-4222-8222-222222222222";
const DIRECT_CHAT_ID = "33333333-3333-4333-8333-333333333333";
const SUPPORT_CHAT_ID = "44444444-4444-4444-8444-444444444444";

describe("Channel separation (direct vs support)", () => {
  test("POST /api/chats/dm looks up and creates strictly direct-channel chats", async () => {
    const alice = { id: ALICE_ID, username: "alice", nickname: "Alice", role: "user" };
    const bob = { id: BOB_ID, username: "bob", nickname: "Bob", role: "operator" };

    const findDmChat = vi.fn((_u1: string, _u2: string, opts?: any) => {
      if (opts?.channel === "support") {
        return { id: SUPPORT_CHAT_ID, type: "dm", channel: "support" };
      }
      return null;
    });
    const createChat = vi.fn((_name: any, _type: any, opts?: any) =>
      opts?.channel === "direct" ? DIRECT_CHAT_ID : SUPPORT_CHAT_ID,
    );

    const { app, sessionStore } = makeApp({
      userStore: makeUserStore([alice, bob]),
      deps: {
        findDmChat,
        createChat,
        findChatById: vi.fn((id: string) => ({
          id,
          type: "dm",
          channel: id === DIRECT_CHAT_ID ? "direct" : "support",
        })),
        listChatMembers: vi.fn(() => [alice, bob]),
      },
    });
    sessionStore.createSession(ALICE_ID, "alice-sid");

    const res = await request(app)
      .post("/api/chats/dm")
      .set("Cookie", "sid=alice-sid")
      .send({ username: "alice", targetUsername: "bob" });

    expect(res.status).toBe(200);
    expect(findDmChat).toHaveBeenCalledWith(ALICE_ID, BOB_ID, { channel: "direct" });
    expect(createChat).toHaveBeenCalledWith(null, "dm", expect.objectContaining({ channel: "direct" }));
    expect(res.body.chatId).toBe(DIRECT_CHAT_ID);
  });

  test("POST /api/chats/dm strips leading @ on targetUsername", async () => {
    const alice = { id: ALICE_ID, username: "alice", nickname: "Alice", role: "user" };
    const bob = { id: BOB_ID, username: "bob", nickname: "Bob", role: "user" };

    const findDmChat = vi.fn(() => ({
      id: DIRECT_CHAT_ID,
      type: "dm",
      channel: "direct",
    }));

    const { app, sessionStore } = makeApp({
      userStore: makeUserStore([alice, bob]),
      deps: {
        findDmChat,
        findChatById: vi.fn(() => ({ id: DIRECT_CHAT_ID, type: "dm", channel: "direct" })),
        listChatMembers: vi.fn(() => [alice, bob]),
      },
    });
    sessionStore.createSession(ALICE_ID, "alice-sid");

    const res = await request(app)
      .post("/api/chats/dm")
      .set("Cookie", "sid=alice-sid")
      .send({ username: "alice", targetUsername: "@bob" });

    expect(res.status).toBe(200);
    expect(res.body.chatId).toBe(DIRECT_CHAT_ID);
  });
});

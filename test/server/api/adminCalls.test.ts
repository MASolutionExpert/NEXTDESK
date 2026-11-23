import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import { makeApp, makeUserStore } from "../helpers/makeApp.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";

describe("GET /api/admin/calls", () => {
  test("requires admin privileges and forwards filters/sorting to adminListCalls", async () => {
    const regularUser = { id: USER_ID, username: "alice", nickname: "Alice", role: "user" };
    const adminUser = { id: ADMIN_ID, username: "admin", nickname: "Admin", role: "admin" };

    const adminListCalls = vi.fn(async () => ({
      calls: [
        {
          id: "msg-1",
          chatId: "chat-1",
          chatName: "alice, bob",
          chatType: "dm",
          chatChannel: "direct",
          callType: "video",
          outcome: "connected",
          durationSeconds: 95,
          createdAt: "2026-11-23T12:00:00.000Z",
          caller: { id: USER_ID, username: "alice", nickname: "Alice" },
        },
      ],
      total: 1,
    }));

    const { app, sessionStore } = makeApp({
      userStore: makeUserStore([regularUser, adminUser]),
      deps: {
        isUserAdmin: (u: any) => u?.role === "admin",
        adminListCalls,
      },
    });
    sessionStore.createSession(USER_ID, "user-sid");
    sessionStore.createSession(ADMIN_ID, "admin-sid");

    const denied = await request(app)
      .get("/api/admin/calls")
      .set("Cookie", "sid=user-sid");
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .get("/api/admin/calls?search=alice&type=video&outcome=connected&sortBy=duration&sortDir=ASC&limit=25&offset=0")
      .set("Cookie", "sid=admin-sid");
    expect(ok.status).toBe(200);
    expect(ok.body.total).toBe(1);
    expect(ok.body.calls).toHaveLength(1);
    expect(adminListCalls).toHaveBeenCalledWith(
      expect.objectContaining({
        search: "alice",
        typeFilter: "video",
        outcomeFilter: "connected",
        sortBy: "duration",
        sortDir: "ASC",
        limit: 25,
        offset: 0,
      }),
    );
  });
});

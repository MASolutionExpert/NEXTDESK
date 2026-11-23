import { describe, it, expect, vi, afterEach } from "vitest";
import { createCallManager } from "../../../src/server/lib/callManager.ts";

const CHAT_1 = "11111111-1111-4111-8111-111111111111";
const CHAT_2 = "22222222-2222-4222-8222-222222222222";
const ALICE = { id: "aaaa1111-1111-4111-8111-111111111111", username: "alice", nickname: "Alice" };
const BOB = { id: "bbbb2222-2222-4222-8222-222222222222", username: "bob", nickname: "Bob" };
const CAROL = { id: "cccc3333-3333-4333-8333-333333333333", username: "carol", nickname: "Carol" };

function buildManager(overrides: Record<string, any> = {}) {
  const events: any[] = [];
  const emitted: any[] = [];
  const messages: any[] = [];
  const dismissPush = vi.fn();
  const isUserConnected = vi.fn(() => true);

  const deps: any = {
    isMember: vi.fn(() => true),
    findChatById: vi.fn((id: string) => ({ id, type: "dm" })),
    listChatMembers: vi.fn((id: string) => (id === CHAT_2 ? [CAROL, BOB] : [ALICE, BOB])),
    findUserById: vi.fn((id: string) =>
      id === ALICE.id ? ALICE : id === BOB.id ? BOB : CAROL,
    ),
    findUserByUsername: vi.fn((u: string) =>
      u === "alice" ? ALICE : u === "bob" ? BOB : CAROL,
    ),
    emitSseEvent: vi.fn((user: string, type: string, payload: any) => {
      emitted.push({ user, type, payload });
    }),
    sendCallPushNotification: vi.fn(),
    dismissCallPushNotification: dismissPush,
    isUserConnected,
    createMessage: vi.fn((payload: any) => {
      const id = `msg-${messages.length + 1}`;
      messages.push({ id, ...payload });
      return id;
    }),
    updateMessageBody: vi.fn((id: string, body: string) => {
      const m = messages.find((item) => item.id === id);
      if (m) m.body = body;
      return true;
    }),
    getAppSetting: vi.fn((key: string) => {
      if (key === "CALL_MAX_DURATION") return "300";
      return "";
    }),
    ...overrides,
  };

  const cm = createCallManager(deps);
  return { cm, deps, events, emitted, messages, dismissPush, isUserConnected };
}

describe("callManager stability & lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("acceptCall returns pure JSON-serializable call object even when CALL_MAX_DURATION timer is active", async () => {
    const { cm } = buildManager();
    try {
      await cm.startCall({ user: ALICE, chatId: CHAT_1, type: "voice" });
      const res: any = await cm.acceptCall({ user: BOB, chatId: CHAT_1 });
      expect(res.status).toBe(200);
      expect(() => JSON.stringify(res)).not.toThrow();
      expect(res.call.state).toBe("active");
    } finally {
      cm.stop();
    }
  });

  it("returns 409 callee_busy when callee is already in another call", async () => {
    const { cm } = buildManager();
    try {
      await cm.startCall({ user: ALICE, chatId: CHAT_1, type: "voice" });
      const busyRes: any = await cm.startCall({ user: CAROL, chatId: CHAT_2, type: "voice" });
      expect(busyRes.status).toBe(409);
      expect(busyRes.code).toBe("callee_busy");
    } finally {
      cm.stop();
    }
  });

  it("resumes ringing call when same caller redials while still ringing", async () => {
    const { cm } = buildManager();
    try {
      const first: any = await cm.startCall({ user: ALICE, chatId: CHAT_1, type: "voice" });
      expect(first.status).toBe(200);
      const second: any = await cm.startCall({ user: ALICE, chatId: CHAT_1, type: "voice" });
      expect(second.status).toBe(200);
      expect(second.resumed).toBe(true);
    } finally {
      cm.stop();
    }
  });

  it("records missed call and broadcasts call:ring-ended after 60s ring timeout", async () => {
    vi.useFakeTimers();
    const { cm, emitted, messages, dismissPush } = buildManager();
    try {
      await cm.startCall({ user: ALICE, chatId: CHAT_1, type: "voice" });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(messages[0].body).toBe("[[call:voice:missed]]");
      expect(dismissPush).toHaveBeenCalled();
      expect(
        emitted.some((e) => e.user === "bob" && e.type === "call:ring-ended"),
      ).toBe(true);
      expect(
        emitted.some((e) => e.user === "alice" && e.type === "call:ended" && e.payload.reason === "missed"),
      ).toBe(true);
    } finally {
      cm.stop();
    }
  });

  it("records declined vs failed call logs based on reject reason", async () => {
    const { cm, messages, emitted } = buildManager();
    try {
      await cm.startCall({ user: ALICE, chatId: CHAT_1, type: "voice" });
      await cm.rejectCall({ user: BOB, chatId: CHAT_1, reason: "declined" });
      expect(messages[0].body).toBe("[[call:voice:declined]]");
      expect(
        emitted.some((e) => e.user === "alice" && e.type === "call:rejected" && e.payload.reason === "declined"),
      ).toBe(true);

      await cm.startCall({ user: ALICE, chatId: CHAT_1, type: "video" });
      await cm.rejectCall({ user: BOB, chatId: CHAT_1, reason: "peer_media_failed" });
      expect(messages[1].body).toBe("[[call:video:failed]]");
      expect(
        emitted.some((e) => e.user === "alice" && e.type === "call:rejected" && e.payload.reason === "peer_media_failed"),
      ).toBe(true);
    } finally {
      cm.stop();
    }
  });

  it("reaps stale calls only after 45s both-offline grace window, keeping online calls alive", async () => {
    let online = true;
    const { cm, messages } = buildManager({
      isUserConnected: vi.fn(() => online),
    });
    try {
      const startTime = Date.now();
      await cm.startCall({ user: ALICE, chatId: CHAT_1, type: "voice" });
      await cm.acceptCall({ user: BOB, chatId: CHAT_1 });

      // Both online: reaper keeps call alive
      cm.reapStaleCalls(startTime + 60_000);
      expect(cm.getActiveCall(CHAT_1)).not.toBeNull();

      // Both go offline: first sweep records grace start, does NOT reap yet
      online = false;
      cm.reapStaleCalls(startTime + 70_000);
      expect(cm.getActiveCall(CHAT_1)).not.toBeNull();

      // After 45s grace window elapsed: reaper cleans up call cleanly
      cm.reapStaleCalls(startTime + 70_000 + 46_000);
      expect(cm.getActiveCall(CHAT_1)).toBeNull();
      expect(messages[0].body).toMatch(/^\[\[call:voice:connected:\d+\]\]$/);
    } finally {
      cm.stop();
    }
  });
});

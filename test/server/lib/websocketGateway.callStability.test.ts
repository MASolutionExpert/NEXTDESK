import { describe, test, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createWebSocketGateway } from "../../../src/server/lib/websocketGateway.ts";

describe("WebSocket Gateway Call Stability", () => {
  test("only calls cleanupUserCalls when the user has no remaining live sessions", async () => {
    const callManager: any = {
      startCall: vi.fn(async () => ({ status: 200 })),
      acceptCall: vi.fn(async () => ({ status: 200 })),
      rejectCall: vi.fn(async () => ({ status: 200 })),
      endCall: vi.fn(async () => ({ status: 200 })),
      relaySignal: vi.fn(async () => ({ status: 200 })),
      cleanupUserCalls: vi.fn(),
    };

    let stillConnected = true;
    const gateway: any = createWebSocketGateway({
      callManager,
      isUserConnected: vi.fn(() => stillConnected),
      onUserDisconnected: vi.fn(),
    });

    const ws1: any = new EventEmitter();
    ws1.isAlive = true;
    ws1.readyState = 1;
    ws1.send = vi.fn();

    const session: any = { id: "user-1", username: "alice" };
    gateway.wss.emit("connection", ws1, {}, session);

    // Close first session while another session is still connected
    stillConnected = true;
    ws1.emit("close");
    expect(callManager.cleanupUserCalls).not.toHaveBeenCalled();

    // Open and close the last session
    const ws2: any = new EventEmitter();
    ws2.isAlive = true;
    ws2.readyState = 1;
    ws2.send = vi.fn();
    gateway.wss.emit("connection", ws2, {}, session);

    stillConnected = false;
    ws2.emit("close");
    expect(callManager.cleanupUserCalls).toHaveBeenCalledWith("user-1", "alice");
  });

  test("emits call:error back to sender when relaySignal fails", async () => {
    const callManager: any = {
      startCall: vi.fn(async () => ({ status: 200 })),
      acceptCall: vi.fn(async () => ({ status: 200 })),
      rejectCall: vi.fn(async () => ({ status: 200 })),
      endCall: vi.fn(async () => ({ status: 200 })),
      relaySignal: vi.fn(async () => ({
        status: 404,
        error: "No active call in this chat",
        code: "no_active_call",
      })),
      cleanupUserCalls: vi.fn(),
    };

    const gateway: any = createWebSocketGateway({ callManager });
    const ws: any = new EventEmitter();
    ws.isAlive = true;
    ws.readyState = 1;
    ws.send = vi.fn();

    const session: any = { id: "user-1", username: "alice" };
    gateway.wss.emit("connection", ws, {}, session);

    ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          action: "call_signal",
          signalType: "offer",
          chatId: "chat-uuid-1",
          data: { sdp: { type: "offer", sdp: "v=0" } },
        }),
      ),
    );

    await new Promise((r) => setTimeout(r, 15));
    expect(ws.send).toHaveBeenCalled();
    const sentPayloads = ws.send.mock.calls.map(([raw]: any) => JSON.parse(raw));
    expect(
      sentPayloads.some(
        (msg: any) =>
          msg.type === "call:error" &&
          msg.chatId === "chat-uuid-1" &&
          msg.signalType === "offer" &&
          msg.code === "no_active_call",
      ),
    ).toBe(true);
  });
});

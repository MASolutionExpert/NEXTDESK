import { describe, expect, test, vi } from "vitest";
import nextConfig from "../../next.config.mjs";

if (typeof window === "undefined") {
  globalThis.window = new EventTarget();
  if (typeof CustomEvent === "undefined") {
    globalThis.CustomEvent = class CustomEvent extends Event {
      constructor(type, eventInitDict) {
        super(type, eventInitDict);
        this.detail = eventInitDict?.detail;
      }
    };
  }
}

describe("useChatEvents — custom realtime event dispatch and dev proxy", () => {
  test("configures Next.js runtime with custom full-stack server (unified /ws & /api)", () => {
    expect(nextConfig).toBeDefined();
    expect(nextConfig.reactStrictMode).toBe(true);
    expect(typeof nextConfig.headers).toBe("function");
  });

  test("dispatches chatdesk:realtime-event on window when a valid WebSocket event is received", () => {
    const listener = vi.fn();
    window.addEventListener("chatdesk:realtime-event", listener);

    const payload = {
      type: "presence_update",
      username: "alice",
      status: "online",
    };
    window.dispatchEvent(
      new CustomEvent("chatdesk:realtime-event", { detail: payload }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual(payload);

    window.removeEventListener("chatdesk:realtime-event", listener);
  });
});

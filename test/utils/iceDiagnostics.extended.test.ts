import { describe, it, expect } from "vitest";
import {
  classifyMediaError,
  hasTurnConfigured,
  classifyIceFailureVerdict,
  collectIceFailureSummary,
} from "../../src/utils/iceDiagnostics.ts";

describe("iceDiagnostics helpers", () => {
  it("classifies browser media capture errors accurately", () => {
    expect(classifyMediaError({ name: "NotAllowedError" })).toBe("permission_denied");
    expect(classifyMediaError({ name: "NotFoundError" })).toBe("no_device");
    expect(classifyMediaError({ name: "NotReadableError" })).toBe("device_busy");
    expect(classifyMediaError({ name: "UnknownError", message: "boom" })).toBe("media_failed");
  });

  it("detects TURN/TURNS URLs across string and array server configs", () => {
    expect(hasTurnConfigured([])).toBe(false);
    expect(hasTurnConfigured([{ urls: "stun:stun.l.google.com:19302" }])).toBe(false);
    expect(hasTurnConfigured([{ urls: "turn:turn.example.com:3478" }])).toBe(true);
    expect(hasTurnConfigured([{ urls: ["stun:a", "TURNS:turn.example.com:5349"] }])).toBe(true);
  });

  it("classifies ICE failure verdicts cleanly with candidate deduplication", () => {
    expect(classifyIceFailureVerdict([], false)).toBe("no_candidates");
    expect(classifyIceFailureVerdict(["host", "host"], false)).toBe("host_only");
    expect(classifyIceFailureVerdict(["host", "srflx"], false)).toBe("stun_only");
    expect(classifyIceFailureVerdict(["host", "srflx"], true)).toBe("relay_failed");
    expect(classifyIceFailureVerdict(["host", "relay"], false)).toBe("relay_failed");
  });

  it("collectIceFailureSummary deduplicates local candidates from pc.getStats()", async () => {
    const fakePc = {
      getStats: async () =>
        new Map([
          ["1", { type: "local-candidate", candidateType: "host" }],
          ["2", { type: "local-candidate", candidateType: "host" }],
          ["3", { type: "local-candidate", candidateType: "srflx" }],
          ["4", { type: "remote-candidate", candidateType: "relay" }],
        ]),
    };
    const summary = await collectIceFailureSummary(fakePc, [
      { urls: "stun:stun.example.com:19302" },
    ]);
    expect(summary).toEqual({
      verdict: "stun_only",
      candidateTypes: ["host", "srflx"],
      turnConfigured: false,
    });
  });
});

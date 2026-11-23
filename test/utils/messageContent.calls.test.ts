import { describe, test, expect } from "vitest";
import {
  parseCallLogBody,
  getCallLogLabel,
  isMissedCallStatus,
} from "../../src/utils/messageContent.ts";

describe("call-log body parsing and labels", () => {
  test("parses all call outcomes including declined and missed", () => {
    expect(parseCallLogBody("[[call:voice:declined]]")).toEqual({
      type: "voice",
      status: "declined",
      duration: null,
      durationSeconds: null,
    });
    expect(parseCallLogBody("[[call:video:missed]]")).toEqual({
      type: "video",
      status: "missed",
      duration: null,
      durationSeconds: null,
    });
    expect(parseCallLogBody("[[call:voice:connected:125]]")).toEqual({
      type: "voice",
      status: "connected",
      duration: 125,
      durationSeconds: 125,
    });
  });

  test("marks never-connected outcomes as missed/rose styling", () => {
    expect(isMissedCallStatus("cancelled")).toBe(true);
    expect(isMissedCallStatus("declined")).toBe(true);
    expect(isMissedCallStatus("missed")).toBe(true);
    expect(isMissedCallStatus("failed")).toBe(true);
    expect(isMissedCallStatus("connected")).toBe(false);
    expect(isMissedCallStatus("outgoing")).toBe(false);
  });

  test("supports optional i18n translator in getCallLogLabel with English fallback", () => {
    expect(getCallLogLabel({ status: "missed" }, false)).toBe("Missed call");
    expect(getCallLogLabel({ status: "declined" }, true)).toBe("Declined call");
    const t = (key: string) =>
      key === "chat.call.log.missed" ? "تماس بی‌پاسخ" : key;
    expect(getCallLogLabel({ status: "missed" }, false, t)).toBe("تماس بی‌پاسخ");
  });
});

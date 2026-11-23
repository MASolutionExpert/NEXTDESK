export const FILE_SUMMARY_PATTERN =
  /^Sent (a media file|a file|a photo|a video|a document|a voice message|\d+ (files|photos|videos|documents|media files|voice messages))$/i;

const CALL_LOG_BODY_PATTERN =
  /^\[\[call:(voice|video):(outgoing|cancelled|declined|missed|failed|connected)(?::(\d+))?\]\]$/i;

export const MISSED_CALL_STATUSES = new Set([
  "failed",
  "cancelled",
  "declined",
  "missed",
]);

export const isMissedCallStatus = (status: any) =>
  MISSED_CALL_STATUSES.has(String(status || "").toLowerCase());

export const extractMessageBodyText = (value: any) => {
  if (typeof value === "string") {
    return value === "[object Object]" ? "" : value;
  }
  if (value && typeof value === "object") {
    return String(value.text || value.body || "");
  }
  return String(value ?? "");
};

export const parseCallLogBody = (body: any) => {
  const raw = extractMessageBodyText(body).trim();
  const match = raw.match(CALL_LOG_BODY_PATTERN);
  if (!match) return null;
  const duration = match[3] == null ? null : Math.max(0, parseInt(match[3], 10));
  return {
    type: match[1].toLowerCase(),
    status: match[2].toLowerCase(),
    duration,
    durationSeconds: duration,
  };
};

export const isCallLogBody = (body: any) => parseCallLogBody(body) !== null;

export const getCallLogLabel = (
  callLog: any,
  isOwnMessage: boolean,
  t?: (key: string, vars?: Record<string, any>) => string,
) => {
  if (!callLog) return "";
  const translate = (key: string, fallback: string) => {
    if (typeof t === "function") {
      const value = t(key);
      if (value && value !== key) return value;
    }
    return fallback;
  };
  if (callLog.status === "cancelled") {
    return translate("chat.call.log.cancelled", "Cancelled call");
  }
  if (callLog.status === "declined") {
    return translate("chat.call.log.declined", "Declined call");
  }
  if (callLog.status === "missed") {
    return translate("chat.call.log.missed", "Missed call");
  }
  if (callLog.status === "failed") {
    return translate("chat.call.log.failed", "Failed call");
  }
  if (callLog.status === "outgoing") {
    return translate("chat.call.log.outgoing", "Outgoing call");
  }
  return isOwnMessage
    ? translate("chat.call.log.outgoing", "Outgoing call")
    : translate("chat.call.log.incoming", "Incoming call");
};

export const getMessageFiles = (message: any) =>
  Array.isArray(message?.files) ? message.files : [];

export const hasMessageText = (message: any) => {
  const bodyText = extractMessageBodyText(message?.body).trim();
  if (!bodyText) return false;
  if (bodyText.startsWith("sb-enc-v1:")) return false;
  if (isCallLogBody(bodyText)) return false;
  const files = getMessageFiles(message);
  if (!files.length) return true;
  return !FILE_SUMMARY_PATTERN.test(bodyText);
};

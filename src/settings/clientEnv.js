// Static environment variable map for Next.js client bundle inlining.
// Next.js inlines static process.env.<KEY> references defined in next.config.mjs,
// preserving 100% compatibility with existing .env files (no VITE_ prefix needed).
export const CLIENT_ENV = {
  APP_DEBUG: process.env.APP_DEBUG,
  SIGN_UP: process.env.SIGN_UP,
  ACCOUNT_CREATION: process.env.ACCOUNT_CREATION,
  MESSAGE_MAX_CHARS: process.env.MESSAGE_MAX_CHARS,
  MESSAGE_MAX: process.env.MESSAGE_MAX,
  NICKNAME_MAX_CHARS: process.env.NICKNAME_MAX_CHARS,
  NICKNAME_MAX: process.env.NICKNAME_MAX,
  USERNAME_MAX_CHARS: process.env.USERNAME_MAX_CHARS,
  USERNAME_MAX: process.env.USERNAME_MAX,
  CHAT_PENDING_TEXT_TIMEOUT: process.env.CHAT_PENDING_TEXT_TIMEOUT,
  CHAT_PENDING_FILE_TIMEOUT: process.env.CHAT_PENDING_FILE_TIMEOUT,
  CHAT_PENDING_RETRY_INTERVAL: process.env.CHAT_PENDING_RETRY_INTERVAL,
  CHAT_PENDING_STATUS_CHECK_INTERVAL: process.env.CHAT_PENDING_STATUS_CHECK_INTERVAL,
  CHAT_MESSAGE_FETCH_LIMIT: process.env.CHAT_MESSAGE_FETCH_LIMIT,
  CHAT_MESSAGE_PAGE_SIZE: process.env.CHAT_MESSAGE_PAGE_SIZE,
  FILE_UPLOAD_MAX_FILES: process.env.FILE_UPLOAD_MAX_FILES,
  FILE_UPLOAD_MAX_SIZE_MB: process.env.FILE_UPLOAD_MAX_SIZE_MB,
  FILE_UPLOAD_MAX_SIZE: process.env.FILE_UPLOAD_MAX_SIZE,
  FILE_UPLOAD_MAX_TOTAL_SIZE_MB: process.env.FILE_UPLOAD_MAX_TOTAL_SIZE_MB,
  FILE_UPLOAD_MAX_TOTAL_SIZE: process.env.FILE_UPLOAD_MAX_TOTAL_SIZE,
  CHAT_LIST_REFRESH_INTERVAL: process.env.CHAT_LIST_REFRESH_INTERVAL,
  CHAT_SEARCH_MAX_RESULTS: process.env.CHAT_SEARCH_MAX_RESULTS,
  CHAT_HEALTH_CHECK_INTERVAL: process.env.CHAT_HEALTH_CHECK_INTERVAL,
  CHAT_SSE_RECONNECT_DELAY: process.env.CHAT_SSE_RECONNECT_DELAY,
  CHAT_VOICE_WAVEFORM_MAX_DECODE_MB: process.env.CHAT_VOICE_WAVEFORM_MAX_DECODE_MB,
  CHAT_VOICE_WAVEFORM_MAX_DECODE_BYTES: process.env.CHAT_VOICE_WAVEFORM_MAX_DECODE_BYTES,
  CHAT_VOICE_WAVEFORM_MAX_DECODE_SECONDS: process.env.CHAT_VOICE_WAVEFORM_MAX_DECODE_SECONDS,
  CHAT_CACHE_TTL: process.env.CHAT_CACHE_TTL,
  FILE_UPLOAD: process.env.FILE_UPLOAD,
  CALL: process.env.CALL,
  CALL_VIDEO: process.env.CALL_VIDEO,
};

export function readClientEnv(name) {
  if (Object.prototype.hasOwnProperty.call(CLIENT_ENV, name)) {
    const v = CLIENT_ENV[name];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  if (typeof process !== "undefined" && process.env && process.env[name] !== undefined) {
    return process.env[name];
  }
  return undefined;
}

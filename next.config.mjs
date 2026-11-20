import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Load root .env at build/config time so existing ChatDesk/NextDesk .env files
// work seamlessly without requiring a NEXT_PUBLIC_ rename.
function readRootEnvFile() {
  const envPath = path.join(rootDir, ".env");
  const parsed = {};
  if (!fs.existsSync(envPath)) return parsed;
  try {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      parsed[key] = val;
    }
  } catch {
    // Ignore unreadable .env during CI builds
  }
  return parsed;
}

const fileEnv = readRootEnvFile();
const CLIENT_ENV_KEYS = [
  "APP_DEBUG",
  "SIGN_UP",
  "ACCOUNT_CREATION",
  "MESSAGE_MAX_CHARS",
  "MESSAGE_MAX",
  "NICKNAME_MAX_CHARS",
  "NICKNAME_MAX",
  "USERNAME_MAX_CHARS",
  "USERNAME_MAX",
  "CHAT_PENDING_TEXT_TIMEOUT",
  "CHAT_PENDING_FILE_TIMEOUT",
  "CHAT_PENDING_RETRY_INTERVAL",
  "CHAT_PENDING_STATUS_CHECK_INTERVAL",
  "CHAT_MESSAGE_FETCH_LIMIT",
  "CHAT_MESSAGE_PAGE_SIZE",
  "FILE_UPLOAD_MAX_FILES",
  "FILE_UPLOAD_MAX_SIZE_MB",
  "FILE_UPLOAD_MAX_SIZE",
  "FILE_UPLOAD_MAX_TOTAL_SIZE_MB",
  "FILE_UPLOAD_MAX_TOTAL_SIZE",
  "CHAT_LIST_REFRESH_INTERVAL",
  "CHAT_SEARCH_MAX_RESULTS",
  "CHAT_HEALTH_CHECK_INTERVAL",
  "CHAT_SSE_RECONNECT_DELAY",
  "CHAT_VOICE_WAVEFORM_MAX_DECODE_MB",
  "CHAT_VOICE_WAVEFORM_MAX_DECODE_BYTES",
  "CHAT_VOICE_WAVEFORM_MAX_DECODE_SECONDS",
  "CHAT_CACHE_TTL",
  "FILE_UPLOAD",
  "CALL",
  "CALL_VIDEO",
];

const exposedEnv = {};
for (const key of CLIENT_ENV_KEYS) {
  const val = process.env[key] ?? fileEnv[key];
  if (val !== undefined) {
    exposedEnv[key] = String(val);
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  env: exposedEnv,
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

function readRootEnvFile(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env");
  const parsed: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return parsed;
  try {
    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
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

const CLIENT_ENV_KEYS: readonly string[] = [
  "APP_DEBUG", "SIGN_UP", "ACCOUNT_CREATION", "MESSAGE_MAX_CHARS", "MESSAGE_MAX",
  "NICKNAME_MAX_CHARS", "NICKNAME_MAX", "USERNAME_MAX_CHARS", "USERNAME_MAX",
  "CHAT_PENDING_TEXT_TIMEOUT", "CHAT_PENDING_FILE_TIMEOUT", "CHAT_PENDING_RETRY_INTERVAL",
  "CHAT_PENDING_STATUS_CHECK_INTERVAL", "CHAT_MESSAGE_FETCH_LIMIT", "CHAT_MESSAGE_PAGE_SIZE",
  "FILE_UPLOAD_MAX_FILES", "FILE_UPLOAD_MAX_SIZE_MB", "FILE_UPLOAD_MAX_SIZE",
  "FILE_UPLOAD_MAX_TOTAL_SIZE_MB", "FILE_UPLOAD_MAX_TOTAL_SIZE", "CHAT_LIST_REFRESH_INTERVAL",
  "CHAT_SEARCH_MAX_RESULTS", "CHAT_HEALTH_CHECK_INTERVAL", "CHAT_SSE_RECONNECT_DELAY",
  "CHAT_VOICE_WAVEFORM_MAX_DECODE_MB", "CHAT_VOICE_WAVEFORM_MAX_DECODE_BYTES",
  "CHAT_VOICE_WAVEFORM_MAX_DECODE_SECONDS", "CHAT_CACHE_TTL", "FILE_UPLOAD", "CALL", "CALL_VIDEO",
];

const exposedEnv: Record<string, string> = {};
for (const key of CLIENT_ENV_KEYS) {
  const val = process.env[key] ?? fileEnv[key];
  if (val !== undefined) exposedEnv[key] = String(val);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: false },
  env: exposedEnv,
  async headers() {
    return [
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      { source: "/manifest.webmanifest", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};

export default nextConfig;

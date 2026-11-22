import express from "express";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import compression from "compression";
import rateLimit from "express-rate-limit";
import multer from "multer";
import * as webpush from "web-push";
import { registerApiRoutes } from "./api/index.ts";
import { ensureValidVapidKeys } from "./lib/vapid.ts";
import { createSseHub } from "./lib/sse.ts";
import { createWebSocketGateway } from "./lib/websocketGateway.ts";
import { createPresenceTracker } from "./lib/presenceTracker.ts";
import { createCallManager } from "./lib/callManager.ts";
import { createPushService } from "./lib/push.ts";
import { createUploadTools } from "./lib/uploads.ts";
import { resolveAppOrigins, ensureBucketCors } from "./lib/bucketCors.ts";
import { resolveWebhookCallbackUrl } from "./lib/webhookUrl.ts";
import { createVideoTranscodeManager } from "./lib/videoTranscode.ts";
import { createMessageFileJobs } from "./lib/messageFileJobs.ts";
import { createInspector } from "./lib/inspect.ts";
import { createSessionHelpers } from "./lib/sessions.ts";
import { createRedisClient, createRedisSessionStore } from "./lib/redis.ts";
import { storageEncryption } from "./lib/storageEncryption.ts";
import { createStorageProvider } from "./lib/storage/index.ts";
import { migrateLegacyStorageLayout } from "./lib/storageLayoutMigration.ts";
import { createMediaQueueManager } from "./lib/mediaQueue.ts";
import { createRemoteChannelManager } from "./lib/remoteChannels.ts";
import { initAutoAddWorker } from "./lib/workers/autoAddWorker.ts";
import { ensureLocalWorkerRunning } from "./lib/localWorkerManager.ts";
import { buildTimestampSchedule } from "./lib/timeUtils.ts";
import { isLoopbackRequest, parseUploadFileMetadata } from "./lib/requestUtils.ts";
import { USERNAME_REGEX } from "./lib/validation.ts";
import { USER_COLORS, setUserColor } from "./settings/colors.ts";
import { readDbConfig, parseEnv } from "./settings/env.ts";
import { createPostgresMaintenance } from "./lib/postgresMaintenance.ts";
import {
  addAllEligibleChatMembers,
  addChatMember,
  getAutoAddPublicChatIds,
  bulkAddMemberToChats,
  adminGetAll,
  adminGetRow,
  adminRun,
  adminSave,
  adminTransaction,
  ensureSavedChatForUser,
  clearChatMemberLeft,
  clearGroupMemberRemoved,
  createChat,
  createMessageFiles,
  createMessage,
  createOrReuseMessage,
  updateCallMessageBody,
  editMessage,
  createSession,
  deleteSession,
  createUser,
  deleteChatById,
  deleteUserById,
  findChatById,
  findDmChat,
  findChatByGroupUsername,
  findChatByInviteToken,
  findMessageIdByClientRequestId,
  findMessageById,
  hideMessageForEveryone,
  hideMessageForUser,
  findUserById,
  findUserByUsername,
  getMessageReadCounts,
  getMessageAuthors,
  getMessageReadByUser,
  getMessages,
  getFirstUnreadMessage,
  recordMessageReads,
  recordPendingPresignedUpload,
  removePendingPresignedUploads,
  listPendingPresignedUploads,
  rewriteStorageKeys,
  listMessageFilesByMessageIds,
  markGroupMemberRemoved,
  markChatMemberLeft,
  regenerateGroupInviteToken,
  removeChatMember,
  setMessageExpiresAt,
  setMessageForwardOrigin,
  getSession,
  isMember,
  isGroupMemberRemoved,
  listChatMembers,
  listChatMembersForChats,
  listChatsForUser,
  listCallHistoryForUser,
  listUsers,
  searchUsers,
  searchPublicGroups,
  searchPublicChannels,
  setChatMuted,
  touchSession,
  updateLastSeen,
  getUserPresence,
  hideChatsForUser,
  markMessagesRead,
  markMessageRead,
  updateUserPassword,
  updateUserProfile,
  updateUserStatus,
  updateGroupChat,
  updateChannelChat,
  unhideChat,
  getChatMemberRole,
  setChatMemberRole,
  upsertPushSubscription,
  deletePushSubscription,
  listPushSubscriptionsByUserIds,
  getTotalUnreadCount,
  listMutedUserIdsForChat,
  claimNextRemoteChannelQueueItem,
  enqueueRemoteChannelQueueItem,
  getRemoteChannelProviderState,
  getRemoteChannelQueueSummary,
  getRemoteChannelSourceByChatId,
  getRemoteChannelSourceById,
  listEnabledRemoteChannelSources,
  markRemoteChannelQueueItemDone,
  markRemoteChannelQueueItemRetry,
  markRemoteChannelQueueItemSkipped,
  releaseStaleRemoteChannelQueueItems,
  setRemoteChannelProviderState,
  skipAllRemoteChannelQueueItems,
  skipCurrentRemoteChannelQueueItem,
  getCurrentRemoteChannelQueueItemId,
  updateRemoteChannelSourceError,
  updateRemoteChannelSourcePaused,
  updateRemoteChannelSourceSeen,
  upsertRemoteChannelSource,
  purgeOldRemoteChannelQueueItems,
  setUserRole,
  normalizeUiLanguage,
  getUserLanguage,
  updateUserLanguage,
  DEFAULT_UI_LANGUAGE,
  // Departments & support routing (helpdesk layer)
  listDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  setUserDepartment,
  getUserDepartmentId,
  listOperatorsForDepartment,
  pickOperatorForDepartment,
  markChatDepartment,
  getChatDepartmentId,
  getSupportOverview,
  isUserAdmin,
  isUserOwner,
  getOwnerUser,
  writeAdminAuditLog,
  readAdminAuditLogs,
  clearAdminAuditLogs,
  getAdminStats,
  adminListUsers,
  adminListChats,
  adminCountUsers,
  adminCountChats,
  adminBanUser,
  adminDeleteUser,
  adminDeleteChat,
  vacuumDatabase,
  reloadDatabase,
  restoreDatabase,
  adminClearAllMessages,
  adminResetDatabase,
  dbGetAllSettings,
  dbSetSetting,
  dbDeleteSetting,
  dbGetSetting,
} from "./db.ts";
import { resolveTelegramSecrets } from "./lib/remoteChannelSecrets.ts";
import { createMirrorJobRegistry } from "./lib/remoteMirrorJobs.ts";
import { dispatchMirrorJob } from "./lib/remoteMirrorDispatch.ts";
import {
  loadSettings,
  getSetting,
  getAllSettings,
  setSetting,
  setSettings,
  resetSetting,
  validateSetting,
  SETTING_DEFS,
} from "./lib/appSettings.ts";

process.title = "chatdesk-server";

const app: any = express();
const serverDir: any = path.dirname(fileURLToPath(import.meta.url));
const projectRootDir: any = path.resolve(serverDir, "../..");
dotenv.config({ path: path.join(projectRootDir, ".env"), override: true, quiet: true });
dotenv.config({ path: path.join(serverDir, ".env"), override: true, quiet: true });

// Load runtime settings from DB (env vars remain as fallback defaults).
// Must run after dotenv and after the DB module (which runs migrations).
await loadSettings(dbGetAllSettings);

// One-time import of the legacy file audit log (logs/admin.log) into the
// DB-backed admin_audit_logs table. Best effort: only runs when the table is
// empty and a legacy file exists, and never crashes boot.
try {
  const existing: any = await readAdminAuditLogs({ limit: 1, offset: 0 });
  if (Number(existing?.total || 0) === 0) {
    const legacyPath: any = path.join(projectRootDir, "logs", "admin.log");
    if (fs.existsSync(legacyPath)) {
      const raw: any = fs.readFileSync(legacyPath, "utf8");
      const lines: any = raw.split("\n").filter((l) => l.trim());
      // File is oldest-first; insert in order so autoincrement ids stay chronological.
      for (const line of lines) {
        let parsed;
        try { parsed = JSON.parse(line); } catch { continue; }
        if (!parsed?.action) continue;
        try {
          await writeAdminAuditLog({
            ts: parsed.ts ?? null,
            actorUserId: parsed.actorUserId ?? null,
            actorUsername: parsed.actorUsername ?? null,
            action: String(parsed.action || ""),
            targetType: parsed.targetType ?? null,
            targetLabel: parsed.targetLabel ?? null,
            details: parsed.details ?? null,
            status: parsed.status ?? "success",
          });
        } catch { break; }
      }
      if (lines.length > 0) console.log(`[server] Imported ${lines.length} legacy admin audit log entr(ies) from logs/admin.log.`);
    }
  }
} catch {
  // Best effort only — file fallback in admin routes keeps working.
}

const port = process.env.PORT || process.env.SERVER_PORT || 5174;
const appEnv = process.env.APP_ENV || "production";
const isProduction = appEnv === "production";
// For Docker/container deployments, set BIND_ADDRESS=0.0.0.0
// For VPS with firewall, can use localhost (nginx proxies from same machine)
const bindAddress = process.env.BIND_ADDRESS || "localhost";

function debugLog(...args) {
  if (!getSetting("APP_DEBUG")) return;
  console.log("[app-debug]", ...args);
}

const debugRouteCounts: any = new Map<any, any>();

// Always scheduled; the interval body checks the live setting on each tick
// so toggling APP_DEBUG in the admin panel takes effect without a restart.
const debugSummaryTimer: any = setInterval(() => {
  if (!getSetting("APP_DEBUG")) return;
  const entries: any = Array.from(debugRouteCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([route, count]) => ({ route, count }));

  debugLog("api:requests-per-minute", { routes: entries });

  debugRouteCounts.clear();
}, 60 * 1000);
if (typeof debugSummaryTimer.unref === "function") debugSummaryTimer.unref();

app.set("trust proxy", 1);

app.use("/api", express.json({ limit: "1mb" }));
app.use(
  compression({
    threshold: 1024,
    filter(req, res) {
      if (req.path === "/api/events" || req.path.startsWith("/_next/")) return false;
      const contentType: any = String(res.getHeader("Content-Type") || "").toLowerCase();
      if (contentType.includes("text/event-stream")) return false;
      return compression.filter(req, res);
    },
  }),
);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
});

// Always registered; each request checks the live setting so toggling
// APP_DEBUG in the admin panel takes effect without a restart.
app.use((req, res, next) => {
  if (!getSetting("APP_DEBUG")) return next();

  const startedAt: any = Date.now();
  let responseBody: any = null;
  const originalJson: any = res.json.bind(res);

  res.json = (body) => {
    responseBody = body;
    return originalJson(body);
  };

  res.on("finish", () => {
    const routeKey = `${String(req.method || "GET").toUpperCase()} ${
      String(req.path || req.originalUrl || req.url || "").split("?")[0]
    }`;

    debugRouteCounts.set(
      routeKey,
      Number(debugRouteCounts.get(routeKey) || 0) + 1,
    );

    debugLog("api:request", {
      method: req.method,
      path: req.originalUrl || req.url || "",
      query: req.query || {},
      params: req.params || {},
      body: req.body || {},
      status: Number(res.statusCode || 0),
      durationMs: Date.now() - startedAt,
      response: responseBody,
    });
  });
  next();
});

// Prefer originalUrl: when limiters are mounted at "/api", Express rewrites
// req.path/req.url to the remainder (e.g. "/events"), which broke a prior
// skip on "/api/events" and let SSE / admin polling share the chat budget.
function apiRequestPath(req) {
  return String(req.originalUrl || req.url || req.path || "").split("?")[0];
}

const apiLimiter: any = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  // SSE is long-lived (one hit opens a stream). Admin routes have their own
  // bucket so dashboard polling cannot 429 chat health / messages.
  skip: (req) => {
    const p: any = apiRequestPath(req);
    return p === "/api/events" || p.startsWith("/api/admin");
  },
});

// Separate ceiling for /api/admin/* — few admins, but metrics + list refresh
// are chatty. Keeps that load off the shared chat/health limiter.
const adminApiLimiter: any = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
});

const staticLimiter: any = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
});

const MB = 1024 * 1024;

const USERNAME_MAX: any = getSetting("USERNAME_MAX_CHARS");
const NICKNAME_MAX: any = getSetting("NICKNAME_MAX_CHARS");
const MESSAGE_MAX_CHARS: any = getSetting("MESSAGE_MAX_CHARS");
const ACCOUNT_CREATION: any = getSetting("SIGN_UP");
const dataDir: any = path.resolve(process.env.DATA_DIR || path.resolve(projectRootDir, "data"));
const vapid: any = ensureValidVapidKeys({ projectRootDir, dataDir, fs, path, webpush });
const uploadRootDir: any = path.join(dataDir, "uploads", "messages");
const avatarUploadRootDir: any = path.join(dataDir, "uploads", "avatars");

const FILE_UPLOAD_MAX_SIZE = getSetting("FILE_UPLOAD_MAX_SIZE_MB") * MB;
const FILE_UPLOAD_MAX_FILES: any = getSetting("FILE_UPLOAD_MAX_FILES");
const FILE_UPLOAD_MAX_TOTAL_SIZE = getSetting("FILE_UPLOAD_MAX_TOTAL_SIZE_MB") * MB;

const MESSAGE_FILE_RETENTION_DAYS: any = getSetting("MESSAGE_FILE_RETENTION");
const MESSAGE_TEXT_RETENTION_DAYS: any = getSetting("MESSAGE_TEXT_RETENTION");

const TRANSCODE_VIDEOS_TO_H264: any = getSetting("FILE_UPLOAD_TRANSCODE_VIDEOS");


const FILE_UPLOAD: any = getSetting("FILE_UPLOAD");
const REMOTE_CHANNEL: any = getSetting("REMOTE_CHANNEL");
const REMOTE_CHANNEL_UI: any = getSetting("REMOTE_CHANNEL_UI");
const REMOTE_CHANNEL_MEDIA_STREAM: any = getSetting("REMOTE_CHANNEL_MEDIA_STREAM");
// Telegram credentials live outside the settings registry (Services setup or
// .env). Env vars win when set, otherwise the DB rows written by the setup flow.
const REMOTE_CHANNEL_SECRETS: any = await resolveTelegramSecrets({ dbGetSetting });
const REMOTE_CHANNEL_TELEGRAM_API_ID = REMOTE_CHANNEL_SECRETS.apiId;
const REMOTE_CHANNEL_TELEGRAM_API_HASH = REMOTE_CHANNEL_SECRETS.apiHash;
const REMOTE_CHANNEL_TELEGRAM_SESSION_STRING = REMOTE_CHANNEL_SECRETS.sessionString;
const REMOTE_CHANNEL_PROXY_URL: any = String(
  getSetting("REMOTE_CHANNEL_TELEGRAM_PROXY_URL") || "",
).trim();
const REMOTE_CHANNEL_CHATDESK_PROXY_URL: any = String(
  getSetting("REMOTE_CHANNEL_CHATDESK_PROXY_URL") || "",
).trim();
const REMOTE_CHANNEL_TELEGRAM_CONFIGURED: any = Boolean(
  REMOTE_CHANNEL_TELEGRAM_API_ID &&
    REMOTE_CHANNEL_TELEGRAM_API_HASH &&
    REMOTE_CHANNEL_TELEGRAM_SESSION_STRING,
);
const REMOTE_CHANNEL_CONFIG: any = {
  enabled: REMOTE_CHANNEL,
  uiEnabled: REMOTE_CHANNEL_UI,
  mediaStreamEnabled: REMOTE_CHANNEL_MEDIA_STREAM,
  telegramConfigured: REMOTE_CHANNEL_TELEGRAM_CONFIGURED,
  proxyConfigured: Boolean(REMOTE_CHANNEL_PROXY_URL),
  chatdeskProxyUrl: REMOTE_CHANNEL_CHATDESK_PROXY_URL,
  telegramApiId: REMOTE_CHANNEL_TELEGRAM_API_ID,
  telegramApiHash: REMOTE_CHANNEL_TELEGRAM_API_HASH,
  telegramSessionString: REMOTE_CHANNEL_TELEGRAM_SESSION_STRING,
  proxyUrl: REMOTE_CHANNEL_PROXY_URL,
  tickMode: getSetting("REMOTE_CHANNEL_TICK_MODE"),
  pollIntervalMs: getSetting("REMOTE_CHANNEL_POLL_INTERVAL_MS"),
  telegramPollLimit: getSetting("REMOTE_CHANNEL_TELEGRAM_POLL_LIMIT"),
  queueIntervalMs: getSetting("REMOTE_CHANNEL_QUEUE_INTERVAL_MS"),
  queueMaxAttempts: getSetting("REMOTE_CHANNEL_QUEUE_MAX_ATTEMPTS"),
  queueBatchSize: getSetting("REMOTE_CHANNEL_QUEUE_BATCH_SIZE"),
  queueConcurrency: getSetting("REMOTE_CHANNEL_QUEUE_CONCURRENCY"),
  queueStaleLockMs: getSetting("REMOTE_CHANNEL_QUEUE_STALE_LOCK_MS"),
  messageTextRetentionDays: MESSAGE_TEXT_RETENTION_DAYS,
  messageFileRetentionDays: MESSAGE_FILE_RETENTION_DAYS,
  messageMaxChars: MESSAGE_MAX_CHARS,
  fileUploadEnabled: FILE_UPLOAD,
  messageFileLimits: {
    maxFiles: FILE_UPLOAD_MAX_FILES,
    maxFileSizeBytes: FILE_UPLOAD_MAX_SIZE,
    maxTotalBytes: FILE_UPLOAD_MAX_TOTAL_SIZE,
  },
  transcodeVideosToH264: TRANSCODE_VIDEOS_TO_H264,
  uploadRootDir,
  avatarUploadRootDir,
};
const MESSAGE_FILE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

const storageProvider: any = createStorageProvider({
  ...process.env,
  // Admin-panel DB values win when the env var is absent (getSetting resolves
  // env → DB → default). Restart required — S3 client is constructed once.
  STORAGE_EXPIRES_IN: getSetting("STORAGE_EXPIRES_IN"),
  STORAGE_PROXY_URL: getSetting("STORAGE_PROXY_URL") || process.env.STORAGE_PROXY_URL,
});

// Self-configure bucket CORS for browser presigned uploads (remote driver
// only). Runs in the background: never blocks or crashes boot. Opt-in via
// STORAGE_AUTO_CORS=true (enabled in .railway/railway.ts); otherwise
// configure the bucket manually (npm --prefix server run storage:cors).
if (
  (storageProvider?.type === "remote" || storageProvider?.type === "s3") &&
  (getSetting("STORAGE_AUTO_CORS") ||
    String(process.env.STORAGE_AUTO_CORS ?? "false").toLowerCase() === "true" ||
    String(process.env.STORAGE_AUTO_CORS ?? "false") === "1")
) {
  const corsOrigins: any = resolveAppOrigins(process.env);
  if (corsOrigins.length === 0) {
    console.log(
      "[server] Bucket CORS auto-configuration skipped (no public app origin known. Set APP_PUBLIC_URL to enable it).",
    );
  } else {
    ensureBucketCors(storageProvider, corsOrigins)
      .then((result) => {
        if (result.status === "applied") {
          console.log(
            `[server] Bucket CORS policy applied for ${corsOrigins.join(", ")}`,
          );
        } else if (result.status === "ok") {
          console.log(
            `[server] Bucket CORS already configured for ${corsOrigins.join(", ")}`,
          );
        } else if (result.status === "error") {
          console.warn(
            `[server] Could not configure bucket CORS automatically (${result.error}). ` +
              `Uploads from browsers will fail until CORS is set — run: npm --prefix server run storage:cors -- --origin <your-app-url>`,
          );
        }
      })
      .catch((err) => {
        console.warn(
          `[server] Bucket CORS auto-configuration failed: ${err?.message || err}`,
        );
      });
  }
}

// Migrate legacy object-storage layout (avatars/* + uploads/* at bucket
// root) to the unified layout (uploads/avatars/* + uploads/messages/*),
// mirroring local disk. Runs in the background like bucket CORS setup:
// never blocks or crashes boot. Read paths already handle both layouts,
// so in-flight requests keep working while the migration copies objects,
// rewrites DB storage_key columns, and deletes verified legacy objects.
// Manual run: npm run storage:migrate (refuses while the server is up).
if (
  storageProvider?.type === "remote" ||
  storageProvider?.type === "s3"
) {
  migrateLegacyStorageLayout({
    storageProvider,
    rewriteStorageKeys,
    adminSave,
  })
    .then((summary) => {
      if ((summary as any)?.skipped) return;
      if (!summary?.hasLegacy) {
        console.log(
          "[server] Object-storage layout already unified (uploads/avatars/* + uploads/messages/*).",
        );
        return;
      }
      console.log(
        `[server] Object-storage layout migrated: ${summary.moved.length} object(s) moved, ` +
          `${summary.dbUpdated} DB row(s) updated, ${summary.deletedLegacy.length} legacy object(s) deleted.` +
          (summary.failed.length || summary.deleteFailed.length
            ? ` (${summary.failed.length} copy / ${summary.deleteFailed.length} delete failures — see warnings above)`
            : ""),
      );
    })
    .catch((err) => {
      console.warn(
        `[server] Object-storage layout migration failed (legacy keys keep working via fallback): ${err?.message || err}`,
      );
    });
}

const uploadTools: any = createUploadTools({
  fs,
  path,
  crypto,
  multer,
  adminGetRow,
  adminRun,
  adminSave,
  uploadRootDir,
  avatarUploadRootDir,
  fileUploadMaxSize: FILE_UPLOAD_MAX_SIZE,
  fileUploadMaxFiles: FILE_UPLOAD_MAX_FILES,
  fileUploadMaxTotalSize: FILE_UPLOAD_MAX_TOTAL_SIZE,
  storageEncryption,
  storageProvider,
});

const {
  MESSAGE_FILE_LIMITS,
  AVATAR_FILE_LIMITS,
  ALLOWED_AVATAR_MIME_TYPES,
  uploadFiles,
  uploadAvatar,
  buildDownloadFilename,
  buildAsciiFallbackFilename,
  decodeOriginalFilename,
  inferMimeFromFilename,
  getUploadKind,
  removeUploadedFiles,
  removeStoredFileNames,
  removeAvatarByUrl,
  resolveAvatarDiskPath,
  normalizeAvatarPublicUrl,
  ensureAvatarExists,
  storeAvatarFile,
  isDangerousUploadFile,
  registerUploadRoutes,
} = uploadTools;

const sseHub: any = createSseHub({ listChatMembers });
const { addSseClient, removeSseClient, emitSseEvent, emitChatEvent, broadcastAll, getCachedMembers } = sseHub;

let wsPresenceBroadcaster: any = null;
let wsGlobalBroadcaster: any = null;
const presenceTracker: any = createPresenceTracker({
  updateLastSeen,
  getUserPresence,
  listChatsForUser,
  listChatMembers,
  listChatMembersForChats,
  emitToUser: (username, payload) => {
    emitSseEvent(username, payload);
    wsPresenceBroadcaster?.(username, payload);
  },
});

const callManager = createCallManager({
  isMember,
  findChatById,
  listChatMembers,
  findUserById,
  emitToUser: (username, payload) => {
    emitSseEvent(username, payload);
    wsPresenceBroadcaster?.(username, payload);
  },
  emitChatEvent,
  createCallMessage: (chatId, userId, body) =>
    createMessage(chatId, userId, body, null, null, null, {
      allowPlaintextSystemMessage: true,
    }),
  updateCallMessageBody,
  sendPushNotificationToUsers: (...args) =>
    pushService.sendPushNotificationToUsers(...args),
  maxCallDurationMs: (getSetting("CALL_MAX_DURATION") || 0) * 60000,
});

const pushService: any = createPushService({
  webpush,
  listPushSubscriptionsByUserIds,
  deletePushSubscription,
  getTotalUnreadCount,
  vapid,
  proxyUrl: getSetting("PUSH_PROXY_URL"),
});
const { PUSH_ENABLED, VAPID_PUBLIC_KEY, sendPushNotificationToUsers } = pushService;

const videoTranscoder: any = createVideoTranscodeManager({
  spawn,
  fs,
  path,
  crypto,
  adminRun,
  adminGetRow,
  adminSave,
  listMessageFilesByMessageIds,
  emitChatEvent,
  debugLog,
  uploadRootDir,
  transcodeVideosToH264: TRANSCODE_VIDEOS_TO_H264,
  getSetting,
  storageEncryption,
  storageProvider,
  storageProcessingMode: process.env.STORAGE_PROCESSING_MODE || "auto",
  mediaWorkerUrl: getSetting("WORKER_URL") || process.env.WORKER_URL || process.env.MEDIA_WORKER_URL || null,
  workerUrl: getSetting("WORKER_URL") || process.env.WORKER_URL || process.env.MEDIA_WORKER_URL || null,
  workerPort: process.env.WORKER_PORT || "8080",
  webhookSecret: process.env.WEBHOOK_SECRET || null,
  callbackUrl: resolveWebhookCallbackUrl(),
});
const {
  enqueueVideoTranscodeJob,
  ensureFfmpegAvailable,
  probeVideoMetadata,
  isVideoFileProcessing,
  hydrateMissingVideoMetadata,
  summarizeMessageFiles,
  sanitizePositiveInt,
  sanitizeDurationSeconds,
} = videoTranscoder;

const messageFileJobs: any = createMessageFileJobs({
  adminGetAll,
  adminGetRow,
  adminRun,
  adminSave,
  adminTransaction,
  listMessageFilesByMessageIds,
  removeStoredFileNames,
  uploadRootDir,
  fs,
  path,
  getSetting,
  storageProvider,
});
const {
  chunkArray,
  cleanupMissingMessageFiles,
  cleanupExpiredMessageFiles,
  backfillMessageFileExpiry,
  removeAllMessageUploads,
  computeExpiryIso,
  pruneOrphanRemoteObjects,
  pruneOrphanAvatarObjects,
} = messageFileJobs;

const inspector: any = createInspector({ fs, dataDir, adminGetRow, adminGetAll });
const { buildInspectSnapshot, hasEnoughFreeDiskSpace } = inspector;

const redisClient: any = createRedisClient();
const redisSessionStore: any = createRedisSessionStore({ redisClient, dbGetSession: getSession });

const mediaQueueManager: any = createMediaQueueManager({
  redisClient,
  storageProvider,
  s3ProcessingMode: process.env.STORAGE_PROCESSING_MODE || "auto",
  s3ProcessingTimeoutMs: Number(getSetting("STORAGE_PROCESSING_TIMEOUT_MS")) || 120000,
  adminGetRow,
  adminRun,
  emitChatEvent,
  enqueueVideoTranscodeJob,
  transcodeVideosToH264: TRANSCODE_VIDEOS_TO_H264,
  getSetting,
});

async function createSessionCombined(userId, token) {
  await createSession(userId, token);
  await redisSessionStore.createSession(userId, token);
}

function getSessionCombined(token) {
  const cached: any = redisSessionStore.getSession(token);
  if (cached && typeof cached.then !== "function") return cached;
  return getSession(token);
}

async function touchSessionCombined(token) {
  await touchSession(token);
  await redisSessionStore.touchSession(token);
}

async function deleteSessionCombined(token) {
  await deleteSession(token);
  await redisSessionStore.deleteSession(token);
}

const sessionHelpers: any = createSessionHelpers({
  getSession: getSessionCombined,
  touchSession: touchSessionCombined,
  isProduction,
});
const {
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  getSessionFromRequest,
  requireSession,
  requireSessionUsernameMatch,
} = sessionHelpers;

async function backfillStorageEncryption() {
  if (!storageEncryption.isEnabled()) return;

  // Process messages in batches with async yields to avoid blocking the event
  // loop for extended periods on large databases.
  const BATCH_SIZE = 200;

  async function encryptMessageBatch(offset) {
    const batch =
      (await adminGetAll(
        "SELECT id, body FROM chat_messages WHERE body IS NOT NULL AND body != '' ORDER BY id ASC LIMIT $1 OFFSET $2",
        [BATCH_SIZE, offset],
      )) || [];

    if (!batch.length) return 0;

    let encryptedInBatch = 0;
    for (const row of batch) {
      const body = String(row?.body || "");
      if (!body || storageEncryption.isSystemMessageBody(body)) continue;

      const isValidCiphertext =
        storageEncryption.isEncryptedText(body) &&
        storageEncryption.decryptText(body) !== body;
      if (isValidCiphertext) continue;

      const nextBody = storageEncryption.encryptText(body);
      if (nextBody === body) continue;
      await adminRun("UPDATE chat_messages SET body = $1 WHERE id = $2", [
        nextBody,
        row.id,
      ]);
      encryptedInBatch += 1;
    }

    if (encryptedInBatch > 0) adminSave();

    if (batch.length === BATCH_SIZE) {
      // Schedule next batch without blocking the event loop.
      setImmediate(() => { void encryptMessageBatch(offset + BATCH_SIZE); });
    }
    return encryptedInBatch;
  }

  try {
    // Start the message encryption batching.
    await encryptMessageBatch(0);

    // Files and avatars are typically fewer in number; process them once.
    const fileRows =
      (await adminGetAll("SELECT id, stored_name FROM chat_message_files")) || [];
    let encryptedFiles = 0;

    for (const row of fileRows) {
      const storedName = path.basename(String(row?.stored_name || "").trim());
      if (!storedName) continue;

      const filePath = path.join(uploadRootDir, storedName);
      if (!fs.existsSync(filePath)) continue;

      if (storageEncryption.encryptFileInPlace(filePath)) {
        encryptedFiles += 1;
        try {
          await adminRun(
            "UPDATE chat_message_files SET encryption_type = 'local' WHERE id = $1",
            [row.id],
          );
        } catch {}
      }
    }

    let encryptedAvatars = 0;
    if (fs.existsSync(avatarUploadRootDir)) {
      fs.readdirSync(avatarUploadRootDir, { withFileTypes: true }).forEach(
        (entry) => {
          if (!entry.isFile()) return;

          const filePath: any = path.join(avatarUploadRootDir, entry.name);
          if (storageEncryption.encryptFileInPlace(filePath)) {
            encryptedAvatars += 1;
          }
        },
      );
    }

    if (encryptedFiles > 0 || encryptedAvatars > 0) {
      adminSave();
      console.log(
        `[storage-encryption] encrypted ${encryptedFiles} file(s) and ${encryptedAvatars} avatar file(s) at rest.`,
      );
    }
  } catch (error) {
    console.error(
      `[storage-encryption] backfill failed: ${String(error?.message || error)}`,
    );
  }
}

registerUploadRoutes(app, { adminGetRow, storageProvider });

const apiDeps: any = {
  dbConfig: readDbConfig(),
  postgresMaintenance: null,
  storageProvider,
  mediaQueueManager,
  storageProcessingMode: process.env.STORAGE_PROCESSING_MODE || "auto",
  mediaWorkerUrl: getSetting("WORKER_URL") || process.env.WORKER_URL || process.env.MEDIA_WORKER_URL || null,
  workerUrl: getSetting("WORKER_URL") || process.env.WORKER_URL || process.env.MEDIA_WORKER_URL || null,
  workerPort: process.env.WORKER_PORT || "8080",
  webhookSecret: process.env.WEBHOOK_SECRET || null,
  webhookCallbackUrl: resolveWebhookCallbackUrl(),
  ALLOWED_AVATAR_MIME_TYPES,
  redisClient,
  redisSessionStore,
  // APP_DEBUG intentionally NOT passed here — messages.js must call
  // getSetting("APP_DEBUG") at request time so admin-panel changes apply live.
  AVATAR_FILE_LIMITS,
  // FILE_UPLOAD, MESSAGE_FILE_RETENTION_DAYS, MESSAGE_TEXT_RETENTION_DAYS,
  // TRANSCODE_VIDEOS_TO_H264, NICKNAME_MAX, USERNAME_MAX, MESSAGE_MAX_CHARS,
  // and ACCOUNT_CREATION are intentionally NOT passed here — route handlers
  // must call getSetting("KEY") at request time so admin-panel changes take
  // effect live, instead of reading a value captured once at server startup.
  MESSAGE_FILE_LIMITS,
  USER_COLORS,
  REMOTE_CHANNELS: {
    enabled: REMOTE_CHANNEL_CONFIG.enabled,
    uiEnabled: REMOTE_CHANNEL_CONFIG.uiEnabled,
    mediaStreamEnabled: REMOTE_CHANNEL_CONFIG.mediaStreamEnabled,
    telegramConfigured: REMOTE_CHANNEL_CONFIG.telegramConfigured,
    chatdeskConfigured: REMOTE_CHANNEL_CONFIG.enabled,
    proxyConfigured: REMOTE_CHANNEL_CONFIG.proxyConfigured,
  },
  USERNAME_REGEX,
  VAPID_PUBLIC_KEY: PUSH_ENABLED ? VAPID_PUBLIC_KEY : "",
  addChatMember,
  addSseClient,
  adminGetAll,
  adminGetRow,
  adminRun,
  adminSave,
  adminTransaction,
  ensureSavedChatForUser,
  avatarUploadRootDir,
  bcrypt,
  buildInspectSnapshot,
  buildTimestampSchedule,
  callManager,
  claimNextRemoteChannelQueueItem,
  chunkArray,
  cleanupMissingMessageFiles,
  clearGroupMemberRemoved,
  clearChatMemberLeft,
  clearSessionCookie,
  computeExpiryIso,
  createChat,
  createMessage,
  createOrReuseMessage,
  createMessageFiles,
  editMessage,
  createSession: createSessionCombined,
  createUser,
  crypto,
  debugLog,
  decodeOriginalFilename,
  deleteSession: deleteSessionCombined,
  deleteChatById,
  deleteUserById,
  disconnectPresence: (username, ref) => presenceTracker.markDisconnected(username, ref),
  emitChatEvent,
  emitSseEvent: (username, payload) => {
    emitSseEvent(username, payload);
    wsPresenceBroadcaster?.(username, payload);
  },
  broadcastAll: (payload) => {
    broadcastAll(payload);
    wsGlobalBroadcaster?.(payload);
  },
  broadcastPresence: (username) => presenceTracker.broadcastStatus(username),
  connectPresence: (username, ref) => presenceTracker.markConnected(username, ref),
  isUserConnected: (username) => presenceTracker.isConnected(username),
  enqueueRemoteChannelQueueItem,
  enqueueVideoTranscodeJob,
  ensureAvatarExists,
  ensureFfmpegAvailable,
  findChatById,
  findDmChat,
  findChatByGroupUsername,
  findChatByInviteToken,
  findMessageIdByClientRequestId,
  findMessageById,
  findUserById,
  findUserByUsername,
  fs,
  getCachedMembers,
  getMessageReadCounts,
  getMessageAuthors,
  getMessageReadByUser,
  getMessages,
  getFirstUnreadMessage,
  getOnlineCount: () => presenceTracker.getOnlineCount(),
  getRemoteChannelProviderState,
  getRemoteChannelQueueSummary,
  getRemoteChannelSourceByChatId,
  getRemoteChannelSourceById,
  getSessionFromRequest,
  getUploadKind,
  getUserPresence,
  hasEnoughFreeDiskSpace,
  hideChatsForUser,
  hideMessageForEveryone,
  hideMessageForUser,
  hydrateMissingVideoMetadata,
  inferMimeFromFilename,
  isConnected: (username) => presenceTracker.isConnected(username),
  getConnectedUsernames: () => presenceTracker.getConnectedUsernames(),
  isDangerousUploadFile,
  isLoopbackRequest,
  isMember,
  isGroupMemberRemoved,
  isVideoFileProcessing,
  listPushSubscriptionsByUserIds,
  listChatMembers,
  addAllEligibleChatMembers,
  listChatMembersForChats,
  listChatsForUser,
  listCallHistoryForUser,
  listEnabledRemoteChannelSources,
  listMessageFilesByMessageIds,
  listUsers,
  setMessageForwardOrigin,
  getChatMemberRole,
  setChatMemberRole,
  recordMessageReads,
  releaseStaleRemoteChannelQueueItems,
  markChatMemberLeft,
  markGroupMemberRemoved,
  markMessagesRead,
  markMessageRead,
  markRemoteChannelQueueItemDone,
  markRemoteChannelQueueItemRetry,
  markRemoteChannelQueueItemSkipped,
  parseCookies,
  parseUploadFileMetadata,
  path,
  projectRootDir,
  dataDir,
  http,
  skipAllRemoteChannelQueueItems,
  skipCurrentRemoteChannelQueueItem,
  updateRemoteChannelSourcePaused,
  probeVideoMetadata,
  regenerateGroupInviteToken,
  removeAllMessageUploads,
  removeAvatarByUrl,
  removeChatMember,
  deletePushSubscription,
  removeStoredFileNames,
  removeUploadedFiles,
  removeSseClient,
  requireSession,
  requireSessionUsernameMatch,
  sanitizeDurationSeconds,
  sanitizePositiveInt,
  searchUsers,
  searchPublicGroups,
  searchPublicChannels,
  setChatMuted,
  setMessageExpiresAt,
  setRemoteChannelProviderState,
  listMutedUserIdsForChat,
  setSessionCookie,
  recordPendingPresignedUpload,
  removePendingPresignedUploads,
  listPendingPresignedUploads,
  pruneOrphanRemoteObjects,
  pruneOrphanAvatarObjects,
  setUserColor,
  updateLastSeen,
  updateGroupChat,
  updateChannelChat,
  unhideChat,
  updateRemoteChannelSourceError,
  updateRemoteChannelSourceSeen,
  updateUserPassword,
  updateUserProfile,
  updateUserStatus,
  uploadAvatar,
  storeAvatarFile,
  uploadFiles,
  uploadRootDir,
  upsertRemoteChannelSource,
  upsertPushSubscription,
  sendPushNotificationToUsers,
  storageEncryption,
  setUserRole,
  normalizeUiLanguage,
  getUserLanguage,
  updateUserLanguage,
  DEFAULT_UI_LANGUAGE,
  // Departments & support routing (helpdesk layer)
  listDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  setUserDepartment,
  getUserDepartmentId,
  listOperatorsForDepartment,
  pickOperatorForDepartment,
  markChatDepartment,
  getChatDepartmentId,
  getSupportOverview,
  isUserAdmin,
  isUserOwner,
  getOwnerUser,
  writeAdminAuditLog,
  readAdminAuditLogs,
  clearAdminAuditLogs,
  getAdminStats,
  adminListUsers,
  adminListChats,
  adminCountUsers,
  adminCountChats,
  adminBanUser,
  adminDeleteUser,
  adminDeleteChat,
  vacuumDatabase,
  reloadDatabase,
  restoreDatabase,
  adminClearAllMessages,
  adminResetDatabase,
  // Settings
  loadSettings,
  getSetting,
  getAllSettings,
  setSetting,
  setSettings,
  resetSetting,
  validateSetting,
  SETTING_DEFS,
  dbGetSetting,
  dbSetSetting,
  dbDeleteSetting,
  dbRun: adminRun,
  dbSave: adminSave,
};

apiDeps.postgresMaintenance = apiDeps.dbConfig.client === "postgres"
  ? createPostgresMaintenance({ config: apiDeps.dbConfig })
  : null;

// Mirror-job registry + worker dispatch (Option A). The manager is created
// below; the ref is filled right after so the fallback can finish inline.
const mirrorJobRegistry: any = createMirrorJobRegistry({});
const mirrorManagerRef: any = {};
const dispatchMirrorMedia = async ({
  descriptor,
  storedName,
  filePath,
  actualSize,
  messageId,
  chatId,
  authorId,
  authorUsername,
}: any) => {
  const { dispatched } = await dispatchMirrorJob({
    workerUrl: getSetting("WORKER_URL") || process.env.WORKER_URL || process.env.MEDIA_WORKER_URL || null,
    storageProcessingMode: process.env.STORAGE_PROCESSING_MODE || "auto",
    workerPort: process.env.WORKER_PORT || "8080",
    serverPort: process.env.PORT || process.env.SERVER_PORT || "5174",
    processingTimeoutMs: Number(getSetting("STORAGE_PROCESSING_TIMEOUT_MS")) || 120000,
    webhookSecret: process.env.WEBHOOK_SECRET || null,
    registry: mirrorJobRegistry,
    storageKey: `uploads/messages/${storedName}`,
    jobMeta: {
      filePath,
      storedName,
      mimeType: descriptor?.mimeType || null,
      kind: descriptor?.kind || null,
      originalName: descriptor?.originalName || null,
      widthPx: descriptor?.widthPx ?? null,
      heightPx: descriptor?.heightPx ?? null,
      durationSeconds: descriptor?.durationSeconds ?? null,
      maxBytes: FILE_UPLOAD_MAX_SIZE,
      actualSize,
      descriptor,
      messageId,
      chatId,
      authorId,
      authorUsername,
    },
    onFallback: async () => {
      const manager = mirrorManagerRef.current;
      if (!manager) return;
      // The queue item may have been retried while the worker was slow —
      // skip when the file is already attached (the temp is swept later).
      try {
        if (
          await manager.hasMirroredFile?.(
            messageId,
            descriptor?.originalName || storedName,
          )
        ) {
          return;
        }
      } catch {
        // Best effort — fall through to the attach attempt.
      }
      const finished: any = await manager.finishMirroredMediaFile({
        descriptor,
        storedName,
        filePath,
        actualSize,
      });
      if (finished?.file) {
        await manager.attachMirroredMedia({
          messageId,
          chatId,
          authorId,
          authorUsername,
          file: finished.file,
        });
      }
    },
  });
  return dispatched;
};
// Reap orphaned mirror temps (e.g. after an unclean shutdown).
const mirrorSweepTimer: any = setInterval(() => {
  try {
    mirrorJobRegistry.sweep();
  } catch {
    // Best effort only.
  }
}, 5 * 60 * 1000);
if (typeof mirrorSweepTimer.unref === "function") mirrorSweepTimer.unref();

const remoteChannelManager: any = createRemoteChannelManager({
  config: REMOTE_CHANNEL_CONFIG,
  computeExpiryIso,
  createMessageFiles,
  createOrReuseMessage,
  crypto,
  debugLog,
  dispatchMirrorMedia,
  emitChatEvent,
  emitSseEvent,
  enqueueVideoTranscodeJob,
  ensureFfmpegAvailable,
  findChatById,
  findUserById,
  fs,
  getRemoteChannelProviderState,
  getRemoteChannelSourceById,
  getUploadKind,
  hasEnoughFreeDiskSpace,
  isDangerousUploadFile,
  listEnabledRemoteChannelSources,
  listChatMembers,
  listMessageFilesByMessageIds,
  listMutedUserIdsForChat,
  enqueueRemoteChannelQueueItem,
  releaseStaleRemoteChannelQueueItems,
  claimNextRemoteChannelQueueItem,
  markRemoteChannelQueueItemDone,
  markRemoteChannelQueueItemRetry,
  markRemoteChannelQueueItemSkipped,
  skipAllRemoteChannelQueueItems,
  skipCurrentRemoteChannelQueueItem,
  getCurrentRemoteChannelQueueItemId,
  path,
  probeVideoMetadata,
  sanitizeDurationSeconds,
  sanitizePositiveInt,
  sendPushNotificationToUsers,
  isUserConnected: (username) => presenceTracker.isConnected(username),
  setMessageExpiresAt,
  setMessageForwardOrigin,
  setRemoteChannelProviderState,
  storageEncryption,
  storageProvider,
  updateChannelChat,
  updateRemoteChannelSourceError,
  updateRemoteChannelSourceSeen,
});

apiDeps.remoteChannelManager = remoteChannelManager;
apiDeps.mirrorJobRegistry = mirrorJobRegistry;
mirrorManagerRef.current = remoteChannelManager;

if (isProduction) {
  app.use("/api", apiLimiter);
  app.use("/api/admin", adminApiLimiter);
}

registerApiRoutes(app, apiDeps);

// ── Next.js Full-Stack App Router Integration ──────────────────────────────
// Serves all non-API pages, SSR/RSC payloads, /_next/* assets, and /public/*
// through the unified Next.js runtime on the exact same HTTP + WebSocket server.
const nextApiOnly = String(process.env.NEXTDESK_API_ONLY || "").toLowerCase() === "true";
let nextApp: any = null;
let nextRequestHandler: any = null;
if (!nextApiOnly) {
  const rootRequire: any = createRequire(path.join(projectRootDir, "package.json"));
  const nextFactory: any = rootRequire("next");
  nextApp = nextFactory({
    dev: !isProduction,
    dir: projectRootDir,
    hostname: bindAddress,
    port,
  });
  await nextApp.prepare();
  nextRequestHandler = nextApp.getRequestHandler();
  if (isProduction) {
    app.use((req, res, nextFn) => {
      if (req.path.startsWith("/api/") || req.path.startsWith("/_next/static/")) {
        return nextFn();
      }
      return staticLimiter(req, res, nextFn);
    });
  }
}

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      if (req.path === "/api/profile/avatar") {
        return res.status(400).json({
          error: `Profile photo must be smaller than ${Math.round(AVATAR_FILE_LIMITS.maxFileSizeBytes / (1024 * 1024))} MB.`,
        });
      }

      return res.status(400).json({
        error: `Each file must be smaller than ${Math.round(MESSAGE_FILE_LIMITS.maxFileSizeBytes / (1024 * 1024))} MB.`,
      });
    }

    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        error: `Maximum ${MESSAGE_FILE_LIMITS.maxFiles} files per message.`,
      });
    }

    return res.status(400).json({ error: err.message });
  }
  return next(err);
});

if (nextRequestHandler) {
  app.use((req, res, nextFn) => {
    if (req.path.startsWith("/api/") || req.path === "/api") {
      return nextFn();
    }
    return nextRequestHandler(req, res);
  });
}

async function cleanupExpiredTextOnlyMessages() {
  if (getSetting("MESSAGE_TEXT_RETENTION") <= 0) {
    return { removedMessages: 0 };
  }

  const rows =
    (await adminGetAll(
      `SELECT id, chat_id
       FROM chat_messages
       WHERE expires_at IS NOT NULL
         AND expires_at != ''
         AND hidden_everyone_at IS NULL
         AND expires_at::timestamptz <= $1::timestamptz
         AND NOT EXISTS (
           SELECT 1 FROM chat_message_files
           WHERE chat_message_files.message_id = chat_messages.id
         )`,
      [new Date().toISOString()],
    )) || [];

  const messageIds = rows.map((row: any) => row?.id).filter(Boolean);
  if (!messageIds.length) {
    return { removedMessages: 0 };
  }

  const deletedByChat = new Map<any, any>();
  rows.forEach((row: any) => {
    const chatId = row?.chat_id;
    const messageId = row?.id;
    if (!chatId || !messageId) return;
    const list = deletedByChat.get(chatId) || [];
    list.push(messageId);
    deletedByChat.set(chatId, list);
  });

  await adminTransaction(async (txRun) => {
    for (const chunk of chunkArray(messageIds, 500)) {
      await txRun("DELETE FROM chat_message_reads WHERE message_id = ANY($1::text[])", [chunk]);
      await txRun("DELETE FROM hidden_chat_messages WHERE message_id = ANY($1::text[])", [chunk]);
      await txRun("DELETE FROM chat_messages WHERE id = ANY($1::text[])", [chunk]);
    }
  });

  adminSave();
  deletedByChat.forEach((ids, chatId) => {
    emitChatEvent(chatId, {
      type: "chat_message_deleted",
      chatId: chatId,
      messageIds: ids,
    });
  });

  return { removedMessages: messageIds.length };
}

async function backfillTextMessageExpiry() {
  const textRetentionDays: any = getSetting("MESSAGE_TEXT_RETENTION");
  if (textRetentionDays <= 0) return 0;

  const row = await adminGetRow(
    `SELECT COUNT(*) AS n
     FROM chat_messages
     WHERE (expires_at IS NULL OR expires_at = '')
       AND hidden_everyone_at IS NULL
       AND body IS NOT NULL
       AND TRIM(body) != ''
       AND body NOT LIKE '[[system:%]]'
       AND NOT EXISTS (
         SELECT 1 FROM chat_message_files
         WHERE chat_message_files.message_id = chat_messages.id
       )`,
  );

  const pending = Number(row?.n || 0);
  if (!pending) return 0;

  await adminRun(
    `UPDATE chat_messages
     SET expires_at = to_char(
       (created_at::timestamptz + ($1 * INTERVAL '1 day')) AT TIME ZONE 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     WHERE (expires_at IS NULL OR expires_at = '')
       AND hidden_everyone_at IS NULL
       AND body IS NOT NULL
       AND TRIM(body) != ''
       AND body NOT LIKE '[[system:%]]'
       AND NOT EXISTS (
         SELECT 1 FROM chat_message_files
         WHERE chat_message_files.message_id = chat_messages.id
       )`,
    [textRetentionDays],
  );

  adminSave();
  return pending;
}

// Cleanup timers always run — each tick re-reads the live setting, so
// enabling/disabling retention via the admin panel takes effect without a
// server restart.
try {
  await pruneOrphanRemoteObjects();
  await pruneOrphanAvatarObjects();
  if (getSetting("MESSAGE_FILE_RETENTION") > 0) {
    await backfillMessageFileExpiry();
    await cleanupExpiredMessageFiles();
  }
} catch (_) {
  // best effort startup cleanup
}

const expiryCleanupTimer: any = setInterval(async () => {
  try {
    await pruneOrphanRemoteObjects();
    await pruneOrphanAvatarObjects();
    if (getSetting("MESSAGE_FILE_RETENTION") > 0) {
      await cleanupExpiredMessageFiles();
    }
  } catch (_) {
    // keep server alive if cleanup fails
  }
}, MESSAGE_FILE_CLEANUP_INTERVAL_MS);

if (typeof expiryCleanupTimer.unref === "function") {
  expiryCleanupTimer.unref();
}

try {
  if (getSetting("MESSAGE_TEXT_RETENTION") > 0) {
    await backfillTextMessageExpiry();
    await cleanupExpiredTextOnlyMessages();
  }
} catch (_) {
  // best effort startup cleanup
}

const textCleanupTimer: any = setInterval(async () => {
  try {
    if (getSetting("MESSAGE_TEXT_RETENTION") > 0) {
      await backfillTextMessageExpiry();
      await cleanupExpiredTextOnlyMessages();
    }
  } catch (_) {
    // keep server alive if cleanup fails
  }
}, MESSAGE_FILE_CLEANUP_INTERVAL_MS);

if (typeof textCleanupTimer.unref === "function") {
  textCleanupTimer.unref();
}

// Defer the storage encryption backfill so it doesn't block the event loop
// before the server starts accepting requests.
setImmediate(() => {
  try {
    backfillStorageEncryption();
  } catch (err) {
    console.error("[storage-encryption] deferred backfill failed:", String(err?.message || err));
  }
});
remoteChannelManager.start();
initAutoAddWorker({ db: { getAutoAddPublicChatIds, bulkAddMemberToChats, findUserById, findChatById, createMessage }, emitChatEvent });

// Periodically purge old done/skipped/failed remote channel queue rows to
// prevent the table growing without bound. Runs every 24 hours; keeps rows
// that are less than 7 days old.
if (REMOTE_CHANNEL) {
  const QUEUE_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const QUEUE_PURGE_KEEP_DAYS = 7;
  const runQueuePurge = () => {
    try {
      const cutoff: any = new Date(
        Date.now() - QUEUE_PURGE_KEEP_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      purgeOldRemoteChannelQueueItems(cutoff);
    } catch (_) {
      // best effort — don't crash the server if purge fails
    }
  };
  // Run once at startup to clean up any accumulated rows.
  setImmediate(runQueuePurge);
  const queuePurgeTimer: any = setInterval(runQueuePurge, QUEUE_PURGE_INTERVAL_MS);
  if (typeof queuePurgeTimer.unref === "function") queuePurgeTimer.unref();
}

const server: any = app.listen(port, bindAddress, () => {
  console.log(`NextDesk (Full-Stack Next.js 16) server running on http://${bindAddress}:${port}`);
  console.log(
    `[server] Media worker webhook callback URL: ${apiDeps.webhookCallbackUrl}`,
  );
  ensureLocalWorkerRunning({
    transcodeVideos: TRANSCODE_VIDEOS_TO_H264,
    getSetting,
  }).catch((err) => {
    console.warn("[server] ensureLocalWorkerRunning error:", err?.message || err);
  });
});

// Admin-panel DB values win when the env var is absent (getSetting resolves
// env → DB → default). Restart required — gateway timers are wired once.
const _wsEnv: any = parseEnv();
const wsHeartbeatIntervalMs = Number(getSetting("WS_HEARTBEAT_INTERVAL_MS")) || _wsEnv.wsHeartbeatIntervalMs;
const wsHeartbeatTimeoutMs = Number(getSetting("WS_HEARTBEAT_TIMEOUT_MS")) || _wsEnv.wsHeartbeatTimeoutMs;
const wsGateway: any = createWebSocketGateway({
  server,
  sseHub,
  redisClient,
  callManager,
  getSessionFromToken: getSessionCombined,
  onUserConnected: (username, ws) => presenceTracker.markConnected(username, ws),
  onUserDisconnected: (username, ws) => presenceTracker.markDisconnected(username, ws),
  heartbeatIntervalMs: wsHeartbeatIntervalMs,
  heartbeatTimeoutMs: wsHeartbeatTimeoutMs,
});
wsPresenceBroadcaster = (username, payload) => wsGateway.sendEvent(username, payload);
wsGlobalBroadcaster = (payload) => wsGateway.broadcastAll(payload);

// Graceful shutdown for container orchestrators
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  server.close(async () => {
    try { if (nextApp && typeof nextApp.close === "function") await nextApp.close(); } catch {}
    console.log("Server closed");
    process.exit(0);
  });
  // Force exit after 10 seconds if still running
  setTimeout(() => {
    console.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully...");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

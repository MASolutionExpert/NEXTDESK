import { prisma, pgGetAll, pgGetRow, pgRun } from "./prisma.ts";
import { setUserColor } from "../settings/colors.ts";
import { generateUuid } from "../lib/uuidUtils.ts";

export const UI_LANGUAGES = ["fa", "en"] as const;
export const DEFAULT_UI_LANGUAGE = "fa";

export function normalizeUiLanguage(value: unknown): string | null {
  const lang = String(value || "").trim().toLowerCase();
  return (UI_LANGUAGES as readonly string[]).includes(lang) ? lang : null;
}

export async function findUserByUsername(username: string) {
  if (!username) return null;
  return pgGetRow(
    `SELECT id, username, nickname, avatar_url, color, status, password_hash,
            banned, role, verified, department_id, language, created_at, last_seen
     FROM users
     WHERE LOWER(username) = LOWER($1)
     LIMIT 1`,
    [String(username).trim()],
  );
}

export async function findUserById(id: string) {
  if (!id) return null;
  return pgGetRow(
    `SELECT id, username, nickname, avatar_url, color, status, password_hash,
            banned, role, verified, department_id, language, created_at, last_seen
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [String(id)],
  );
}

export function normalizeSearchTerm(query: unknown): string {
  return String(query || "")
    .trim()
    .replace(/^@+/, "")
    .trim();
}

function escapeSearchLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function listUsers(excludeUserOrId?: string | null) {
  if (excludeUserOrId) {
    return pgGetAll(
      `SELECT id, username, nickname, avatar_url, color, status, banned, role, verified, department_id, language
       FROM users
       WHERE id != $1 AND LOWER(username) != LOWER($1)
       ORDER BY username ASC`,
      [String(excludeUserOrId)],
    );
  }
  return pgGetAll(
    `SELECT id, username, nickname, avatar_url, color, status, banned, role, verified, department_id, language
     FROM users
     ORDER BY username ASC`,
  );
}

export async function searchUsers(
  query: string,
  excludeUserOrId?: string | null,
  limit = 20,
) {
  const cleaned = normalizeSearchTerm(query);
  if (!cleaned) return [];
  const like = `%${escapeSearchLike(cleaned.toLowerCase())}%`;
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  if (excludeUserOrId) {
    return pgGetAll(
      `SELECT id, username, nickname, avatar_url, color, status, banned, role, verified
       FROM users
       WHERE id != $1
         AND LOWER(username) != LOWER($1)
         AND (LOWER(username) LIKE $2 ESCAPE '\' OR LOWER(COALESCE(nickname, '')) LIKE $2 ESCAPE '\')
       ORDER BY CASE WHEN LOWER(username) LIKE $2 ESCAPE '\' THEN 0 ELSE 1 END, username ASC
       LIMIT $3`,
      [String(excludeUserOrId), like, safeLimit],
    );
  }
  return pgGetAll(
    `SELECT id, username, nickname, avatar_url, color, status, banned, role, verified
     FROM users
     WHERE LOWER(username) LIKE $1 ESCAPE '\' OR LOWER(COALESCE(nickname, '')) LIKE $1 ESCAPE '\'
     ORDER BY CASE WHEN LOWER(username) LIKE $1 ESCAPE '\' THEN 0 ELSE 1 END, username ASC
     LIMIT $2`,
    [like, safeLimit],
  );
}

export async function createUser(
  username: string,
  passwordHash: string,
  nickname: string | null = null,
  avatarUrl: string | null = null,
  color: string | null = null,
  status = "online",
  role = "user",
  verified = 0,
  language: string | null = null,
): Promise<string> {
  const id = generateUuid();
  const safeColor = color || setUserColor();
  const safeLang = normalizeUiLanguage(language) || DEFAULT_UI_LANGUAGE;
  const now = new Date().toISOString();

  await prisma.user.create({
    data: {
      id,
      username: String(username).trim().toLowerCase(),
      nickname: nickname ?? null,
      avatarUrl: avatarUrl ?? null,
      color: safeColor,
      status: status || "online",
      passwordHash,
      role: role || "user",
      verified: verified ? 1 : 0,
      language: safeLang,
      createdAt: now,
      lastSeen: now,
    },
  });
  return id;
}

export async function updateUserProfile(
  userId: string,
  arg2: any,
  nickname?: string | null,
  avatarUrl?: string | null,
) {
  const payload =
    typeof arg2 === "object" && arg2 !== null
      ? {
          username: arg2.username,
          nickname: arg2.nickname,
          avatarUrl: arg2.avatarUrl,
        }
      : { username: arg2, nickname, avatarUrl };

  const data: Record<string, any> = {};
  if (payload.username !== undefined) data.username = payload.username;
  if (payload.nickname !== undefined) data.nickname = payload.nickname;
  if (payload.avatarUrl !== undefined) data.avatarUrl = payload.avatarUrl;
  if (!Object.keys(data).length) return 0;

  const res = await prisma.user.updateMany({
    where: { id: String(userId) },
    data,
  });
  return res.count;
}

export async function updateUserPassword(userId: string, passwordHash: string) {
  const res = await prisma.user.updateMany({
    where: { id: String(userId) },
    data: { passwordHash },
  });
  return res.count;
}

export async function updateUserStatus(userId: string, status: string) {
  const res = await prisma.user.updateMany({
    where: { id: String(userId) },
    data: { status },
  });
  return res.count;
}

export async function setUserBanned(userId: string, banned: boolean | number) {
  const res = await prisma.user.updateMany({
    where: { id: String(userId) },
    data: { banned: banned ? 1 : 0 },
  });
  return res.count;
}

export async function updateLastSeen(userId: string) {
  if (!userId) return 0;
  return pgRun(
    `UPDATE users SET last_seen = CURRENT_TIMESTAMP::text WHERE id = $1`,
    [String(userId)],
  );
}

export async function getUserPresence(username: string) {
  const norm = String(username || "").trim().toLowerCase();
  if (!norm) return null;
  return pgGetRow(
    `SELECT id, username, status, last_seen
     FROM users
     WHERE LOWER(username) = $1
     LIMIT 1`,
    [norm],
  );
}

export async function setUserRole(userId: string, role: string) {
  const res = await prisma.user.updateMany({
    where: { id: String(userId) },
    data: { role },
  });
  return res.count;
}

export async function getUserLanguage(userId: string): Promise<string> {
  if (!userId) return DEFAULT_UI_LANGUAGE;
  const user = await prisma.user.findUnique({
    where: { id: String(userId) },
    select: { language: true },
  });
  return normalizeUiLanguage(user?.language) || DEFAULT_UI_LANGUAGE;
}

export async function updateUserLanguage(
  userId: string,
  language: string,
): Promise<boolean> {
  const lang = normalizeUiLanguage(language);
  if (!userId || !lang) return false;
  await prisma.user.updateMany({
    where: { id: String(userId) },
    data: { language: lang },
  });
  return true;
}

export async function getUserRole(userId: string): Promise<string> {
  if (!userId) return "user";
  const user = await prisma.user.findUnique({
    where: { id: String(userId) },
    select: { role: true },
  });
  return user?.role || "user";
}

export async function isUserAdmin(userId: string): Promise<boolean> {
  const role = await getUserRole(userId);
  return role === "admin" || role === "owner";
}

export async function isUserOwner(userId: string): Promise<boolean> {
  const role = await getUserRole(userId);
  return role === "owner";
}

export async function getOwnerUser() {
  return prisma.user.findFirst({
    where: { role: "owner" },
    select: { id: true, username: true },
  });
}

export async function bootstrapAdminUsers(adminUsernames: string[]) {
  if (!Array.isArray(adminUsernames) || !adminUsernames.length) return;
  for (const username of adminUsernames) {
    const norm = String(username || "").trim().toLowerCase();
    if (!norm) continue;
    const user = await prisma.user.findFirst({
      where: { username: { equals: norm, mode: "insensitive" } },
      select: { id: true, role: true },
    });
    if (user && user.id && user.role !== "admin" && user.role !== "owner") {
      await prisma.user.update({
        where: { id: user.id },
        data: { role: "admin" },
      });
    }
  }
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function createSession(userId: string, token: string) {
  if (!userId || !token) {
    throw new Error(`Invalid session parameters: userId=${userId}, token=${token}`);
  }
  const now = new Date().toISOString();
  await prisma.session.create({
    data: {
      userId: String(userId),
      token: String(token),
      createdAt: now,
      lastSeen: now,
    },
  });
  return 1;
}

export async function getSession(token: string) {
  if (!token) return null;
  return pgGetRow(
    `SELECT sessions.id AS session_id, sessions.token,
            users.id, users.username, users.nickname, users.avatar_url,
            users.color, users.status, users.banned, users.role, users.verified
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = $1
       AND COALESCE(users.banned, 0) = 0
     LIMIT 1`,
    [String(token)],
  );
}

export async function touchSession(token: string) {
  if (!token) return 0;
  return pgRun(
    `UPDATE sessions SET last_seen = CURRENT_TIMESTAMP::text WHERE token = $1`,
    [String(token)],
  );
}

export async function deleteSession(token: string) {
  if (!token) return 0;
  const res = await prisma.session.deleteMany({
    where: { token: String(token) },
  });
  return res.count;
}

export async function deleteSessionsByUserId(userId: string) {
  if (!userId) return 0;
  const res = await prisma.session.deleteMany({
    where: { userId: String(userId) },
  });
  return res.count;
}

// ─── Push Subscriptions ───────────────────────────────────────────────────────

export async function upsertPushSubscription(
  userId: string,
  endpoint: string,
  p256dh: string,
  auth: string,
  messagePreview: number | boolean = 1,
) {
  const safeEndpoint = String(endpoint || "").trim();
  if (!userId || !safeEndpoint) return 0;
  const preview = messagePreview === 0 || messagePreview === false ? 0 : 1;
  const now = new Date().toISOString();

  await prisma.pushSubscription.upsert({
    where: { endpoint: safeEndpoint },
    create: {
      userId: String(userId),
      endpoint: safeEndpoint,
      p256dh: String(p256dh || ""),
      auth: String(auth || ""),
      messagePreview: preview,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      userId: String(userId),
      p256dh: String(p256dh || ""),
      auth: String(auth || ""),
      messagePreview: preview,
      updatedAt: now,
    },
  });
  return 1;
}

export async function deletePushSubscription(endpoint: string) {
  const safeEndpoint = String(endpoint || "").trim();
  if (!safeEndpoint) return 0;
  const res = await prisma.pushSubscription.deleteMany({
    where: { endpoint: safeEndpoint },
  });
  return res.count;
}

export async function listPushSubscriptionsByUserIds(userIds: string[] = []) {
  const ids = Array.from(
    new Set((Array.isArray(userIds) ? userIds : []).filter(Boolean).map(String)),
  );
  if (!ids.length) return [];
  return pgGetAll(
    `SELECT user_id, endpoint, p256dh, auth, message_preview
     FROM push_subscriptions
     WHERE user_id = ANY($1::text[])`,
    [ids],
  );
}

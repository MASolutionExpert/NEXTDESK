import { prisma, pgGetAll, pgGetRow, pgRun, withPgTransaction } from "./prisma.ts";
import { deleteChatById, deleteUserById } from "./chatsRepo.ts";
import { storageEncryption } from "../lib/storageEncryption.ts";

const SUPPORT_ROLES = ["operator", "admin", "owner"] as const;

const RESET_TABLES = [
  "chat_message_reads",
  "hidden_chat_messages",
  "chat_message_files",
  "chat_messages",
  "hidden_chats",
  "chat_mutes",
  "chat_members",
  "chat_left_members",
  "group_removed_members",
  "remote_channel_queue",
  "remote_channel_sources",
  "remote_channel_provider_state",
  "push_subscriptions",
  "sessions",
  "chats",
  "users",
];

function escapeLikePattern(value: unknown): string {
  return String(value).replace(/[\\%_]/g, (char) => `\\${char}`);
}

function naturalSortExpr(
  col: string,
  tiebreaker: string | null = null,
  dir = "ASC",
): string {
  const d = dir === "DESC" ? "DESC" : "ASC";
  const textPart = `LOWER(RTRIM(COALESCE(${col}, ''), '0123456789')) ${d}`;
  const numPart = `COALESCE(NULLIF(SUBSTRING(COALESCE(${col}, '') FROM '([0-9]+)$'), '')::BIGINT, 0) ${d}`;
  const parts = [textPart, numPart];
  if (tiebreaker) parts.push(`LOWER(COALESCE(${tiebreaker}, '')) ${d}`);
  return parts.join(", ");
}

export async function getAdminStats() {
  const [userStats, chatStats, messageStats, totalSessions, totalFiles, pushSubscriptions] =
    await Promise.all([
      pgGetRow(
        `SELECT COUNT(*) AS "totalUsers",
                COUNT(*) FILTER (WHERE banned = 1) AS "bannedUsers",
                COUNT(*) FILTER (WHERE created_at >= (CURRENT_TIMESTAMP - INTERVAL '7 days')::text) AS "newUsers7d",
                COUNT(*) FILTER (WHERE status = 'online') AS "onlineUsers"
         FROM users`,
      ).then((r) => r || {}),
      pgGetRow(
        `SELECT COUNT(*) FILTER (WHERE type IN ('group', 'channel')) AS "totalChats",
                COUNT(*) FILTER (WHERE type = 'dm') AS "dmChats",
                COUNT(*) FILTER (WHERE type = 'group') AS "groupChats",
                COUNT(*) FILTER (WHERE type = 'channel') AS "channelChats"
         FROM chats`,
      ).then((r) => r || {}),
      pgGetRow(
        `SELECT COUNT(*) AS "totalMessages",
                COUNT(*) FILTER (WHERE created_at >= (CURRENT_TIMESTAMP - INTERVAL '1 day')::text) AS "messagesLast24h"
         FROM chat_messages`,
      ).then((r) => r || {}),
      prisma.session.count().catch(() => 0),
      prisma.chatMessageFile.count().catch(() => 0),
      prisma.pushSubscription.count().catch(() => 0),
    ]);

  return {
    totalUsers: Number((userStats as any).totalUsers || 0),
    bannedUsers: Number((userStats as any).bannedUsers || 0),
    newUsers7d: Number((userStats as any).newUsers7d || 0),
    onlineUsers: Number((userStats as any).onlineUsers || 0),
    totalChats: Number((chatStats as any).totalChats || 0),
    dmChats: Number((chatStats as any).dmChats || 0),
    groupChats: Number((chatStats as any).groupChats || 0),
    channelChats: Number((chatStats as any).channelChats || 0),
    totalMessages: Number((messageStats as any).totalMessages || 0),
    messagesLast24h: Number((messageStats as any).messagesLast24h || 0),
    totalSessions: Number(totalSessions || 0),
    totalFiles: Number(totalFiles || 0),
    pushSubscriptions: Number(pushSubscriptions || 0),
  };
}

function buildAdminUserWhere({
  search = "",
  roleFilter = null,
  statusFilter = null,
  verifiedFilter = null,
  connectedUsernames = null,
}: any) {
  const clauses: string[] = [];
  const params: any[] = [];

  if (search) {
    const like = `%${escapeLikePattern(search)}%`;
    clauses.push(`(username ILIKE ? ESCAPE '\\' OR nickname ILIKE ? ESCAPE '\\')`);
    params.push(like, like);
  }

  if (roleFilter === "banned") {
    clauses.push(`banned = 1`);
  } else if (roleFilter) {
    clauses.push(`banned = 0 AND role = ?`);
    params.push(String(roleFilter));
  }

  if (statusFilter === "online") {
    clauses.push(`(status = 'online' OR status IS NULL OR status != 'invisible')`);
    if (Array.isArray(connectedUsernames)) {
      const lowerConnected = connectedUsernames
        .map((u) => String(u).toLowerCase())
        .filter(Boolean);
      if (lowerConnected.length === 0) {
        clauses.push(`1 = 0`);
      } else {
        clauses.push(`LOWER(username) = ANY(?::text[])`);
        params.push(lowerConnected);
      }
    }
  } else if (statusFilter === "offline") {
    if (Array.isArray(connectedUsernames)) {
      const lowerConnected = connectedUsernames
        .map((u) => String(u).toLowerCase())
        .filter(Boolean);
      if (lowerConnected.length > 0) {
        clauses.push(`(NOT (LOWER(username) = ANY(?::text[])) OR status = 'invisible')`);
        params.push(lowerConnected);
      }
    } else {
      clauses.push(`status = 'invisible'`);
    }
  }

  if (verifiedFilter === "1" || verifiedFilter === "true") {
    clauses.push(`verified = 1`);
  } else if (verifiedFilter === "0" || verifiedFilter === "false") {
    clauses.push(`(verified = 0 OR verified IS NULL)`);
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export async function adminListUsers({
  limit = 200,
  offset = 0,
  search = "",
  sortBy = "id",
  sortDir = "DESC",
  roleFilter = null,
  statusFilter = null,
  verifiedFilter = null,
  connectedUsernames = null,
}: any = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeSortBy = [
    "id",
    "username",
    "nickname",
    "role",
    "created_at",
    "last_seen",
  ].includes(sortBy)
    ? sortBy
    : "id";
  const safeSortDir = sortDir === "ASC" ? "ASC" : "DESC";

  const { whereSql, params } = buildAdminUserWhere({
    search,
    roleFilter,
    statusFilter,
    verifiedFilter,
    connectedUsernames,
  });

  let orderSql = `${safeSortBy} ${safeSortDir}`;
  if (safeSortBy === "nickname") {
    orderSql = naturalSortExpr("nickname", "username", safeSortDir);
  } else if (safeSortBy === "username") {
    orderSql = naturalSortExpr("username", "nickname", safeSortDir);
  }

  const rows = await pgGetAll(
    `SELECT id, username, nickname, avatar_url, color, status, role, banned,
            verified, created_at, last_seen, department_id,
            CASE WHEN status = 'online' THEN 1 ELSE 0 END AS online,
            COUNT(*) OVER() AS _total
     FROM users
     ${whereSql}
     ORDER BY ${orderSql}
     LIMIT ? OFFSET ?`,
    [...params, safeLimit, safeOffset],
  );

  const list = rows || [];
  const total = list.length > 0 ? Number(list[0]._total || 0) : 0;
  const users = list.map(({ _total, ...u }: any) => u);
  return { users, total };
}

export async function adminCountUsers(filters: any = {}): Promise<number> {
  const { whereSql, params } = buildAdminUserWhere(filters);
  const row = await pgGetRow<{ count: number }>(
    `SELECT COUNT(*) AS count FROM users ${whereSql}`,
    params,
  );
  return Number(row?.count || 0);
}

function buildAdminChatWhere({
  search = "",
  typeFilter = null,
  visibilityFilter = null,
  verifiedFilter = null,
  autoAddFilter = null,
  remoteFilter = null,
}: any) {
  const clauses: string[] = [`c.type IN ('group', 'channel', 'dm')`];
  const params: any[] = [];

  if (search) {
    const like = `%${escapeLikePattern(search)}%`;
    clauses.push(
      `(c.name ILIKE ? ESCAPE '\\' OR c.group_username ILIKE ? ESCAPE '\\' OR EXISTS (
          SELECT 1 FROM chat_members scm
          JOIN users su ON su.id = scm.user_id
          WHERE scm.chat_id = c.id
            AND (su.username ILIKE ? ESCAPE '\\' OR su.nickname ILIKE ? ESCAPE '\\')
        ))`,
    );
    params.push(like, like, like, like);
  }

  if (typeFilter === "group" || typeFilter === "channel" || typeFilter === "dm") {
    clauses.push(`c.type = ?`);
    params.push(typeFilter);
  }

  if (visibilityFilter === "public" || visibilityFilter === "private") {
    clauses.push(`c.group_visibility = ?`);
    params.push(visibilityFilter);
  }

  if (verifiedFilter === "1" || verifiedFilter === "true") {
    clauses.push(`c.verified = 1`);
  } else if (verifiedFilter === "0" || verifiedFilter === "false") {
    clauses.push(`(c.verified = 0 OR c.verified IS NULL)`);
  }

  if (autoAddFilter === "1" || autoAddFilter === "true") {
    clauses.push(`c.auto_add_new_users = 1`);
  } else if (autoAddFilter === "0" || autoAddFilter === "false") {
    clauses.push(`(c.auto_add_new_users = 0 OR c.auto_add_new_users IS NULL)`);
  }

  if (remoteFilter === "active") {
    clauses.push(`rcs.enabled = 1 AND (rcs.paused = 0 OR rcs.paused IS NULL)`);
  } else if (remoteFilter === "paused") {
    clauses.push(`rcs.enabled = 1 AND rcs.paused = 1`);
  } else if (remoteFilter === "disabled") {
    clauses.push(`rcs.enabled = 0`);
  } else if (remoteFilter === "none") {
    clauses.push(`rcs.id IS NULL`);
  }

  return {
    whereSql: `WHERE ${clauses.join(" AND ")}`,
    params,
  };
}

export async function adminListChats({
  limit = 200,
  offset = 0,
  search = "",
  sortBy = "id",
  sortDir = "DESC",
  typeFilter = null,
  visibilityFilter = null,
  verifiedFilter = null,
  autoAddFilter = null,
  remoteFilter = null,
}: any = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeSortBy = [
    "id",
    "name",
    "type",
    "group_visibility",
    "created_at",
    "member_count",
    "message_count",
  ].includes(sortBy)
    ? sortBy
    : "id";
  const safeSortDir = sortDir === "ASC" ? "ASC" : "DESC";

  const { whereSql, params } = buildAdminChatWhere({
    search,
    typeFilter,
    visibilityFilter,
    verifiedFilter,
    autoAddFilter,
    remoteFilter,
  });

  let orderSql = `c.${safeSortBy} ${safeSortDir}`;
  if (safeSortBy === "member_count" || safeSortBy === "message_count") {
    orderSql = `${safeSortBy} ${safeSortDir}`;
  } else if (safeSortBy === "name") {
    orderSql = naturalSortExpr("c.name", "c.group_username", safeSortDir);
  } else if (safeSortBy === "type" || safeSortBy === "group_visibility") {
    orderSql = `LOWER(COALESCE(c.${safeSortBy}, '')) ${safeSortDir}`;
  }

  const rows = await pgGetAll(
    `SELECT c.id, c.name, c.type, c.group_username, c.group_visibility,
            c.group_color, c.group_avatar_url, c.created_at, c.verified, c.auto_add_new_users,
            (SELECT string_agg(pu.username, ', ' ORDER BY pu.username)
             FROM chat_members pcm
             JOIN users pu ON pu.id = pcm.user_id
             WHERE pcm.chat_id = c.id) AS participants,
            (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) AS member_count,
            (SELECT COUNT(*) FROM chat_messages WHERE chat_id = c.id) AS message_count,
            owner.id AS owner_id,
            owner.username AS owner_username,
            owner.nickname AS owner_nickname,
            owner.avatar_url AS owner_avatar_url,
            owner.color AS owner_color,
            owner.verified AS owner_verified,
            owner.role AS owner_role,
            rcs.enabled AS remote_enabled,
            rcs.paused AS remote_paused,
            COUNT(*) OVER() AS _total
     FROM chats c
     LEFT JOIN users owner ON owner.id = (
       SELECT user_id FROM chat_members WHERE chat_id = c.id AND role = 'owner' LIMIT 1
     )
     LEFT JOIN remote_channel_sources rcs ON rcs.chat_id = c.id
     ${whereSql}
     ORDER BY ${orderSql}
     LIMIT ? OFFSET ?`,
    [...params, safeLimit, safeOffset],
  );

  const list = rows || [];
  const total = list.length > 0 ? Number(list[0]._total || 0) : 0;
  const chats = list.map(({ _total, ...chat }: any) => chat);
  return { chats, total };
}

export async function adminCountChats(filters: any = {}): Promise<number> {
  const { whereSql, params } = buildAdminChatWhere(filters);
  const row = await pgGetRow<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM chats c
     LEFT JOIN remote_channel_sources rcs ON rcs.chat_id = c.id
     ${whereSql}`,
    params,
  );
  return Number(row?.count || 0);
}

export async function adminBanUser(userId: string, banned: boolean | number) {
  const res = await prisma.user.updateMany({
    where: { id: String(userId) },
    data: { banned: banned ? 1 : 0 },
  });
  return res.count;
}

export function adminDeleteUser(userId: string) {
  return deleteUserById(userId);
}

export function adminDeleteChat(chatId: string) {
  return deleteChatById(chatId);
}

// ─── Admin Audit Logs ─────────────────────────────────────────────────────────

function serializeAuditDetails(details: unknown): string | null {
  if (details === undefined || details === null) return null;
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function mapAuditRow(row: any) {
  if (!row) return row;
  return {
    ts: row.ts ?? null,
    actorUserId: row.actor_user_id ?? null,
    actorUsername: row.actor_username ?? null,
    action: row.action ?? "",
    targetType: row.target_type ?? null,
    targetLabel: row.target_label ?? null,
    details: row.details ?? null,
    status: row.status ?? "success",
  };
}

export async function writeAdminAuditLog({
  ts = null,
  actorUserId = null,
  actorUsername = null,
  action,
  targetType = null,
  targetLabel = null,
  details = null,
  status = "success",
}: any = {}) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        ts: ts || new Date().toISOString(),
        actorUserId: actorUserId ?? null,
        actorUsername: actorUsername ?? null,
        action: String(action || ""),
        targetType: targetType ?? null,
        targetLabel: targetLabel ?? null,
        details: serializeAuditDetails(details),
        status: status ?? "success",
      },
    });
  } catch {
    // Logging must never break request flows
  }
}

export async function readAdminAuditLogs({
  limit = 200,
  offset = 0,
  search = "",
}: any = {}) {
  try {
    const safeLimit = Math.max(1, Number(limit) || 200);
    const safeOffset = Math.max(0, Number(offset) || 0);
    const needle = String(search || "").trim();

    let whereSql = "";
    const params: any[] = [];
    if (needle) {
      const like = `%${escapeLikePattern(needle)}%`;
      whereSql = `WHERE actor_username ILIKE ? ESCAPE '\\'
                     OR action ILIKE ? ESCAPE '\\'
                     OR target_label ILIKE ? ESCAPE '\\'
                     OR details ILIKE ? ESCAPE '\\'`;
      params.push(like, like, like, like);
    }

    const rows = await pgGetAll(
      `SELECT ts, actor_user_id, actor_username, action, target_type,
              target_label, details, status, COUNT(*) OVER() AS _total
       FROM admin_audit_logs
       ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, safeLimit, safeOffset],
    );

    const list = rows || [];
    const total = list.length > 0 ? Number(list[0]._total || 0) : 0;
    return { entries: list.map(mapAuditRow), total };
  } catch {
    return { entries: [], total: 0 };
  }
}

export async function clearAdminAuditLogs() {
  try {
    const res = await prisma.adminAuditLog.deleteMany({});
    return res.count;
  } catch {
    return 0;
  }
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

export async function vacuumDatabase() {
  await pgRun("VACUUM ANALYZE");
}

export async function reloadDatabase() {
  // No-op in PostgreSQL mode: connections read directly from the live Postgres server.
}

export async function restoreDatabase(_fileBuffer?: Buffer) {
  throw new Error(
    "PostgreSQL database restore must be performed via pg_restore / psql (postgresMaintenance.restore).",
  );
}

export async function adminClearAllMessages() {
  return withPgTransaction(async (tx) => {
    const fileRows = await tx.getAll<{ stored_name: string }>(
      `SELECT stored_name FROM chat_message_files`,
    );
    const storedNames = fileRows.map((row) => row.stored_name).filter(Boolean);
    await tx.run(`DELETE FROM chat_message_reads`);
    await tx.run(`DELETE FROM hidden_chat_messages`);
    await tx.run(`DELETE FROM chat_message_files`);
    await tx.run(`DELETE FROM chat_messages`);
    return { storedNames };
  });
}

export async function adminResetDatabase() {
  return withPgTransaction(async (tx) => {
    const fileRows = await tx.getAll<{ stored_name: string }>(
      `SELECT stored_name FROM chat_message_files`,
    );
    const storedNames = fileRows.map((row) => row.stored_name).filter(Boolean);
    await tx.run(
      `TRUNCATE TABLE ${RESET_TABLES.join(", ")} RESTART IDENTITY CASCADE`,
    );
    return { storedNames };
  });
}

// ─── App Settings ─────────────────────────────────────────────────────────────

export async function dbGetAllSettings() {
  return prisma.appSetting.findMany({
    select: { key: true, value: true },
  });
}

export async function dbGetSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({
    where: { key: String(key) },
    select: { value: true },
  });
  if (row?.value === undefined || row?.value === null) return null;
  return String(row.value);
}

export async function dbSetSetting(key: string, value: unknown) {
  await prisma.appSetting.upsert({
    where: { key: String(key) },
    create: { key: String(key), value: String(value) },
    update: { value: String(value) },
  });
}

export async function dbDeleteSetting(key: string) {
  await prisma.appSetting.deleteMany({
    where: { key: String(key) },
  });
}

// ─── Departments & Support Routing ────────────────────────────────────────────

function normalizeDepartmentRow(row: any) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description || null,
    color: row.color || null,
    active: Boolean(Number(row.active ?? 1)),
    createdAt: row.created_at ?? row.createdAt ?? null,
  };
}

export async function listDepartments({ activeOnly = true }: any = {}) {
  const rows = await prisma.department.findMany({
    where: activeOnly ? { active: 1 } : undefined,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return rows.map(normalizeDepartmentRow);
}

export async function getDepartmentById(id: number | string) {
  const numId = Number(id);
  if (!Number.isFinite(numId) || numId <= 0) return null;
  const row = await prisma.department.findUnique({
    where: { id: numId },
  });
  return normalizeDepartmentRow(row);
}

export async function createDepartment({
  name,
  description = null,
  color = null,
}: any = {}) {
  const cleanName = String(name || "").trim().slice(0, 100);
  if (!cleanName) throw new Error("Department name is required.");
  const created = await prisma.department.create({
    data: {
      name: cleanName,
      description: description ? String(description).trim().slice(0, 300) : null,
      color: color ? String(color).trim().slice(0, 20) : null,
      active: 1,
    },
  });
  return normalizeDepartmentRow(created);
}

export async function updateDepartment(
  id: number | string,
  { name, description, color, active }: any = {},
): Promise<boolean> {
  const numId = Number(id);
  if (!Number.isFinite(numId) || numId <= 0) return false;
  const data: Record<string, any> = {};
  if (name !== undefined) {
    const clean = String(name || "").trim().slice(0, 100);
    if (!clean) throw new Error("Department name cannot be empty.");
    data.name = clean;
  }
  if (description !== undefined) {
    data.description = description
      ? String(description).trim().slice(0, 300)
      : null;
  }
  if (color !== undefined) {
    data.color = color ? String(color).trim().slice(0, 20) : null;
  }
  if (active !== undefined) data.active = active ? 1 : 0;
  if (!Object.keys(data).length) return true;

  await prisma.department.updateMany({
    where: { id: numId },
    data,
  });
  return true;
}

export async function deleteDepartment(id: number | string): Promise<boolean> {
  const numId = Number(id);
  if (!Number.isFinite(numId) || numId <= 0) return false;
  await prisma.department.updateMany({
    where: { id: numId },
    data: { active: 0 },
  });
  return true;
}

export async function setUserDepartment(
  userId: string,
  departmentId: number | string | null,
): Promise<boolean> {
  if (!userId) return false;
  await prisma.user.updateMany({
    where: { id: String(userId) },
    data: { departmentId: departmentId ? Number(departmentId) : null },
  });
  return true;
}

export async function getUserDepartmentId(
  userId: string,
): Promise<number | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: String(userId) },
    select: { departmentId: true },
  });
  return user?.departmentId ? Number(user.departmentId) : null;
}

export async function listOperatorsForDepartment(departmentId: number | string) {
  const numId = Number(departmentId);
  if (!Number.isFinite(numId) || numId <= 0) return [];
  return pgGetAll(
    `SELECT id, username, nickname, color, role, status, department_id
     FROM users
     WHERE department_id = $1
       AND role = ANY($2::text[])
     ORDER BY username ASC`,
    [numId, [...SUPPORT_ROLES]],
  );
}

export async function pickOperatorForDepartment(departmentId: number | string) {
  const operators = await listOperatorsForDepartment(departmentId);
  if (!operators.length) return null;

  const numId = Number(departmentId);
  const [loadRows, handledChats] = await Promise.all([
    pgGetAll<{ user_id: string; open_chats: number; last_assignment: string }>(
      `SELECT m.user_id,
              COUNT(*) AS open_chats,
              MAX(c.created_at) AS last_assignment
       FROM chat_members m
       JOIN chats c ON c.id = m.chat_id
       JOIN chat_messages last_cm ON last_cm.chat_id = c.id
         AND last_cm.id = (
           SELECT id FROM chat_messages
           WHERE chat_id = c.id
           ORDER BY created_at DESC, id DESC
           LIMIT 1
         )
       WHERE c.department_id = $1
         AND c.type = 'dm'
         AND m.role IN ('owner', 'member')
       GROUP BY m.user_id`,
      [numId],
    ),
    pgGetAll<{ user_id: string; handled: number }>(
      `SELECT m.user_id, COUNT(*) AS handled
       FROM chat_members m
       JOIN chats c ON c.id = m.chat_id
       JOIN chat_messages last_cm ON last_cm.chat_id = c.id
         AND last_cm.id = (
           SELECT id FROM chat_messages
           WHERE chat_id = c.id
           ORDER BY created_at DESC, id DESC
           LIMIT 1
         )
       WHERE c.department_id = $1
         AND c.type = 'dm'
         AND last_cm.user_id = m.user_id
       GROUP BY m.user_id`,
      [numId],
    ),
  ]);

  const load = new Map<string, number>();
  const lastAssigned = new Map<string, string>();
  for (const r of loadRows) {
    const uid = String(r.user_id);
    load.set(uid, Number(r.open_chats || 0));
    lastAssigned.set(uid, String(r.last_assignment || ""));
  }
  const handled = new Map<string, number>();
  for (const r of handledChats) {
    handled.set(String(r.user_id), Number(r.handled || 0));
  }

  let best: any = null;
  for (const op of operators) {
    const uid = String(op.id);
    const open = Math.max(0, (load.get(uid) || 0) - (handled.get(uid) || 0));
    const candidate = { operator: op, open, last: lastAssigned.get(uid) || "" };
    if (
      !best ||
      candidate.open < best.open ||
      (candidate.open === best.open &&
        (!candidate.last || candidate.last < best.last))
    ) {
      best = candidate;
    }
  }
  return best.operator;
}

export async function markChatDepartment(
  chatId: string,
  departmentId: number | string | null,
): Promise<boolean> {
  if (!chatId) return false;
  await prisma.chat.updateMany({
    where: { id: String(chatId) },
    data: { departmentId: departmentId ? Number(departmentId) : null },
  });
  return true;
}

export async function getChatDepartmentId(
  chatId: string,
): Promise<number | null> {
  if (!chatId) return null;
  const chat = await prisma.chat.findUnique({
    where: { id: String(chatId) },
    select: { departmentId: true },
  });
  return chat?.departmentId ? Number(chat.departmentId) : null;
}

export async function getSupportOverview() {
  const [deptList, chatRows, operatorCounts] = await Promise.all([
    listDepartments({ activeOnly: false }),
    pgGetAll(
      `SELECT c.id, c.department_id, c.created_at,
              d.name AS department_name,
              (SELECT u.id FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.chat_id = c.id AND u.role = 'user' LIMIT 1) AS customer_user_id,
              (SELECT u.username FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.chat_id = c.id AND u.role = 'user' LIMIT 1) AS customer_username,
              (SELECT u.nickname FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.chat_id = c.id AND u.role = 'user' LIMIT 1) AS customer_nickname,
              (SELECT u.username FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.chat_id = c.id AND u.role IN ('operator','admin','owner') LIMIT 1) AS operator_username,
              (SELECT u.nickname FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.chat_id = c.id AND u.role IN ('operator','admin','owner') LIMIT 1) AS operator_nickname,
              (SELECT body FROM chat_messages WHERE chat_id = c.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_message_body,
              (SELECT user_id FROM chat_messages WHERE chat_id = c.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_message_user_id,
              (SELECT created_at FROM chat_messages WHERE chat_id = c.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_message_at,
              (SELECT COUNT(*) FROM chat_messages WHERE chat_id = c.id) AS message_count
       FROM chats c
       LEFT JOIN departments d ON d.id = c.department_id
       WHERE c.department_id IS NOT NULL AND c.type = 'dm'
       ORDER BY c.created_at DESC
       LIMIT 200`,
    ),
    pgGetAll<{ department_id: number; cnt: number }>(
      `SELECT department_id, COUNT(*) AS cnt
       FROM users
       WHERE role = ANY($1::text[]) AND department_id IS NOT NULL
       GROUP BY department_id`,
      [[...SUPPORT_ROLES]],
    ),
  ]);

  const byDepartment = new Map<number, any>();
  for (const dept of deptList) {
    if (!dept) continue;
    byDepartment.set(Number(dept.id), {
      id: dept.id,
      name: dept.name,
      active: dept.active,
      chats: 0,
      open: 0,
      messages: 0,
      operators: 0,
    });
  }

  for (const r of operatorCounts) {
    const entry = byDepartment.get(Number(r.department_id));
    if (entry) entry.operators = Number(r.cnt || 0);
  }

  const decryptedChats: any[] = [];
  for (const row of chatRows || []) {
    const entry = byDepartment.get(Number(row.department_id));
    const lastByCustomer =
      row.customer_user_id && row.last_message_user_id
        ? String(row.last_message_user_id) === String(row.customer_user_id)
        : Boolean(row.last_message_user_id);

    if (entry) {
      entry.chats += 1;
      entry.messages += Number(row.message_count || 0);
      if (row.last_message_user_id && lastByCustomer) entry.open += 1;
    }

    decryptedChats.push({
      id: row.id,
      departmentId: row.department_id ? Number(row.department_id) : null,
      departmentName: row.department_name || null,
      customerUsername: row.customer_username || null,
      customerNickname: row.customer_nickname || null,
      operatorUsername: row.operator_username || null,
      operatorNickname: row.operator_nickname || null,
      lastMessageBody:
        storageEncryption.decryptText(row.last_message_body || "") || "",
      lastMessageAt: row.last_message_at || null,
      lastMessageByCustomer: lastByCustomer,
      createdAt: row.created_at,
      messageCount: Number(row.message_count || 0),
    });
  }

  return {
    departments: Array.from(byDepartment.values()),
    chats: decryptedChats,
  };
}

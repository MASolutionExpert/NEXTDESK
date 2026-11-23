import { prisma, pgGetAll, pgGetRow, pgRun, withPgTransaction } from "./prisma.ts";
import { setUserColor } from "../settings/colors.ts";
import { generateUuid } from "../lib/uuidUtils.ts";
import { storageEncryption } from "../lib/storageEncryption.ts";

export function decryptMessageRow<T extends Record<string, any> | null>(row: T): T {
  if (!row) return row;
  const next: Record<string, any> = { ...row };
  if (typeof next.edited_body === "string") {
    next.edited_body = storageEncryption.decryptText(next.edited_body);
  }
  if (typeof next.body === "string") {
    next.body = storageEncryption.decryptText(next.body);
  }
  if (typeof next.last_message === "string") {
    next.last_message = storageEncryption.decryptText(next.last_message);
  }
  if (typeof next.reply_body === "string") {
    next.reply_body = storageEncryption.decryptText(next.reply_body);
  }
  return next as T;
}

export async function findDmChat(
  userId: string,
  otherUserId: string,
  options: { channel?: "direct" | "support" | null; departmentId?: number | string | null } = {},
) {
  if (!userId || !otherUserId || userId === otherUserId) return null;
  const clauses = [
    "c.type = 'dm'",
    "(SELECT COUNT(*) FROM chat_members m3 WHERE m3.chat_id = c.id) = 2",
  ];
  const params: any[] = [String(userId), String(otherUserId)];
  const channel = options?.channel ? String(options.channel).toLowerCase() : null;
  if (channel === "direct") {
    clauses.push("COALESCE(c.channel, 'direct') = 'direct'");
  } else if (channel === "support") {
    clauses.push("COALESCE(c.channel, 'direct') = 'support'");
  }
  if (options?.departmentId !== undefined && options?.departmentId !== null) {
    params.push(Number(options.departmentId));
    clauses.push(`c.department_id = $${params.length}`);
  }
  const row = await pgGetRow<{ id: string }>(
    `SELECT c.id
     FROM chats c
     JOIN chat_members m1 ON m1.chat_id = c.id AND m1.user_id = $1
     JOIN chat_members m2 ON m2.chat_id = c.id AND m2.user_id = $2
     WHERE ${clauses.join(" AND ")}
     ORDER BY c.created_at DESC, c.id ASC
     LIMIT 1`,
    params,
  );
  return row?.id || null;
}

export async function createChat(
  name: string | null,
  type = "dm",
  options: any = {},
): Promise<string> {
  const id = generateUuid();
  const normalizedType = String(type || "dm");
  const normalizedName =
    normalizedType === "dm"
      ? String(name || "").trim() || "dm"
      : String(name || "").trim() || null;
  const groupUsername =
    normalizedType === "group" || normalizedType === "channel"
      ? String(options.groupUsername || "").trim().toLowerCase() || null
      : null;
  const groupVisibility =
    normalizedType === "saved"
      ? "private"
      : (normalizedType === "group" || normalizedType === "channel") &&
          String(options.groupVisibility || "").toLowerCase() === "private"
        ? "private"
        : "public";
  const inviteToken =
    normalizedType === "group" || normalizedType === "channel"
      ? String(options.inviteToken || "").trim() || null
      : null;
  const createdByUserId = options.createdByUserId || null;
  const groupColor =
    normalizedType === "group" || normalizedType === "channel"
      ? String(options.groupColor || "").trim() || setUserColor()
      : null;
  const allowMemberInvites =
    (normalizedType === "group" || normalizedType === "channel") &&
    options.allowMemberInvites === false
      ? 0
      : 1;
  const groupAvatarUrl =
    normalizedType === "group" || normalizedType === "channel"
      ? String(options.groupAvatarUrl || "").trim() || null
      : null;
  const verified = options.verified ? 1 : 0;
  const autoAddNewUsers =
    groupVisibility === "private"
      ? 0
      : options.auto_add_new_users || options.autoAddNewUsers
        ? 1
        : 0;
  const createdAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  const normalizedChannel =
    String(options.channel || "").toLowerCase() === "support"
      ? "support"
      : "direct";
  const departmentId =
    options.departmentId !== undefined && options.departmentId !== null
      ? Number(options.departmentId)
      : null;

  await prisma.chat.create({
    data: {
      id,
      name: normalizedName,
      type: normalizedType,
      groupUsername,
      groupVisibility,
      inviteToken,
      createdByUserId,
      groupColor,
      allowMemberInvites,
      groupAvatarUrl,
      verified,
      autoAddNewUsers,
      channel: normalizedChannel,
      departmentId,
      createdAt,
    },
  });
  return id;
}

export async function addChatMember(
  chatId: string,
  userId: string,
  role = "member",
) {
  return pgRun(
    `INSERT INTO chat_members (chat_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (chat_id, user_id) DO NOTHING`,
    [String(chatId), String(userId), String(role || "member")],
  );
}

export async function addAllEligibleChatMembers(chatId: string) {
  const leftMessagePattern = "[[system:left:%";
  const [addedUsers, skippedLeftRow] = await Promise.all([
    pgGetAll<{ id: string; username: string; nickname: string | null }>(
      `SELECT u.id, u.username, u.nickname
       FROM users u
       WHERE NOT EXISTS (
         SELECT 1 FROM chat_members cm WHERE cm.chat_id = $1 AND cm.user_id = u.id
       )
         AND NOT EXISTS (
           SELECT 1 FROM chat_left_members clm WHERE clm.chat_id = $1 AND clm.user_id = u.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM chat_messages msg
           WHERE msg.chat_id = $1 AND msg.user_id = u.id AND msg.body LIKE $2
         )
       ORDER BY u.id ASC`,
      [String(chatId), leftMessagePattern],
    ),
    pgGetRow<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM users u
       WHERE NOT EXISTS (
         SELECT 1 FROM chat_members cm WHERE cm.chat_id = $1 AND cm.user_id = u.id
       )
         AND (
           EXISTS (
             SELECT 1 FROM chat_left_members clm WHERE clm.chat_id = $1 AND clm.user_id = u.id
           )
           OR EXISTS (
             SELECT 1 FROM chat_messages msg
             WHERE msg.chat_id = $1 AND msg.user_id = u.id AND msg.body LIKE $2
           )
         )`,
      [String(chatId), leftMessagePattern],
    ),
  ]);

  const users = addedUsers || [];
  if (users.length > 0) {
    await prisma.chatMember.createMany({
      data: users.map((u) => ({
        chatId: String(chatId),
        userId: String(u.id),
        role: "member",
      })),
      skipDuplicates: true,
    });
  }

  return {
    addedUsers: users,
    skippedLeftCount: Number(skippedLeftRow?.count || 0),
  };
}

function normalizePublicSearchTerm(query: string): string {
  return String(query || "").trim().replace(/^@+/, "").trim();
}

function escapePublicLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function searchPublicGroups(
  query: string,
  viewerUserId: string,
  limit = 20,
) {
  const cleaned = normalizePublicSearchTerm(query);
  if (!cleaned) return [];
  const like = `%${escapePublicLike(cleaned.toLowerCase())}%`;
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  return pgGetAll(
    `SELECT c.id, c.name, c.group_username, c.group_color, c.group_avatar_url,
            c.invite_token, c.verified,
            (SELECT COUNT(*) FROM chat_members m WHERE m.chat_id = c.id) AS members_count,
            EXISTS(SELECT 1 FROM chat_members vm WHERE vm.chat_id = c.id AND vm.user_id = $1) AS is_member
     FROM chats c
     WHERE c.type = 'group'
       AND (
         c.group_visibility = 'public'
         OR EXISTS(SELECT 1 FROM chat_members vm WHERE vm.chat_id = c.id AND vm.user_id = $1)
       )
       AND (LOWER(COALESCE(c.name, '')) LIKE $2 ESCAPE '\' OR LOWER(COALESCE(c.group_username, '')) LIKE $2 ESCAPE '\')
     ORDER BY CASE WHEN LOWER(COALESCE(c.group_username, '')) LIKE $2 ESCAPE '\' THEN 0 ELSE 1 END, c.name ASC
     LIMIT $3`,
    [String(viewerUserId || ""), like, safeLimit],
  );
}

export async function searchPublicChannels(
  query: string,
  viewerUserId: string,
  limit = 20,
) {
  const cleaned = normalizePublicSearchTerm(query);
  if (!cleaned) return [];
  const like = `%${escapePublicLike(cleaned.toLowerCase())}%`;
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  return pgGetAll(
    `SELECT c.id, c.name, c.group_username, c.group_color, c.group_avatar_url,
            c.invite_token, c.verified,
            (SELECT COUNT(*) FROM chat_members m WHERE m.chat_id = c.id) AS members_count,
            EXISTS(SELECT 1 FROM chat_members vm WHERE vm.chat_id = c.id AND vm.user_id = $1) AS is_member
     FROM chats c
     WHERE c.type = 'channel'
       AND (
         c.group_visibility = 'public'
         OR EXISTS(SELECT 1 FROM chat_members vm WHERE vm.chat_id = c.id AND vm.user_id = $1)
       )
       AND (LOWER(COALESCE(c.name, '')) LIKE $2 ESCAPE '\' OR LOWER(COALESCE(c.group_username, '')) LIKE $2 ESCAPE '\')
     ORDER BY CASE WHEN LOWER(COALESCE(c.group_username, '')) LIKE $2 ESCAPE '\' THEN 0 ELSE 1 END, c.name ASC
     LIMIT $3`,
    [String(viewerUserId || ""), like, safeLimit],
  );
}

export async function removeChatMember(chatId: string, userId: string) {
  const res = await prisma.chatMember.deleteMany({
    where: { chatId: String(chatId), userId: String(userId) },
  });
  return res.count;
}

export async function markChatMemberLeft(chatId: string, userId: string) {
  return pgRun(
    `INSERT INTO chat_left_members (chat_id, user_id, left_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP::text)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET left_at = CURRENT_TIMESTAMP::text`,
    [String(chatId), String(userId)],
  );
}

export async function clearChatMemberLeft(chatId: string, userId: string) {
  const res = await prisma.chatLeftMember.deleteMany({
    where: { chatId: String(chatId), userId: String(userId) },
  });
  return res.count;
}

export async function hasChatMemberLeft(
  chatId: string,
  userId: string,
): Promise<boolean> {
  if (!chatId || !userId) return false;
  const row = await prisma.chatLeftMember.findUnique({
    where: {
      chatId_userId: { chatId: String(chatId), userId: String(userId) },
    },
    select: { chatId: true },
  });
  return Boolean(row);
}

export async function markGroupMemberRemoved(
  chatId: string,
  userId: string,
  removedByUserId: string,
) {
  return pgRun(
    `INSERT INTO group_removed_members (chat_id, user_id, removed_by_user_id, removed_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP::text)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET
       removed_by_user_id = EXCLUDED.removed_by_user_id,
       removed_at = CURRENT_TIMESTAMP::text`,
    [String(chatId), String(userId), String(removedByUserId)],
  );
}

export async function clearGroupMemberRemoved(chatId: string, userId: string) {
  const res = await prisma.groupRemovedMember.deleteMany({
    where: { chatId: String(chatId), userId: String(userId) },
  });
  return res.count;
}

export async function isGroupMemberRemoved(
  chatId: string,
  userId: string,
): Promise<boolean> {
  if (!chatId || !userId) return false;
  const row = await prisma.groupRemovedMember.findUnique({
    where: {
      chatId_userId: { chatId: String(chatId), userId: String(userId) },
    },
    select: { chatId: true },
  });
  return Boolean(row);
}

export async function findChatByGroupUsername(groupUsername: string) {
  const normalized = String(groupUsername || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (!normalized) return null;
  return pgGetRow(
    `SELECT id, name, type, group_username, group_visibility, invite_token,
            group_color, allow_member_invites, group_avatar_url,
            created_by_user_id, verified, auto_add_new_users
     FROM chats
     WHERE LOWER(group_username) IN ($1, $2)
     LIMIT 1`,
    [normalized, `@${normalized}`],
  );
}

export async function findChatByInviteToken(inviteToken: string) {
  const normalized = String(inviteToken || "").trim();
  if (!normalized) return null;
  return pgGetRow(
    `SELECT id, name, type, group_username, group_visibility, invite_token,
            group_color, allow_member_invites, group_avatar_url,
            created_by_user_id, verified, auto_add_new_users
     FROM chats
     WHERE invite_token = $1
     LIMIT 1`,
    [normalized],
  );
}

export async function findChatById(chatId: string) {
  if (!chatId) return null;
  return pgGetRow(
    `SELECT id, name, type, group_username, group_visibility, invite_token,
            group_color, allow_member_invites, group_avatar_url,
            created_by_user_id, verified, auto_add_new_users,
            COALESCE(channel, 'direct') AS channel, department_id
     FROM chats
     WHERE id = $1
     LIMIT 1`,
    [String(chatId)],
  );
}

export async function updateGroupChat(chatId: string, payload: any = {}) {
  const name = String(payload?.name || "").trim() || null;
  const groupUsername =
    String(payload?.groupUsername || "").trim().toLowerCase() || null;
  const groupVisibility =
    String(payload?.groupVisibility || "").toLowerCase() === "private"
      ? "private"
      : "public";
  const allowMemberInvites = payload?.allowMemberInvites === false ? 0 : 1;
  const hasGroupAvatarUrl = Object.prototype.hasOwnProperty.call(
    payload || {},
    "groupAvatarUrl",
  );
  const groupAvatarUrl = !hasGroupAvatarUrl
    ? undefined
    : String(payload?.groupAvatarUrl || "").trim() || null;

  const data: Record<string, any> = {
    name,
    groupUsername,
    groupVisibility,
    allowMemberInvites,
  };
  if (hasGroupAvatarUrl) data.groupAvatarUrl = groupAvatarUrl;
  if (
    payload.auto_add_new_users !== undefined ||
    payload.autoAddNewUsers !== undefined
  ) {
    data.autoAddNewUsers =
      payload.auto_add_new_users || payload.autoAddNewUsers ? 1 : 0;
  }
  if (groupVisibility === "private") data.autoAddNewUsers = 0;

  const res = await prisma.chat.updateMany({
    where: { id: String(chatId), type: "group" },
    data,
  });
  return res.count;
}

export async function updateChannelChat(chatId: string, payload: any = {}) {
  const name = String(payload?.name || "").trim() || null;
  const groupUsername =
    String(payload?.groupUsername || "").trim().toLowerCase() || null;
  const groupVisibility =
    String(payload?.groupVisibility || "").toLowerCase() === "private"
      ? "private"
      : "public";
  const allowMemberInvites = payload?.allowMemberInvites === false ? 0 : 1;
  const hasGroupAvatarUrl = Object.prototype.hasOwnProperty.call(
    payload || {},
    "groupAvatarUrl",
  );
  const groupAvatarUrl = !hasGroupAvatarUrl
    ? undefined
    : String(payload?.groupAvatarUrl || "").trim() || null;

  const data: Record<string, any> = {
    name,
    groupUsername,
    groupVisibility,
    allowMemberInvites,
  };
  if (hasGroupAvatarUrl) data.groupAvatarUrl = groupAvatarUrl;
  if (
    payload.auto_add_new_users !== undefined ||
    payload.autoAddNewUsers !== undefined
  ) {
    data.autoAddNewUsers =
      payload.auto_add_new_users || payload.autoAddNewUsers ? 1 : 0;
  }
  if (groupVisibility === "private") data.autoAddNewUsers = 0;

  const res = await prisma.chat.updateMany({
    where: { id: String(chatId), type: "channel" },
    data,
  });
  return res.count;
}

export async function updateChat(id: string, updates: any = {}) {
  const data: Record<string, any> = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.type !== undefined) data.type = updates.type;
  if (updates.group_username !== undefined) data.groupUsername = updates.group_username;
  if (updates.groupUsername !== undefined) data.groupUsername = updates.groupUsername;
  if (updates.visibility !== undefined) data.groupVisibility = updates.visibility;
  if (updates.group_visibility !== undefined) data.groupVisibility = updates.group_visibility;
  if (updates.groupVisibility !== undefined) data.groupVisibility = updates.groupVisibility;
  if (updates.invite_token !== undefined) data.inviteToken = updates.invite_token;
  if (updates.group_color !== undefined) data.groupColor = updates.group_color;
  if (updates.allow_member_invites !== undefined) data.allowMemberInvites = updates.allow_member_invites;
  if (updates.group_avatar_url !== undefined) data.groupAvatarUrl = updates.group_avatar_url;
  if (updates.verified !== undefined) data.verified = updates.verified ? 1 : 0;
  if (updates.autoAddNewUsers !== undefined) data.autoAddNewUsers = updates.autoAddNewUsers ? 1 : 0;
  if (updates.auto_add_new_users !== undefined) data.autoAddNewUsers = updates.auto_add_new_users ? 1 : 0;
  if (updates.department_id !== undefined) data.departmentId = updates.department_id;
  if (data.groupVisibility === "private") data.autoAddNewUsers = 0;

  if (!Object.keys(data).length) return 0;
  const res = await prisma.chat.updateMany({
    where: { id: String(id) },
    data,
  });
  return res.count;
}

export async function getAutoAddPublicChatIds(): Promise<string[]> {
  const rows = await prisma.chat.findMany({
    where: {
      type: { in: ["group", "channel"] },
      groupVisibility: "public",
      autoAddNewUsers: 1,
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function bulkAddMemberToChats(userId: string, chatIds: string[]) {
  if (!chatIds || chatIds.length === 0) return [];
  await prisma.chatMember.createMany({
    data: chatIds.map((chatId) => ({
      chatId: String(chatId),
      userId: String(userId),
      role: "member",
    })),
    skipDuplicates: true,
  });
  return chatIds;
}

export async function regenerateGroupInviteToken(
  chatId: string,
  inviteToken: string,
) {
  const res = await prisma.chat.updateMany({
    where: { id: String(chatId), type: { in: ["group", "channel"] } },
    data: { inviteToken: String(inviteToken || "").trim() },
  });
  return res.count;
}

export async function isMember(chatId: string, userId: string): Promise<boolean> {
  if (!chatId || !userId) return false;
  const row = await prisma.chatMember.findUnique({
    where: {
      chatId_userId: { chatId: String(chatId), userId: String(userId) },
    },
    select: { chatId: true },
  });
  return Boolean(row);
}

export async function listChatMembers(chatId: string) {
  return pgGetAll(
    `SELECT users.id, users.username, users.nickname, users.avatar_url, users.color,
            users.verified AS user_verified,
            users.role AS user_role,
            users.status AS status,
            chat_members.role
     FROM chat_members
     JOIN users ON users.id = chat_members.user_id
     WHERE chat_members.chat_id = $1
     ORDER BY users.username ASC`,
    [String(chatId)],
  );
}

export async function listChatMembersForChats(chatIds: string[] = []) {
  const ids = (Array.isArray(chatIds) ? chatIds : []).filter(Boolean).map(String);
  const map = new Map<string, any[]>();
  if (!ids.length) return map;

  const rows = await pgGetAll(
    `SELECT chat_members.chat_id,
            users.id, users.username, users.nickname, users.avatar_url, users.color,
            users.verified AS user_verified,
            users.role AS user_role,
            users.status AS status,
            chat_members.role
     FROM chat_members
     JOIN users ON users.id = chat_members.user_id
     WHERE chat_members.chat_id = ANY($1::text[])
     ORDER BY chat_members.chat_id ASC, users.username ASC`,
    [ids],
  );

  for (const row of rows || []) {
    const cid = String(row.chat_id);
    if (!map.has(cid)) map.set(cid, []);
    map.get(cid)!.push(row);
    const lowerCid = cid.toLowerCase();
    if (lowerCid !== cid) {
      if (!map.has(lowerCid)) map.set(lowerCid, []);
      map.get(lowerCid)!.push(row);
    }
  }
  return map;
}

export async function getChatMemberRole(
  chatId: string,
  userId: string,
): Promise<string> {
  if (!chatId || !userId) return "";
  const row = await prisma.chatMember.findUnique({
    where: {
      chatId_userId: { chatId: String(chatId), userId: String(userId) },
    },
    select: { role: true },
  });
  return String(row?.role || "");
}

export async function setChatMemberRole(
  chatId: string,
  userId: string,
  role = "member",
) {
  const res = await prisma.chatMember.updateMany({
    where: { chatId: String(chatId), userId: String(userId) },
    data: { role: String(role || "member") },
  });
  return res.count;
}

export async function deleteChatById(chatId: string) {
  if (!chatId) return { storedNames: [] as string[] };
  return withPgTransaction(async (tx) => {
    const fileRows = await tx.getAll<{ stored_name: string }>(
      `SELECT cmf.stored_name
       FROM chat_message_files cmf
       JOIN chat_messages cm ON cm.id = cmf.message_id
       WHERE cm.chat_id = $1`,
      [String(chatId)],
    );
    const storedNames = fileRows
      .map((row) => String(row?.stored_name || "").trim())
      .filter(Boolean);

    await tx.run(
      `DELETE FROM chat_message_reads WHERE message_id IN (SELECT id FROM chat_messages WHERE chat_id = $1)`,
      [String(chatId)],
    );
    await tx.run(
      `DELETE FROM hidden_chat_messages WHERE message_id IN (SELECT id FROM chat_messages WHERE chat_id = $1)`,
      [String(chatId)],
    );
    await tx.run(
      `DELETE FROM chat_message_files WHERE message_id IN (SELECT id FROM chat_messages WHERE chat_id = $1)`,
      [String(chatId)],
    );
    await tx.run(
      `DELETE FROM remote_channel_queue WHERE source_id IN (SELECT id FROM remote_channel_sources WHERE chat_id = $1)`,
      [String(chatId)],
    );
    await tx.run(`DELETE FROM remote_channel_sources WHERE chat_id = $1`, [String(chatId)]);
    await tx.run(`DELETE FROM chat_messages WHERE chat_id = $1`, [String(chatId)]);
    await tx.run(`DELETE FROM chat_members WHERE chat_id = $1`, [String(chatId)]);
    await tx.run(`DELETE FROM chat_mutes WHERE chat_id = $1`, [String(chatId)]);
    await tx.run(`DELETE FROM chat_left_members WHERE chat_id = $1`, [String(chatId)]);
    await tx.run(`DELETE FROM group_removed_members WHERE chat_id = $1`, [String(chatId)]);
    await tx.run(`DELETE FROM hidden_chats WHERE chat_id = $1`, [String(chatId)]);
    await tx.run(`DELETE FROM chats WHERE id = $1`, [String(chatId)]);

    return { storedNames };
  });
}

export async function deleteUserById(userId: string) {
  if (!userId) {
    return {
      storedNames: [] as string[],
      deletedChatIds: [] as string[],
      transferredChatIds: [] as string[],
    };
  }
  const uid = String(userId);

  return withPgTransaction(async (tx) => {
    const dmChats = await tx.getAll<{ id: string }>(
      `SELECT c.id
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       WHERE cm.user_id = $1 AND c.type IN ('dm', 'saved')`,
      [uid],
    );
    const ownedGroupChats = await tx.getAll<{ id: string }>(
      `SELECT c.id
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       WHERE cm.user_id = $1
         AND cm.role = 'owner'
         AND c.type IN ('group', 'channel')`,
      [uid],
    );

    const uniqueChatDeletesSet = new Set<string>(dmChats.map((r) => r.id));
    const ownershipTransfers: Array<{ chatId: string; nextOwnerId: string }> = [];

    for (const chat of ownedGroupChats) {
      const otherMember = await tx.getRow<{ user_id: string }>(
        `SELECT user_id
         FROM chat_members
         WHERE chat_id = $1 AND user_id != $2
         ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, user_id ASC
         LIMIT 1`,
        [chat.id, uid],
      );
      if (otherMember?.user_id) {
        ownershipTransfers.push({
          chatId: chat.id,
          nextOwnerId: otherMember.user_id,
        });
      } else {
        uniqueChatDeletesSet.add(chat.id);
      }
    }

    const uniqueChatDeletes = Array.from(uniqueChatDeletesSet);
    const storedNames = new Set<string>();

    if (uniqueChatDeletes.length) {
      const chatFileRows = await tx.getAll<{ stored_name: string }>(
        `SELECT cmf.stored_name
         FROM chat_message_files cmf
         JOIN chat_messages cm ON cm.id = cmf.message_id
         WHERE cm.chat_id = ANY($1::text[])`,
        [uniqueChatDeletes],
      );
      for (const row of chatFileRows) {
        const name = String(row?.stored_name || "").trim();
        if (name) storedNames.add(name);
      }
    }

    for (const chatId of uniqueChatDeletes) {
      await tx.run(
        `DELETE FROM chat_message_reads WHERE message_id IN (SELECT id FROM chat_messages WHERE chat_id = $1)`,
        [chatId],
      );
      await tx.run(
        `DELETE FROM hidden_chat_messages WHERE message_id IN (SELECT id FROM chat_messages WHERE chat_id = $1)`,
        [chatId],
      );
      await tx.run(
        `DELETE FROM chat_message_files WHERE message_id IN (SELECT id FROM chat_messages WHERE chat_id = $1)`,
        [chatId],
      );
      await tx.run(
        `DELETE FROM remote_channel_queue WHERE source_id IN (SELECT id FROM remote_channel_sources WHERE chat_id = $1)`,
        [chatId],
      );
      await tx.run(`DELETE FROM remote_channel_sources WHERE chat_id = $1`, [chatId]);
      await tx.run(`DELETE FROM chat_messages WHERE chat_id = $1`, [chatId]);
      await tx.run(`DELETE FROM chat_members WHERE chat_id = $1`, [chatId]);
      await tx.run(`DELETE FROM chat_mutes WHERE chat_id = $1`, [chatId]);
      await tx.run(`DELETE FROM chat_left_members WHERE chat_id = $1`, [chatId]);
      await tx.run(`DELETE FROM group_removed_members WHERE chat_id = $1`, [chatId]);
      await tx.run(`DELETE FROM hidden_chats WHERE chat_id = $1`, [chatId]);
      await tx.run(`DELETE FROM chats WHERE id = $1`, [chatId]);
    }

    for (const transfer of ownershipTransfers) {
      if (uniqueChatDeletesSet.has(transfer.chatId)) continue;
      await tx.run(
        `UPDATE chat_members SET role = 'owner' WHERE chat_id = $1 AND user_id = $2`,
        [transfer.chatId, transfer.nextOwnerId],
      );
    }

    // Reassign or delete remaining messages authored by this user in surviving group chats
    // so FK chat_messages_user_id_fkey never blocks user deletion.
    const userMsgFiles = await tx.getAll<{ stored_name: string }>(
      `SELECT cmf.stored_name
       FROM chat_message_files cmf
       JOIN chat_messages cm ON cm.id = cmf.message_id
       WHERE cm.user_id = $1`,
      [uid],
    );
    for (const row of userMsgFiles) {
      const name = String(row?.stored_name || "").trim();
      if (name) storedNames.add(name);
    }

    await tx.run(
      `DELETE FROM chat_message_reads WHERE message_id IN (SELECT id FROM chat_messages WHERE user_id = $1)`,
      [uid],
    );
    await tx.run(
      `DELETE FROM hidden_chat_messages WHERE message_id IN (SELECT id FROM chat_messages WHERE user_id = $1)`,
      [uid],
    );
    await tx.run(
      `DELETE FROM chat_message_files WHERE message_id IN (SELECT id FROM chat_messages WHERE user_id = $1)`,
      [uid],
    );
    await tx.run(`DELETE FROM chat_messages WHERE user_id = $1`, [uid]);

    await tx.run(`DELETE FROM sessions WHERE user_id = $1`, [uid]);
    await tx.run(`DELETE FROM hidden_chats WHERE user_id = $1`, [uid]);
    await tx.run(`DELETE FROM hidden_chat_messages WHERE user_id = $1`, [uid]);
    await tx.run(`DELETE FROM chat_message_reads WHERE user_id = $1`, [uid]);
    await tx.run(`DELETE FROM push_subscriptions WHERE user_id = $1`, [uid]);
    await tx.run(`DELETE FROM chat_mutes WHERE user_id = $1`, [uid]);
    await tx.run(
      `DELETE FROM group_removed_members WHERE user_id = $1 OR removed_by_user_id = $1`,
      [uid],
    );
    await tx.run(
      `UPDATE chat_messages SET read_by_user_id = NULL WHERE read_by_user_id = $1`,
      [uid],
    );
    await tx.run(`DELETE FROM chat_left_members WHERE user_id = $1`, [uid]);
    await tx.run(`DELETE FROM chat_members WHERE user_id = $1`, [uid]);
    await tx.run(`DELETE FROM users WHERE id = $1`, [uid]);

    return {
      storedNames: Array.from(storedNames),
      deletedChatIds: uniqueChatDeletes,
      transferredChatIds: ownershipTransfers.map((t) => t.chatId),
    };
  });
}

export async function listChatsForUser(userId: string) {
  if (!userId) return [];
  const uid = String(userId);

  const rows = await pgGetAll(
    `WITH member_chats AS (
       SELECT c.id, c.name, c.type, c.group_username, c.group_visibility,
              c.invite_token, c.group_color, c.allow_member_invites,
              c.group_avatar_url, c.created_by_user_id, c.created_at, c.verified,
              COALESCE(c.channel, 'direct') AS channel,
              c.department_id,
              COALESCE(mu.muted, 0) AS muted
       FROM chats c
       JOIN chat_members m ON m.chat_id = c.id AND m.user_id = $1
       LEFT JOIN chat_mutes mu ON mu.chat_id = c.id AND mu.user_id = m.user_id
       LEFT JOIN hidden_chats h ON h.chat_id = c.id AND h.user_id = m.user_id
       WHERE h.chat_id IS NULL
     )
     SELECT mc.id, mc.name, mc.type, mc.group_username, mc.group_visibility,
            mc.invite_token, mc.group_color, mc.allow_member_invites,
            mc.group_avatar_url, mc.created_by_user_id, mc.verified, mc.muted,
            mc.channel, mc.department_id, d.name AS department_name,
            COALESCE(rcs.enabled, 0) AS remote_channel_enabled,
            last_vm.id AS last_message_id,
            COALESCE(last_vm.edited_body, last_vm.body) AS last_message,
            last_vm.created_at AS last_time,
            last_vm.user_id AS last_sender_id,
            last_vm.client_request_id AS last_message_client_request_id,
            CASE WHEN last_vm.id IS NULL THEN NULL ELSE COALESCE(last_user.username, 'deleted') END AS last_sender_username,
            CASE WHEN last_vm.id IS NULL THEN NULL ELSE COALESCE(last_user.nickname, 'Deleted user') END AS last_sender_nickname,
            last_user.avatar_url AS last_sender_avatar_url,
            last_vm.read_at AS last_message_read_at,
            last_vm.read_by_user_id AS last_message_read_by_user_id,
            outgoing_vm.created_at AS last_outgoing_time,
            COALESCE((
              SELECT COUNT(*)
              FROM chat_messages unread_cm
              WHERE unread_cm.chat_id = mc.id
                AND unread_cm.body NOT LIKE '[[system:%]]'
                AND unread_cm.hidden_everyone_at IS NULL
                AND (
                  unread_cm.user_id != $1
                  OR LOWER(COALESCE(unread_cm.client_request_id, '')) LIKE 'remote:%'
                )
                AND NOT EXISTS (
                  SELECT 1 FROM chat_message_reads cmr
                  WHERE cmr.user_id = $1 AND cmr.message_id = unread_cm.id
                )
                AND NOT EXISTS (
                  SELECT 1 FROM hidden_chat_messages unread_hcm
                  WHERE unread_hcm.user_id = $1 AND unread_hcm.message_id = unread_cm.id
                )
            ), 0) AS unread_count
     FROM member_chats mc
     LEFT JOIN LATERAL (
       SELECT last_cm.*
       FROM chat_messages last_cm
       WHERE last_cm.chat_id = mc.id
         AND last_cm.body NOT LIKE '[[system:%]]'
         AND last_cm.hidden_everyone_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM hidden_chat_messages last_hcm
           WHERE last_hcm.user_id = $1 AND last_hcm.message_id = last_cm.id
         )
       ORDER BY last_cm.created_at DESC, last_cm.id DESC
       LIMIT 1
     ) last_vm ON TRUE
     LEFT JOIN users last_user ON last_user.id = last_vm.user_id
     LEFT JOIN LATERAL (
       SELECT outgoing_cm.created_at
       FROM chat_messages outgoing_cm
       WHERE outgoing_cm.chat_id = mc.id
         AND outgoing_cm.user_id = $1
         AND NOT (LOWER(COALESCE(outgoing_cm.client_request_id, '')) LIKE 'remote:%')
         AND outgoing_cm.body NOT LIKE '[[system:%]]'
         AND outgoing_cm.hidden_everyone_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM hidden_chat_messages outgoing_hcm
           WHERE outgoing_hcm.user_id = $1 AND outgoing_hcm.message_id = outgoing_cm.id
         )
       ORDER BY outgoing_cm.created_at DESC, outgoing_cm.id DESC
       LIMIT 1
     ) outgoing_vm ON TRUE
     LEFT JOIN departments d ON d.id = mc.department_id
     LEFT JOIN remote_channel_sources rcs ON rcs.chat_id = mc.id AND rcs.enabled = 1
     ORDER BY last_vm.created_at DESC NULLS LAST, last_vm.id DESC NULLS LAST, mc.created_at DESC`,
    [uid],
  );
  return (rows || []).map(decryptMessageRow);
}

export async function listCallHistoryForUser(userId: string, limit = 200) {
  if (!userId) return [];
  const safeLimit = Math.max(1, Number(limit) || 200);
  const rows = await pgGetAll(
    `SELECT cm.id, cm.chat_id, cm.user_id, cm.client_request_id, cm.body, cm.created_at,
            peer_user.id AS peer_id,
            peer_user.username AS peer_username,
            peer_user.nickname AS peer_nickname,
            peer_user.avatar_url AS peer_avatar_url,
            peer_user.color AS peer_color,
            peer_user.verified AS peer_verified,
            peer_user.role AS peer_role,
            peer_user.status AS peer_status
     FROM chat_messages cm
     JOIN chats c ON c.id = cm.chat_id
     JOIN chat_members me ON me.chat_id = cm.chat_id AND me.user_id = $1
     JOIN chat_members peer ON peer.chat_id = cm.chat_id AND peer.user_id != $1
     LEFT JOIN users peer_user ON peer_user.id = peer.user_id
     WHERE c.type = 'dm'
       AND cm.body LIKE '[[call:%]]'
       AND cm.hidden_everyone_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM hidden_chat_messages hcm
         WHERE hcm.user_id = $1 AND hcm.message_id = cm.id
       )
     ORDER BY cm.created_at DESC, cm.id DESC
     LIMIT $2`,
    [String(userId), safeLimit],
  );
  return (rows || []).map(decryptMessageRow);
}

export async function findSavedChatByUserId(userId: string) {
  if (!userId) return null;
  return pgGetRow(
    `SELECT id, name, type, group_username, group_visibility, invite_token,
            group_color, allow_member_invites, group_avatar_url, created_by_user_id
     FROM chats
     WHERE type = 'saved' AND created_by_user_id = $1
     LIMIT 1`,
    [String(userId)],
  );
}

export async function ensureSavedChatForUser(userId: string) {
  if (!userId) return null;
  const existing = await findSavedChatByUserId(userId);
  if (existing?.id) {
    await addChatMember(existing.id, userId, "owner");
    await unhideChat(userId, existing.id);
    return existing;
  }
  const chatId = await createChat("Saved Messages", "saved", {
    createdByUserId: userId,
    groupVisibility: "private",
    allowMemberInvites: false,
  });
  await addChatMember(chatId, userId, "owner");
  return findChatById(chatId);
}

export async function hideChatsForUser(userId: string, chatIds: string[] = []) {
  if (!userId || !Array.isArray(chatIds) || !chatIds.length) return;
  const validChatIds = chatIds.filter(Boolean).map(String);
  if (!validChatIds.length) return;
  await prisma.hiddenChat.createMany({
    data: validChatIds.map((chatId) => ({
      userId: String(userId),
      chatId,
      hiddenAt: new Date().toISOString(),
    })),
    skipDuplicates: true,
  });
}

export async function unhideChat(userId: string, chatId: string) {
  if (!userId || !chatId) return 0;
  const res = await prisma.hiddenChat.deleteMany({
    where: { userId: String(userId), chatId: String(chatId) },
  });
  return res.count;
}

export async function setChatMuted(
  userId: string,
  chatId: string,
  muted: boolean | number,
) {
  if (!userId || !chatId) return 0;
  if (muted) {
    return pgRun(
      `INSERT INTO chat_mutes (user_id, chat_id, muted, updated_at)
       VALUES ($1, $2, 1, CURRENT_TIMESTAMP::text)
       ON CONFLICT (user_id, chat_id) DO UPDATE SET
         muted = 1,
         updated_at = CURRENT_TIMESTAMP::text`,
      [String(userId), String(chatId)],
    );
  }
  const res = await prisma.chatMute.deleteMany({
    where: { userId: String(userId), chatId: String(chatId) },
  });
  return res.count;
}

export async function listMutedUserIdsForChat(chatId: string): Promise<string[]> {
  if (!chatId) return [];
  const rows = await prisma.chatMute.findMany({
    where: { chatId: String(chatId), muted: 1 },
    select: { userId: true },
  });
  return rows.map((r) => r.userId).filter(Boolean);
}

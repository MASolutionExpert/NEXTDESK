import { prisma, pgGetAll, pgGetRow, pgRun } from "./prisma.ts";
import { generateUuid } from "../lib/uuidUtils.ts";
import { storageEncryption } from "../lib/storageEncryption.ts";
import { decryptMessageRow } from "./chatsRepo.ts";

const REMOTE_MESSAGE_CLIENT_REQUEST_SQL =
  "LOWER(COALESCE(client_request_id, '')) LIKE 'remote:%'";

export const isRemoteMessageClientRequestId = (value: unknown): boolean =>
  /^remote:/i.test(String(value || "").trim());

export const isRemoteMessageRow = (row: any): boolean =>
  isRemoteMessageClientRequestId(
    row?.client_request_id || row?.clientRequestId,
  );

function normalizeDbTimestamp(value: unknown): string {
  const str = String(value || "").trim();
  if (!str) return "";
  if (str.includes("T")) {
    const d = new Date(str);
    if (Number.isFinite(d.getTime())) {
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      const hours = String(d.getUTCHours()).padStart(2, "0");
      const mins = String(d.getUTCMinutes()).padStart(2, "0");
      const secs = String(d.getUTCSeconds()).padStart(2, "0");
      return `${year}-${month}-${day} ${hours}:${mins}:${secs}`;
    }
    return str.replace("T", " ").replace(/Z$/i, "").trim();
  }
  return str;
}

function getVisibleMessageFilterSql(
  alias = "chat_messages",
  viewerClause = "",
): string {
  const safeAlias = alias || "chat_messages";
  return `${safeAlias}.hidden_everyone_at IS NULL
    AND ${safeAlias}.id NOT IN (
      SELECT hidden_chat_messages.message_id
      FROM hidden_chat_messages
      ${viewerClause}
    )`;
}

export async function createMessage(
  chatId: string,
  userId: string,
  body: string,
  replyToMessageId: string | null = null,
  expiresAt: string | null = null,
  clientRequestId: string | null = null,
  { allowPlaintextSystemMessage = false }: any = {},
): Promise<string> {
  const id = generateUuid();
  const storedBody = storageEncryption.encryptText(body, {
    allowPlaintextSystemMessage,
  });
  const createdAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  await prisma.chatMessage.create({
    data: {
      id,
      chatId: String(chatId),
      userId: String(userId),
      body: storedBody,
      createdAt,
      replyToMessageId: replyToMessageId || null,
      expiresAt: expiresAt || null,
      clientRequestId: clientRequestId || null,
    },
  });
  return id;
}

export async function findMessageIdByClientRequestId(
  chatId: string,
  userId: string,
  clientRequestId: string,
): Promise<string | null> {
  const normalized = String(clientRequestId || "").trim();
  if (!normalized) return null;
  const row = await pgGetRow<{ id: string }>(
    `SELECT id
     FROM chat_messages
     WHERE chat_id = $1 AND user_id = $2 AND client_request_id = $3
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [String(chatId), String(userId), normalized],
  );
  return row?.id || null;
}

export async function updateCallMessageBody(messageId: string, body: string) {
  if (!messageId || typeof body !== "string") return null;
  await prisma.chatMessage.updateMany({
    where: { id: String(messageId) },
    data: { body },
  });
  return messageId;
}

export async function createOrReuseMessage(
  chatId: string,
  userId: string,
  body: string,
  replyToMessageId: string | null = null,
  expiresAt: string | null = null,
  clientRequestId: string | null = null,
): Promise<{ id: string; deduped: boolean }> {
  const normalizedClientRequestId = String(clientRequestId || "").trim() || null;

  if (normalizedClientRequestId) {
    const existingId = await findMessageIdByClientRequestId(
      chatId,
      userId,
      normalizedClientRequestId,
    );
    if (existingId) {
      return { id: existingId, deduped: true };
    }
  }

  try {
    const id = await createMessage(
      chatId,
      userId,
      body,
      replyToMessageId,
      expiresAt,
      normalizedClientRequestId,
    );
    return { id, deduped: false };
  } catch (error) {
    if (!normalizedClientRequestId) throw error;
    const existingId = await findMessageIdByClientRequestId(
      chatId,
      userId,
      normalizedClientRequestId,
    );
    if (existingId) {
      return { id: existingId, deduped: true };
    }
    throw error;
  }
}

export async function findMessageById(messageId: string) {
  if (!messageId) return null;
  const row = await pgGetRow(
    `SELECT id, chat_id, user_id, body, edited, edited_body, hidden_everyone_at,
            forwarded_from_chat_id, forwarded_from_label, forwarded_from_user_id,
            forwarded_from_username, forwarded_from_avatar_url, forwarded_from_color,
            created_at, expires_at
     FROM chat_messages
     WHERE id = $1
     LIMIT 1`,
    [String(messageId)],
  );
  return decryptMessageRow(row);
}

export async function setMessageExpiresAt(
  messageId: string,
  expiresAt: string | null = null,
) {
  const res = await prisma.chatMessage.updateMany({
    where: { id: String(messageId) },
    data: { expiresAt: expiresAt || null },
  });
  return res.count;
}

export async function editMessage(messageId: string, editedBody: string) {
  const res = await prisma.chatMessage.updateMany({
    where: { id: String(messageId) },
    data: {
      edited: 1,
      editedBody: storageEncryption.encryptText(String(editedBody || "")),
    },
  });
  return res.count;
}

export async function hideMessageForUser(messageId: string, userId: string) {
  return pgRun(
    `INSERT INTO hidden_chat_messages (message_id, user_id, hidden_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP::text)
     ON CONFLICT (user_id, message_id) DO UPDATE SET hidden_at = CURRENT_TIMESTAMP::text`,
    [String(messageId), String(userId)],
  );
}

export async function hideMessageForEveryone(messageId: string) {
  return pgRun(
    `UPDATE chat_messages
     SET hidden_everyone_at = CURRENT_TIMESTAMP::text
     WHERE id = $1`,
    [String(messageId)],
  );
}

export async function setMessageForwardOrigin(
  messageId: string,
  payload: any = {},
) {
  const res = await prisma.chatMessage.updateMany({
    where: { id: String(messageId) },
    data: {
      forwardedFromChatId: payload.sourceChatId || null,
      forwardedFromLabel: String(payload.label || "").trim() || null,
      forwardedFromUserId: payload.sourceUserId || null,
      forwardedFromUsername: String(payload.sourceUsername || "").trim() || null,
      forwardedFromAvatarUrl: String(payload.sourceAvatarUrl || "").trim() || null,
      forwardedFromColor: String(payload.sourceColor || "").trim() || null,
    },
  });
  return res.count;
}

export async function createMessageFiles(
  messageId: string,
  files: any[] = [],
) {
  if (!messageId || !Array.isArray(files) || !files.length) return [];
  const rows = files.map((file) => ({
    messageId: String(messageId),
    kind: String(file.kind || "file"),
    originalName: String(file.originalName || file.original_name || ""),
    storedName: String(file.storedName || file.stored_name || ""),
    mimeType: String(file.mimeType || file.mime_type || "application/octet-stream"),
    sizeBytes: Number(file.sizeBytes || file.size_bytes || 0),
    widthPx: Number.isFinite(Number(file.widthPx ?? file.width_px))
      ? Number(file.widthPx ?? file.width_px)
      : null,
    heightPx: Number.isFinite(Number(file.heightPx ?? file.height_px))
      ? Number(file.heightPx ?? file.height_px)
      : null,
    durationSeconds: Number.isFinite(
      Number(file.durationSeconds ?? file.duration_seconds),
    )
      ? Number(file.durationSeconds ?? file.duration_seconds)
      : null,
    expiresAt: file.expiresAt || file.expires_at || null,
    storageDriver: file.storageDriver || file.storage_driver || "local",
    storageKey: file.storageKey || file.storage_key || null,
    processingStatus: file.processingStatus || file.processing_status || "ready",
    blurhash: file.blurhash || null,
    waveform: file.waveform || null,
    thumbStorageKey: file.thumbStorageKey || file.thumb_storage_key || null,
    encryptionType: file.encryptionType || file.encryption_type || "none",
  }));

  await prisma.chatMessageFile.createMany({ data: rows });
  return rows;
}

export async function recordPendingPresignedUpload({
  storageKey,
  userId = null,
  expiresAt = null,
}: any) {
  if (!storageKey) return null;
  const key = String(storageKey).trim();
  if (!key) return null;
  const nowIso = new Date().toISOString();

  await prisma.pendingPresignedUpload.upsert({
    where: { storageKey: key },
    create: {
      storageKey: key,
      userId: userId || null,
      createdAt: nowIso,
      expiresAt: expiresAt || null,
    },
    update: {
      userId: userId || null,
      createdAt: nowIso,
      expiresAt: expiresAt || null,
    },
  });

  return {
    storage_key: key,
    user_id: userId,
    created_at: nowIso,
    expires_at: expiresAt,
  };
}

export async function removePendingPresignedUploads(storageKeys: any = []) {
  const keys = (Array.isArray(storageKeys) ? storageKeys : [storageKeys])
    .map((k) =>
      typeof k === "string"
        ? k.trim()
        : k?.storageKey || k?.storage_key || k?.key || "",
    )
    .filter(Boolean);
  if (!keys.length) return 0;
  const res = await prisma.pendingPresignedUpload.deleteMany({
    where: { storageKey: { in: keys } },
  });
  return res.count;
}

export async function listPendingPresignedUploads(cutoffIso: string | null = null) {
  if (cutoffIso) {
    return pgGetAll(
      `SELECT storage_key, user_id, created_at, expires_at
       FROM pending_presigned_uploads
       WHERE created_at <= $1`,
      [String(cutoffIso)],
    );
  }
  return pgGetAll(
    `SELECT storage_key, user_id, created_at, expires_at
     FROM pending_presigned_uploads`,
  );
}

export async function rewriteStorageKeys(pairs: any[] = []): Promise<number> {
  const normalized = (Array.isArray(pairs) ? pairs : [])
    .map((entry) => {
      if (Array.isArray(entry)) {
        return {
          from: String(entry[0] || "").trim(),
          to: String(entry[1] || "").trim(),
        };
      }
      return {
        from: String(
          entry?.from || entry?.oldKey || entry?.storageKey || "",
        ).trim(),
        to: String(entry?.to || entry?.newKey || entry?.key || "").trim(),
      };
    })
    .filter((p) => p.from && p.to && p.from !== p.to);

  if (!normalized.length) return 0;
  let total = 0;
  for (const { from, to } of normalized) {
    const [r1, r2, r3] = await Promise.all([
      prisma.chatMessageFile.updateMany({
        where: { storageKey: from },
        data: { storageKey: to },
      }),
      prisma.chatMessageFile.updateMany({
        where: { thumbStorageKey: from },
        data: { thumbStorageKey: to },
      }),
      prisma.pendingPresignedUpload.updateMany({
        where: { storageKey: from },
        data: { storageKey: to },
      }),
    ]);
    total += r1.count + r2.count + r3.count;
  }
  return total;
}

export async function getMessages(chatId: string, options: any = {}) {
  const limitRaw = Number(options.limit || 50);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(10000, limitRaw))
    : 50;
  const beforeIdRaw = String(options.beforeId || "").trim();
  const beforeCreatedAtRaw = normalizeDbTimestamp(options.beforeCreatedAt);
  const afterIdRaw = String(options.afterId || "").trim();
  const afterCreatedAtRaw = normalizeDbTimestamp(options.afterCreatedAt);
  const viewerUserIdRaw = String(options.viewerUserId || "").trim();
  const hasViewerUserId = Boolean(viewerUserIdRaw);
  const hasBefore = Boolean(beforeIdRaw) && Boolean(beforeCreatedAtRaw);
  const hasAfter = Boolean(afterIdRaw) && Boolean(afterCreatedAtRaw);

  const visibilitySql = hasViewerUserId
    ? ` AND ${getVisibleMessageFilterSql(
        "chat_messages",
        "WHERE hidden_chat_messages.user_id = ?",
      )}`
    : ` AND chat_messages.hidden_everyone_at IS NULL`;

  const beforeSql = hasBefore
    ? ` AND (
          chat_messages.created_at < ?
          OR (chat_messages.created_at = ? AND chat_messages.id < ?)
        )`
    : "";

  const afterSql = hasAfter
    ? ` AND (
          chat_messages.created_at > ?
          OR (chat_messages.created_at = ? AND chat_messages.id >= ?)
        )`
    : "";

  const whereSql = `WHERE chat_messages.chat_id = ?${visibilitySql}${beforeSql}${afterSql}`;
  const replyJoinVisibilitySql = hasViewerUserId
    ? `AND ${getVisibleMessageFilterSql(
        "reply",
        "WHERE hidden_chat_messages.user_id = ?",
      )}`
    : "AND reply.hidden_everyone_at IS NULL";

  const params: any[] = [];
  if (hasViewerUserId) params.push(viewerUserIdRaw);
  params.push(String(chatId));
  if (hasViewerUserId) params.push(viewerUserIdRaw);
  if (hasBefore) params.push(beforeCreatedAtRaw, beforeCreatedAtRaw, beforeIdRaw);
  if (hasAfter) params.push(afterCreatedAtRaw, afterCreatedAtRaw, afterIdRaw);
  params.push(limit + 1);

  const orderSql = hasAfter
    ? "ORDER BY chat_messages.created_at ASC, chat_messages.id ASC"
    : "ORDER BY chat_messages.created_at DESC, chat_messages.id DESC";

  const list = await pgGetAll(
    `SELECT chat_messages.id,
      COALESCE(chat_messages.edited_body, chat_messages.body) AS body,
      chat_messages.client_request_id,
      chat_messages.edited,
      chat_messages.edited_body,
      chat_messages.forwarded_from_chat_id,
      chat_messages.forwarded_from_label,
      chat_messages.forwarded_from_user_id,
      chat_messages.forwarded_from_username,
      chat_messages.forwarded_from_avatar_url,
      chat_messages.forwarded_from_color,
      chat_messages.created_at,
      chat_messages.expires_at,
      chat_messages.read_at,
      chat_messages.read_by_user_id,
      chat_messages.reply_to_message_id,
      users.id AS user_id,
      COALESCE(users.username, 'deleted') AS username,
      COALESCE(users.nickname, 'Deleted user') AS nickname,
      users.avatar_url, users.color,
      users.role AS user_role,
      users.verified AS user_verified,
      reply.id AS reply_id,
      COALESCE(reply.edited_body, reply.body) AS reply_body,
      reply.created_at AS reply_created_at,
      reply.user_id AS reply_user_id,
      COALESCE(reply_user.username, 'deleted') AS reply_username,
      COALESCE(reply_user.nickname, 'Deleted user') AS reply_nickname,
      reply_user.avatar_url AS reply_avatar_url,
      reply_user.color AS reply_user_color,
      reply_user.verified AS reply_user_verified,
      reply_user.role AS reply_user_role
    FROM chat_messages
    LEFT JOIN users ON users.id = chat_messages.user_id
    LEFT JOIN chat_messages reply
      ON reply.id = chat_messages.reply_to_message_id
      ${replyJoinVisibilitySql}
    LEFT JOIN users reply_user ON reply_user.id = reply.user_id
    ${whereSql}
    ${orderSql}
    LIMIT ?`,
    params,
  );

  const hasMore = list.length > limit;
  const rows = hasAfter
    ? list.slice(0, limit)
    : list.slice(0, limit).reverse();

  return {
    messages: rows.map(decryptMessageRow),
    hasMore,
  };
}

export async function getFirstUnreadMessage(
  chatId: string,
  viewerUserId: string,
) {
  if (!chatId || !viewerUserId) return null;
  const row = await pgGetRow<{ id: string; created_at: string }>(
    `SELECT cm.id, cm.created_at
     FROM chat_messages cm
     WHERE cm.chat_id = $1
       AND (
         cm.user_id IS NULL
         OR cm.user_id != $2
         OR LOWER(COALESCE(cm.client_request_id, '')) LIKE 'remote:%'
       )
       AND cm.hidden_everyone_at IS NULL
       AND cm.body NOT LIKE '[[system:%]]'
       AND NOT EXISTS (
         SELECT 1 FROM hidden_chat_messages hcm
         WHERE hcm.user_id = $2 AND hcm.message_id = cm.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM chat_message_reads cmr
         WHERE cmr.user_id = $2 AND cmr.message_id = cm.id
       )
     ORDER BY cm.created_at ASC, cm.id ASC
     LIMIT 1`,
    [String(chatId), String(viewerUserId)],
  );
  return row || null;
}

export async function findMessageFileById(id: number | string) {
  if (!id) return null;
  return pgGetRow(
    `SELECT id, message_id, kind, original_name, stored_name, mime_type,
            size_bytes, width_px, height_px, duration_seconds, expires_at, created_at,
            storage_driver, storage_key, processing_status, blurhash, waveform,
            thumb_storage_key, encryption_type
     FROM chat_message_files
     WHERE id = $1
     LIMIT 1`,
    [Number(id)],
  );
}

export async function listMessageFilesByMessageIds(messageIds: string[] = []) {
  if (!Array.isArray(messageIds) || !messageIds.length) return [];
  const ids = messageIds.filter(Boolean).map(String);
  if (!ids.length) return [];
  return pgGetAll(
    `SELECT id, message_id, kind, original_name, stored_name, mime_type,
            size_bytes, width_px, height_px, duration_seconds, expires_at, created_at,
            storage_driver, storage_key, processing_status, blurhash, waveform,
            thumb_storage_key, encryption_type
     FROM chat_message_files
     WHERE message_id = ANY($1::text[])
     ORDER BY id ASC`,
    [ids],
  );
}

export async function listMessageFilesNeedingMetadata(limit = 10000) {
  const safeLimit = Math.max(1, Math.min(200000, Number(limit) || 10000));
  return pgGetAll(
    `SELECT id, stored_name, mime_type, width_px, height_px, duration_seconds, expires_at
     FROM chat_message_files
     WHERE (mime_type LIKE 'image/%' OR mime_type LIKE 'video/%')
       AND (
         width_px IS NULL
         OR height_px IS NULL
         OR (mime_type LIKE 'video/%' AND duration_seconds IS NULL)
       )
     ORDER BY id ASC
     LIMIT $1`,
    [safeLimit],
  );
}

export async function updateMessageFileMetadata(
  fileId: number | string,
  metadata: any = {},
) {
  const data: Record<string, any> = {};
  if (Number.isFinite(Number(metadata.widthPx))) {
    data.widthPx = Number(metadata.widthPx);
  }
  if (Number.isFinite(Number(metadata.heightPx))) {
    data.heightPx = Number(metadata.heightPx);
  }
  if (Number.isFinite(Number(metadata.durationSeconds))) {
    data.durationSeconds = Number(metadata.durationSeconds);
  }
  if (!Object.keys(data).length) return 0;
  const res = await prisma.chatMessageFile.updateMany({
    where: { id: Number(fileId) },
    data,
  });
  return res.count;
}

export async function markMessageRead(messageId: string, readerId: string) {
  const row = await pgGetRow<{
    user_id: string;
    client_request_id: string | null;
    chat_type: string | null;
  }>(
    `SELECT cm.user_id, cm.client_request_id, c.type AS chat_type
     FROM chat_messages cm
     LEFT JOIN chats c ON c.id = cm.chat_id
     WHERE cm.id = $1
     LIMIT 1`,
    [String(messageId)],
  );
  if (!row) return;
  const isSavedChat = String(row.chat_type || "").toLowerCase() === "saved";
  if (row.user_id === readerId && !isRemoteMessageRow(row) && !isSavedChat) {
    return;
  }

  const updatePromise = isSavedChat
    ? pgRun(
        `UPDATE chat_messages
         SET read_at = CURRENT_TIMESTAMP::text, read_by_user_id = $1
         WHERE id = $2`,
        [String(readerId), String(messageId)],
      )
    : pgRun(
        `UPDATE chat_messages
         SET read_at = CURRENT_TIMESTAMP::text, read_by_user_id = $1
         WHERE id = $2
           AND (user_id != $1 OR ${REMOTE_MESSAGE_CLIENT_REQUEST_SQL})`,
        [String(readerId), String(messageId)],
      );

  const insertPromise = pgRun(
    `INSERT INTO chat_message_reads (message_id, user_id, read_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP::text)
     ON CONFLICT (message_id, user_id) DO NOTHING`,
    [String(messageId), String(readerId)],
  );

  await Promise.all([updatePromise, insertPromise]);
}

export async function markMessagesRead(chatId: string, readerId: string) {
  if (!chatId || !readerId) return;
  await pgRun(
    `INSERT INTO chat_message_reads (message_id, user_id, read_at)
     SELECT cm.id, $1, CURRENT_TIMESTAMP::text
     FROM chat_messages cm
     WHERE cm.chat_id = $2
       AND (
         cm.user_id != $1
         OR LOWER(COALESCE(cm.client_request_id, '')) LIKE 'remote:%'
         OR EXISTS (SELECT 1 FROM chats WHERE chats.id = $2 AND chats.type = 'saved')
       )
       AND NOT EXISTS (
         SELECT 1 FROM chat_message_reads cmr
         WHERE cmr.message_id = cm.id AND cmr.user_id = $1
       )
     ON CONFLICT (message_id, user_id) DO NOTHING`,
    [String(readerId), String(chatId)],
  );

  await pgRun(
    `UPDATE chat_messages
     SET read_at = CURRENT_TIMESTAMP::text, read_by_user_id = $1
     WHERE chat_id = $2
       AND (
         user_id != $1
         OR ${REMOTE_MESSAGE_CLIENT_REQUEST_SQL}
         OR EXISTS (SELECT 1 FROM chats WHERE chats.id = $2 AND chats.type = 'saved')
       )
       AND read_at IS NULL`,
    [String(readerId), String(chatId)],
  );
}

export async function getMessageReadCounts(messageIds: string[] = []) {
  const normalized = Array.from(
    new Set((Array.isArray(messageIds) ? messageIds : []).filter(Boolean).map(String)),
  );
  if (!normalized.length) return [];
  return pgGetAll<{ message_id: string; count: number }>(
    `SELECT message_id, COUNT(*) AS count
     FROM chat_message_reads
     WHERE message_id = ANY($1::text[])
     GROUP BY message_id`,
    [normalized],
  );
}

export async function getMessageAuthors(messageIds: string[] = []) {
  const normalized = Array.from(
    new Set((Array.isArray(messageIds) ? messageIds : []).filter(Boolean).map(String)),
  );
  if (!normalized.length) return [];
  return pgGetAll<{ id: string; user_id: string; client_request_id: string | null }>(
    `SELECT id, user_id, client_request_id
     FROM chat_messages
     WHERE id = ANY($1::text[])`,
    [normalized],
  );
}

export async function getMessageReadByUser(
  messageIds: string[] = [],
  userId: string,
) {
  const normalized = Array.from(
    new Set((Array.isArray(messageIds) ? messageIds : []).filter(Boolean).map(String)),
  );
  if (!normalized.length || !userId) return [];
  return pgGetAll<{ message_id: string }>(
    `SELECT message_id
     FROM chat_message_reads
     WHERE user_id = $1
       AND message_id = ANY($2::text[])`,
    [String(userId), normalized],
  );
}

export async function recordMessageReads(
  messageIds: string[] = [],
  readerId: string,
) {
  const normalized = Array.from(
    new Set((Array.isArray(messageIds) ? messageIds : []).filter(Boolean).map(String)),
  );
  if (!normalized.length || !readerId) return;

  const rows = await getMessageAuthors(normalized);
  const toInsert = rows
    .filter((row) => row?.user_id !== readerId || isRemoteMessageRow(row))
    .map((row) => row.id)
    .filter(Boolean);

  if (!toInsert.length) return;

  const now = new Date().toISOString();
  const chunkSize = 300;
  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize);
    await prisma.chatMessageRead.createMany({
      data: chunk.map((id) => ({
        messageId: id,
        userId: String(readerId),
        readAt: now,
      })),
      skipDuplicates: true,
    });
  }
}

export async function getTotalUnreadCount(userId: string): Promise<number> {
  if (!userId) return 0;
  const uid = String(userId);
  const row = await pgGetRow<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM (
       SELECT c.id AS chat_id
       FROM chats c
       JOIN chat_members m ON m.chat_id = c.id AND m.user_id = $1
       LEFT JOIN chat_mutes mu ON mu.chat_id = c.id AND mu.user_id = $1 AND mu.muted = 1
       LEFT JOIN hidden_chats h ON h.chat_id = c.id AND h.user_id = $1
       WHERE h.chat_id IS NULL AND mu.chat_id IS NULL
     ) mc
     JOIN chat_messages cm ON cm.chat_id = mc.chat_id
     LEFT JOIN hidden_chat_messages hcm ON hcm.message_id = cm.id AND hcm.user_id = $1
     LEFT JOIN chat_message_reads cmr ON cmr.message_id = cm.id AND cmr.user_id = $1
     WHERE cm.body NOT LIKE '[[system:%]]'
       AND cm.hidden_everyone_at IS NULL
       AND hcm.message_id IS NULL
       AND (cm.user_id != $1 OR LOWER(COALESCE(cm.client_request_id, '')) LIKE 'remote:%')
       AND cmr.message_id IS NULL`,
    [uid],
  );
  return Number(row?.total || 0);
}

export async function listChatFilesForUser(
  chatId: string,
  viewerUserId: string,
  { limit = 40, offset = 0 }: any = {},
) {
  if (!chatId || !viewerUserId) return [];
  const safeLimit = Math.min(Math.max(1, Number(limit) || 40), 100);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const rows = await pgGetAll(
    `SELECT cmf.id, cmf.message_id, cmf.kind, cmf.original_name, cmf.stored_name,
            cmf.mime_type, cmf.size_bytes, cmf.width_px, cmf.height_px,
            cmf.duration_seconds, cmf.storage_driver, cmf.storage_key,
            cmf.processing_status, cmf.thumb_storage_key, cmf.encryption_type,
            cmf.created_at AS file_created_at,
            cm.created_at AS message_created_at,
            u.id AS sender_id, u.username AS sender_username,
            u.nickname AS sender_nickname, u.avatar_url AS sender_avatar_url,
            u.color AS sender_color, u.verified AS sender_verified, u.role AS sender_role
     FROM chat_message_files cmf
     JOIN chat_messages cm ON cm.id = cmf.message_id
     JOIN users u ON u.id = cm.user_id
     WHERE cm.chat_id = $1
       AND cm.hidden_everyone_at IS NULL
       AND cm.id NOT IN (
         SELECT message_id FROM hidden_chat_messages WHERE user_id = $2
       )
     ORDER BY cm.created_at DESC, cm.id DESC, cmf.id DESC
     LIMIT $3 OFFSET $4`,
    [String(chatId), String(viewerUserId), safeLimit, safeOffset],
  );
  return rows || [];
}

export async function countChatFilesForUser(
  chatId: string,
  viewerUserId: string,
): Promise<number> {
  if (!chatId || !viewerUserId) return 0;
  const row = await pgGetRow<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM chat_message_files cmf
     JOIN chat_messages cm ON cm.id = cmf.message_id
     WHERE cm.chat_id = $1
       AND cm.hidden_everyone_at IS NULL
       AND cm.id NOT IN (
         SELECT message_id FROM hidden_chat_messages WHERE user_id = $2
       )`,
    [String(chatId), String(viewerUserId)],
  );
  return Number(row?.count || 0);
}

export async function searchChatMessagesForUser(
  chatId: string,
  viewerUserId: string,
  query: string,
  { limit = 30, offset = 0, maxScan = 50_000, chunkSize = 500 }: any = {},
) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || 30), 100);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeMaxScan = Math.max(100, Number(maxScan) || 50_000);
  const safeChunk = Math.min(Math.max(50, Number(chunkSize) || 500), 1000);
  const needle = String(query || "").trim().toLowerCase();
  if (!chatId || !viewerUserId || !needle) {
    return { results: [], hasMore: false, scanned: 0 };
  }

  const targetCount = safeOffset + safeLimit + 1;
  const matched: any[] = [];
  let scanned = 0;
  let dbOffset = 0;

  while (scanned < safeMaxScan && matched.length < targetCount) {
    const batchLimit = Math.min(safeChunk, safeMaxScan - scanned);
    const rows = await pgGetAll(
      `SELECT cm.id, cm.chat_id, cm.user_id, cm.body, cm.edited, cm.edited_body,
              cm.created_at,
              u.username, u.nickname, u.avatar_url, u.color, u.verified, u.role
       FROM chat_messages cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.chat_id = $1
         AND cm.hidden_everyone_at IS NULL
         AND cm.body NOT LIKE '[[system:%]]'
         AND cm.id NOT IN (
           SELECT message_id FROM hidden_chat_messages WHERE user_id = $2
         )
       ORDER BY cm.created_at DESC, cm.id DESC
       LIMIT $3 OFFSET $4`,
      [String(chatId), String(viewerUserId), batchLimit, dbOffset],
    );

    if (!rows || rows.length === 0) break;
    scanned += rows.length;
    dbOffset += rows.length;

    const msgIds = rows.map((r: any) => String(r.id));
    const fileRows = msgIds.length
      ? await pgGetAll(
          `SELECT message_id, original_name, kind
           FROM chat_message_files
           WHERE message_id = ANY($1::text[])`,
          [msgIds],
        )
      : [];
    const filesByMsg = new Map<string, Array<{ name: string; kind: string }>>();
    for (const f of fileRows || []) {
      const mid = String(f.message_id);
      if (!filesByMsg.has(mid)) filesByMsg.set(mid, []);
      filesByMsg.get(mid)!.push({
        name: String(f.original_name || ""),
        kind: String(f.kind || "document"),
      });
    }

    for (const rawRow of rows) {
      const row = decryptMessageRow(rawRow);
      const bodyStr = String(row.body || "");
      const editedBodyStr = String(row.edited_body || "");
      // Skip system messages even if stored encrypted
      if (/^\[\[system:.*\]\]$/s.test(bodyStr.trim())) continue;

      const displayBody = (Number(row.edited || 0) && editedBodyStr) ? editedBodyStr : bodyStr;
      const bodyHit =
        bodyStr.toLowerCase().includes(needle) ||
        editedBodyStr.toLowerCase().includes(needle);
      const msgFiles = filesByMsg.get(String(row.id)) || [];
      const matchedFiles = msgFiles
        .filter((f) => f.name.toLowerCase().includes(needle))
        .map((f) => f.name);

      if (bodyHit || matchedFiles.length > 0) {
        matched.push({
          id: row.id,
          chatId: row.chat_id,
          userId: row.user_id,
          username: row.username,
          nickname: row.nickname || row.username,
          avatarUrl: row.avatar_url || null,
          color: row.color || "#10b981",
          verified: Boolean(row.verified),
          role: row.role || "user",
          body: displayBody,
          edited: Boolean(Number(row.edited || 0)),
          matchedFiles,
          createdAt: row.created_at,
        });
        if (matched.length >= targetCount) break;
      }
    }

    if (rows.length < batchLimit) break;
  }

  const hasMore = matched.length > safeOffset + safeLimit;
  const results = matched.slice(safeOffset, safeOffset + safeLimit);
  return { results, hasMore, scanned };
}

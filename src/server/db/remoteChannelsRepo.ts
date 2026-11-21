import { pgGetAll, pgGetRow, pgRun, withPgTransaction } from "./prisma.ts";

const normalizeRemoteSourceUsername = (value: unknown): string | null =>
  String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase() || null;

const normalizeRemoteSourceChatId = (value: unknown): string | null => {
  const raw = String(value || "").trim();
  return raw || null;
};

export async function getRemoteChannelSourceByChatId(chatId: string) {
  if (!chatId) return null;
  return pgGetRow(
    `SELECT id, chat_id, provider, source_raw, source_chat_id, source_username,
            source_url, source_title, source_avatar_url, last_remote_message_id,
            enabled, paused, source_version, sync_metadata, stream_media,
            last_error, last_seen_at, created_at, updated_at
     FROM remote_channel_sources
     WHERE chat_id = $1`,
    [String(chatId)],
  );
}

export async function getRemoteChannelSourceById(sourceId: number | string) {
  const id = Number(sourceId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return pgGetRow(
    `SELECT id, chat_id, provider, source_raw, source_chat_id, source_username,
            source_url, source_title, source_avatar_url, last_remote_message_id,
            enabled, paused, source_version, sync_metadata, stream_media,
            last_error, last_seen_at, created_at, updated_at
     FROM remote_channel_sources
     WHERE id = $1
     LIMIT 1`,
    [id],
  );
}

export async function upsertRemoteChannelSource(payload: any = {}) {
  const chatId = payload.chatId ? String(payload.chatId) : null;
  if (!chatId) return null;

  const provider = String(payload.provider || "telegram").toLowerCase();
  const sourceRaw = String(payload.sourceRaw || "").trim() || null;
  const sourceChatId = normalizeRemoteSourceChatId(payload.sourceChatId);
  const sourceUsername = normalizeRemoteSourceUsername(payload.sourceUsername);
  const sourceUrl = String(payload.sourceUrl || "").trim() || null;
  const enabled = payload.enabled ? 1 : 0;
  const syncMetadata = payload.syncMetadata ? 1 : 0;
  const streamMedia = payload.streamMedia ? 1 : 0;

  const current = await getRemoteChannelSourceByChatId(chatId);
  const sourceChanged = Boolean(
    current?.id &&
      (String(current.source_raw || "") !== String(sourceRaw || "") ||
        String(current.source_chat_id || "") !== String(sourceChatId || "") ||
        String(current.source_username || "") !== String(sourceUsername || "") ||
        String(current.source_url || "") !== String(sourceUrl || "") ||
        String(current.provider || "telegram") !== provider),
  );
  const currentSourceVersion = Math.max(
    1,
    Number(current?.source_version || 1) || 1,
  );
  const sourceVersion = sourceChanged
    ? currentSourceVersion + 1
    : currentSourceVersion;

  await pgRun(
    `INSERT INTO remote_channel_sources (
       chat_id, provider, source_raw, source_chat_id, source_username,
       source_url, source_version, sync_metadata, stream_media, enabled,
       last_error, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, CURRENT_TIMESTAMP::text)
     ON CONFLICT (chat_id) DO UPDATE SET
       provider = EXCLUDED.provider,
       source_title = CASE
         WHEN COALESCE(remote_channel_sources.source_raw, '') != COALESCE(EXCLUDED.source_raw, '')
           OR COALESCE(remote_channel_sources.source_chat_id, '') != COALESCE(EXCLUDED.source_chat_id, '')
           OR COALESCE(remote_channel_sources.source_username, '') != COALESCE(EXCLUDED.source_username, '')
           OR COALESCE(remote_channel_sources.source_url, '') != COALESCE(EXCLUDED.source_url, '')
           OR remote_channel_sources.provider != EXCLUDED.provider
         THEN NULL
         ELSE remote_channel_sources.source_title
       END,
       source_avatar_url = CASE
         WHEN COALESCE(remote_channel_sources.source_raw, '') != COALESCE(EXCLUDED.source_raw, '')
           OR COALESCE(remote_channel_sources.source_chat_id, '') != COALESCE(EXCLUDED.source_chat_id, '')
           OR COALESCE(remote_channel_sources.source_username, '') != COALESCE(EXCLUDED.source_username, '')
           OR COALESCE(remote_channel_sources.source_url, '') != COALESCE(EXCLUDED.source_url, '')
           OR remote_channel_sources.provider != EXCLUDED.provider
         THEN NULL
         ELSE remote_channel_sources.source_avatar_url
       END,
       last_remote_message_id = CASE
         WHEN COALESCE(remote_channel_sources.source_raw, '') != COALESCE(EXCLUDED.source_raw, '')
           OR COALESCE(remote_channel_sources.source_chat_id, '') != COALESCE(EXCLUDED.source_chat_id, '')
           OR COALESCE(remote_channel_sources.source_username, '') != COALESCE(EXCLUDED.source_username, '')
           OR COALESCE(remote_channel_sources.source_url, '') != COALESCE(EXCLUDED.source_url, '')
           OR remote_channel_sources.provider != EXCLUDED.provider
         THEN NULL
         ELSE remote_channel_sources.last_remote_message_id
       END,
       source_raw = EXCLUDED.source_raw,
       source_chat_id = EXCLUDED.source_chat_id,
       source_username = EXCLUDED.source_username,
       source_url = EXCLUDED.source_url,
       source_version = EXCLUDED.source_version,
       sync_metadata = EXCLUDED.sync_metadata,
       stream_media = EXCLUDED.stream_media,
       enabled = EXCLUDED.enabled,
       last_error = NULL,
       updated_at = CURRENT_TIMESTAMP::text`,
    [
      chatId,
      provider,
      sourceRaw,
      sourceChatId,
      sourceUsername,
      sourceUrl,
      sourceVersion,
      syncMetadata,
      streamMedia,
      enabled,
    ],
  );

  if (current?.id && (sourceChanged || !enabled)) {
    await pgRun(
      `UPDATE remote_channel_queue
       SET status = 'skipped',
           locked_at = NULL,
           lock_owner = NULL,
           last_error = $1,
           processed_at = CURRENT_TIMESTAMP::text
       WHERE source_id = $2
         AND status IN ('pending', 'retry', 'processing')`,
      [
        sourceChanged
          ? "Remote source changed before this item was mirrored."
          : "Remote Channel was disabled before this item was mirrored.",
        Number(current.id),
      ],
    );
  }

  return getRemoteChannelSourceByChatId(chatId);
}

export async function listEnabledRemoteChannelSources(provider = "telegram") {
  return pgGetAll(
    `SELECT s.id, s.chat_id, s.provider, s.source_raw, s.source_chat_id, s.source_username,
            s.source_url, s.source_title, s.source_avatar_url, s.last_remote_message_id,
            s.enabled, s.paused, s.source_version, s.sync_metadata, s.stream_media,
            s.last_error, s.last_seen_at, s.created_at, s.updated_at,
            c.name AS chat_name, c.created_by_user_id
     FROM remote_channel_sources s
     JOIN chats c ON c.id = s.chat_id
     WHERE s.provider = $1
       AND s.enabled = 1
       AND c.type = 'channel'
     ORDER BY s.id ASC`,
    [String(provider || "telegram")],
  );
}

export async function updateRemoteChannelSourceSeen(
  sourceId: number | string,
  payload: any = {},
) {
  const id = Number(sourceId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const sourceChatId =
    payload.sourceChatId !== undefined
      ? normalizeRemoteSourceChatId(payload.sourceChatId)
      : undefined;
  const sourceUsername =
    payload.sourceUsername !== undefined
      ? normalizeRemoteSourceUsername(payload.sourceUsername)
      : undefined;
  const sourceTitle =
    payload.sourceTitle !== undefined
      ? String(payload.sourceTitle || "").trim() || null
      : undefined;
  const sourceAvatarUrl =
    payload.sourceAvatarUrl !== undefined
      ? String(payload.sourceAvatarUrl || "").trim() || null
      : undefined;
  const lastRemoteMessageId =
    payload.lastRemoteMessageId !== undefined &&
    Number.isFinite(Number(payload.lastRemoteMessageId))
      ? Math.trunc(Number(payload.lastRemoteMessageId))
      : undefined;
  const markSeen = payload.markSeen !== false;
  const clearError = payload.clearError !== false;

  const current = await getRemoteChannelSourceById(id);
  if (!current) return null;

  await pgRun(
    `UPDATE remote_channel_sources
     SET source_chat_id = $1,
         source_username = $2,
         source_title = $3,
         source_avatar_url = $4,
         last_remote_message_id = CASE
           WHEN $5::integer IS NULL THEN last_remote_message_id
           WHEN last_remote_message_id IS NULL THEN $5::integer
           ELSE GREATEST(last_remote_message_id, $5::integer)
         END,
         last_seen_at = CASE WHEN $6::boolean THEN CURRENT_TIMESTAMP::text ELSE last_seen_at END,
         last_error = CASE WHEN $7::boolean THEN NULL ELSE last_error END,
         updated_at = CURRENT_TIMESTAMP::text
     WHERE id = $8`,
    [
      sourceChatId !== undefined ? sourceChatId : current.source_chat_id,
      sourceUsername !== undefined ? sourceUsername : current.source_username,
      sourceTitle !== undefined ? sourceTitle : current.source_title,
      sourceAvatarUrl !== undefined ? sourceAvatarUrl : current.source_avatar_url,
      lastRemoteMessageId ?? null,
      markSeen,
      clearError,
      id,
    ],
  );
  return getRemoteChannelSourceById(id);
}

export async function updateRemoteChannelSourceError(
  sourceId: number | string,
  error: unknown,
) {
  const id = Number(sourceId);
  if (!Number.isFinite(id) || id <= 0) return 0;
  const message = String(error || "").trim().slice(0, 1000) || null;
  return pgRun(
    `UPDATE remote_channel_sources
     SET last_error = $1, updated_at = CURRENT_TIMESTAMP::text
     WHERE id = $2`,
    [message, id],
  );
}

export async function updateRemoteChannelSourcePaused(
  sourceId: number | string,
  paused: boolean | number,
) {
  const id = Number(sourceId);
  if (!Number.isFinite(id) || id <= 0) return 0;
  return pgRun(
    `UPDATE remote_channel_sources
     SET paused = $1, updated_at = CURRENT_TIMESTAMP::text
     WHERE id = $2`,
    [paused ? 1 : 0, id],
  );
}

export async function getCurrentRemoteChannelQueueItemId(
  sourceId: number | string,
) {
  const id = Number(sourceId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = await pgGetRow<{ id: number }>(
    `SELECT id
     FROM remote_channel_queue
     WHERE source_id = $1
       AND status IN ('processing', 'pending', 'retry')
     ORDER BY CASE status WHEN 'processing' THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
    [id],
  );
  return row?.id ? Number(row.id) : null;
}

export async function skipCurrentRemoteChannelQueueItem(
  sourceId: number | string,
) {
  const id = Number(sourceId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const itemId = await getCurrentRemoteChannelQueueItemId(id);
  if (!itemId) return null;
  await pgRun(
    `UPDATE remote_channel_queue
     SET status = 'skipped',
         locked_at = NULL,
         lock_owner = NULL,
         last_error = 'Skipped manually by admin.',
         processed_at = CURRENT_TIMESTAMP::text
     WHERE id = $1`,
    [itemId],
  );
  return itemId;
}

export async function skipAllRemoteChannelQueueItems(
  sourceId: number | string,
) {
  const id = Number(sourceId);
  if (!Number.isFinite(id) || id <= 0) return 0;
  return pgRun(
    `UPDATE remote_channel_queue
     SET status = 'skipped',
         locked_at = NULL,
         lock_owner = NULL,
         last_error = 'Skipped manually by admin.',
         processed_at = CURRENT_TIMESTAMP::text
     WHERE source_id = $1
       AND status IN ('pending', 'retry', 'processing')`,
    [id],
  );
}

export async function getRemoteChannelProviderState(provider = "telegram") {
  return pgGetRow(
    `SELECT provider, next_update_offset, last_error, last_polled_at, updated_at
     FROM remote_channel_provider_state
     WHERE provider = $1`,
    [String(provider || "telegram")],
  );
}

export async function setRemoteChannelProviderState(
  provider = "telegram",
  payload: any = {},
) {
  const normalizedProvider = String(provider || "telegram");
  const nextUpdateOffset = Number.isFinite(Number(payload.nextUpdateOffset))
    ? Math.trunc(Number(payload.nextUpdateOffset))
    : null;
  const lastError = Object.prototype.hasOwnProperty.call(payload, "lastError")
    ? String(payload.lastError || "").slice(0, 1000) || null
    : undefined;
  const lastPolledAt = Object.prototype.hasOwnProperty.call(payload, "lastPolledAt")
    ? String(payload.lastPolledAt || "").trim() || null
    : undefined;

  const current = await getRemoteChannelProviderState(normalizedProvider);
  const nextOffset =
    nextUpdateOffset === null
      ? Number(current?.next_update_offset || 0) || null
      : nextUpdateOffset;
  const nextError =
    lastError === undefined ? current?.last_error || null : lastError;
  const nextPolledAt =
    lastPolledAt === undefined
      ? current?.last_polled_at || null
      : lastPolledAt;

  return pgRun(
    `INSERT INTO remote_channel_provider_state (
       provider, next_update_offset, last_error, last_polled_at, updated_at
     )
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP::text)
     ON CONFLICT (provider) DO UPDATE SET
       next_update_offset = EXCLUDED.next_update_offset,
       last_error = EXCLUDED.last_error,
       last_polled_at = EXCLUDED.last_polled_at,
       updated_at = CURRENT_TIMESTAMP::text`,
    [normalizedProvider, nextOffset, nextError, nextPolledAt],
  );
}

export async function enqueueRemoteChannelQueueItem(payload: any = {}) {
  const sourceId = Number(payload.sourceId || 0);
  if (!sourceId) return null;
  const provider = String(payload.provider || "telegram").toLowerCase();
  const telegramUpdateId = Number.isFinite(Number(payload.telegramUpdateId))
    ? Math.trunc(Number(payload.telegramUpdateId))
    : null;
  const telegramMessageId = Number.isFinite(Number(payload.telegramMessageId))
    ? Math.trunc(Number(payload.telegramMessageId))
    : null;
  const sourceVersion = Math.max(
    1,
    Math.trunc(Number(payload.sourceVersion || 1)) || 1,
  );
  const payloadJson = String(payload.payloadJson || "").trim();
  if (!payloadJson) return null;

  const row = await pgGetRow(
    `INSERT INTO remote_channel_queue (
       source_id, provider, telegram_update_id, telegram_message_id,
       source_version, payload_json, status, next_attempt_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', CURRENT_TIMESTAMP::text)
     ON CONFLICT DO NOTHING
     RETURNING id, source_id, provider, telegram_update_id, telegram_message_id,
               source_version, payload_json, status, attempts, next_attempt_at,
               locked_at, lock_owner, last_error, created_message_id, created_at,
               processed_at`,
    [
      sourceId,
      provider,
      telegramUpdateId,
      telegramMessageId,
      sourceVersion,
      payloadJson,
    ],
  );
  return row || null;
}

export async function getRemoteChannelQueueSummary(sourceId: number | string) {
  const rows = await pgGetAll<{ status: string; count: number }>(
    `SELECT status, COUNT(*) AS count
     FROM remote_channel_queue
     WHERE source_id = $1
     GROUP BY status`,
    [Number(sourceId)],
  );
  return (rows || []).reduce<Record<string, number>>((acc, row) => {
    const status = String(row?.status || "").trim() || "unknown";
    acc[status] = Number(row?.count || 0);
    return acc;
  }, {});
}

export async function releaseStaleRemoteChannelQueueItems(
  staleBeforeIso?: string,
) {
  return pgRun(
    `UPDATE remote_channel_queue
     SET status = 'retry',
         locked_at = NULL,
         lock_owner = NULL,
         next_attempt_at = CURRENT_TIMESTAMP::text
     WHERE status = 'processing'
       AND locked_at IS NOT NULL
       AND locked_at <= $1`,
    [String(staleBeforeIso || new Date().toISOString())],
  );
}

export async function claimNextRemoteChannelQueueItem(
  lockOwner?: string,
  nowIso?: string,
) {
  const now = String(nowIso || new Date().toISOString());
  const owner = String(lockOwner || "remote-channel-worker");

  return withPgTransaction(async (tx) => {
    const row = await tx.getRow(
      `SELECT q.id, q.source_id, q.provider, q.telegram_update_id,
              q.telegram_message_id, q.source_version, q.payload_json, q.status,
              q.attempts, q.next_attempt_at, q.locked_at, q.lock_owner,
              q.last_error, q.created_message_id, q.created_at, q.processed_at,
              s.chat_id, s.source_raw, s.source_chat_id, s.source_username,
              s.source_title, s.source_avatar_url, s.last_remote_message_id,
              s.source_version AS current_source_version, s.sync_metadata,
              s.stream_media,
              c.name AS target_chat_name, c.created_by_user_id
       FROM remote_channel_queue q
       JOIN remote_channel_sources s ON s.id = q.source_id
       JOIN chats c ON c.id = s.chat_id
       WHERE q.provider = s.provider
         AND s.enabled = 1
         AND s.paused = 0
         AND q.source_version = s.source_version
         AND c.type = 'channel'
         AND q.status IN ('pending', 'retry')
         AND (
           q.next_attempt_at IS NULL
           OR q.next_attempt_at = ''
           OR q.next_attempt_at <= $1
         )
       ORDER BY q.created_at ASC, q.id ASC
       LIMIT 1
       FOR UPDATE OF q SKIP LOCKED`,
      [now],
    );
    if (!row?.id) return null;

    await tx.run(
      `UPDATE remote_channel_queue
       SET status = 'processing',
           locked_at = $1,
           lock_owner = $2
       WHERE id = $3`,
      [now, owner, Number(row.id)],
    );

    return {
      ...row,
      status: "processing",
      locked_at: now,
      lock_owner: owner,
    };
  });
}

export async function markRemoteChannelQueueItemDone(
  id: number | string,
  messageId: string | null,
) {
  return pgRun(
    `UPDATE remote_channel_queue
     SET status = 'done',
         locked_at = NULL,
         lock_owner = NULL,
         last_error = NULL,
         created_message_id = $1,
         processed_at = CURRENT_TIMESTAMP::text
     WHERE id = $2`,
    [messageId || null, Number(id)],
  );
}

export async function markRemoteChannelQueueItemSkipped(
  id: number | string,
  reason: string,
) {
  return pgRun(
    `UPDATE remote_channel_queue
     SET status = 'skipped',
         locked_at = NULL,
         lock_owner = NULL,
         last_error = $1,
         processed_at = CURRENT_TIMESTAMP::text
     WHERE id = $2`,
    [String(reason || "Skipped").slice(0, 1000), Number(id)],
  );
}

export async function markRemoteChannelQueueItemRetry(
  id: number | string,
  payload: any = {},
) {
  return pgRun(
    `UPDATE remote_channel_queue
     SET status = $1,
         attempts = attempts + 1,
         next_attempt_at = $2,
         locked_at = NULL,
         lock_owner = NULL,
         last_error = $3
     WHERE id = $4`,
    [
      payload.failed ? "failed" : "retry",
      payload.failed
        ? null
        : String(payload.nextAttemptAt || new Date().toISOString()),
      String(payload.error || "").slice(0, 1000) || null,
      Number(id),
    ],
  );
}

export async function purgeOldRemoteChannelQueueItems(olderThanIso: string) {
  return pgRun(
    `DELETE FROM remote_channel_queue
     WHERE status IN ('done', 'skipped', 'failed')
       AND processed_at IS NOT NULL
       AND processed_at < $1`,
    [String(olderThanIso)],
  );
}

export function createMessageFileJobs({
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
  storageProvider = null,
}: any) {
  const getMessageFileRetentionDays = () =>
    Number(getSetting("MESSAGE_FILE_RETENTION")) || 0;

  const chunkArray = (items: any[] = [], size = 500) => {
    const chunks: any[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  };

  const runDeleteChunks = async (ids: any[]) => {
    const execChunks = async (queryRun: any) => {
      for (const chunk of chunkArray(ids, 500)) {
        await queryRun(
          "DELETE FROM chat_message_files WHERE message_id = ANY($1::text[])",
          [chunk],
        );
        await queryRun(
          "DELETE FROM chat_messages WHERE id = ANY($1::text[])",
          [chunk],
        );
      }
    };
    if (typeof adminTransaction === "function") {
      await adminTransaction(execChunks);
    } else {
      await execChunks(adminRun);
    }
  };

  const resolveSharedMessageIdsByStoredNames = async (storedNames: any[] = []) => {
    const normalized = Array.from(
      new Set(
        (Array.isArray(storedNames) ? storedNames : [])
          .map((name) => path.basename(String(name || "").trim()))
          .filter(Boolean),
      ),
    );
    if (!normalized.length) return [];
    const rows =
      (await adminGetAll(
        "SELECT DISTINCT message_id FROM chat_message_files WHERE stored_name = ANY($1::text[])",
        [normalized],
      )) || [];
    return rows.map((row: any) => row?.message_id).filter(Boolean);
  };

  const cleanupMissingMessageFiles = async (messageIds: any[] = []) => {
    const normalized = Array.from(
      new Set((Array.isArray(messageIds) ? messageIds : []).filter(Boolean)),
    );
    if (!normalized.length) {
      return {
        deletedMessageIds: [],
        deletedByChat: new Map<any, any>(),
        changed: false,
      };
    }

    const safeRows = (await listMessageFilesByMessageIds(normalized)) || [];
    if (!safeRows.length) {
      return {
        deletedMessageIds: [],
        deletedByChat: new Map<any, any>(),
        changed: false,
      };
    }

    const missingMessageIds = new Set<any>();
    safeRows.forEach((row: any) => {
      const driver = String(row.storage_driver || "local").toLowerCase();
      if (driver === "remote" || driver === "s3") return;
      const stored = path.basename(String(row.stored_name || "").trim());
      if (!stored) return;
      const filePath = path.join(uploadRootDir, stored);
      if (!fs.existsSync(filePath)) {
        missingMessageIds.add(row.message_id);
      }
    });

    if (!missingMessageIds.size) {
      return {
        deletedMessageIds: [],
        deletedByChat: new Map<any, any>(),
        changed: false,
      };
    }

    const initialMessageIds = Array.from(missingMessageIds);
    const allFilesRows =
      (await adminGetAll(
        "SELECT stored_name FROM chat_message_files WHERE message_id = ANY($1::text[])",
        [initialMessageIds],
      )) || [];
    const storedNames = allFilesRows.map((row: any) => row.stored_name);
    const targetMessageIds = await resolveSharedMessageIdsByStoredNames(storedNames);
    const uniqueTargetIds = Array.from(new Set(targetMessageIds));

    const messageChatPairs = uniqueTargetIds.length
      ? (await adminGetAll(
          "SELECT id, chat_id FROM chat_messages WHERE id = ANY($1::text[])",
          [uniqueTargetIds],
        )) || []
      : [];

    const deletedByChat = new Map<any, any>();
    messageChatPairs.forEach((row: any) => {
      const chatId = row?.chat_id;
      const messageId = row?.id;
      if (!chatId || !messageId) return;
      const list = deletedByChat.get(chatId) || [];
      list.push(messageId);
      deletedByChat.set(chatId, list);
    });

    await runDeleteChunks(uniqueTargetIds);
    removeStoredFileNames(storedNames);
    if (typeof adminSave === "function") adminSave();

    return {
      deletedMessageIds: uniqueTargetIds,
      deletedByChat,
      changed: true,
    };
  };

  const collectRemoteKeysFromFileRows = (fileRows: any[] = []) => {
    const keys = new Set<string>();
    (fileRows || []).forEach((row: any) => {
      const driver = String(
        row?.storage_driver ?? row?.storageDriver ?? "local",
      ).toLowerCase();
      if (driver !== "remote" && driver !== "s3") return;
      const storageKey = String(
        row?.storage_key ?? row?.storageKey ?? "",
      ).trim();
      if (storageKey) {
        keys.add(storageKey);
      } else {
        const stored = path.basename(String(row?.stored_name || "").trim());
        if (stored) keys.add(`uploads/messages/${stored}`);
      }
      const thumbKey = String(
        row?.thumb_storage_key ?? row?.thumbStorageKey ?? "",
      ).trim();
      if (thumbKey) keys.add(thumbKey);
    });
    return Array.from(keys);
  };

  const activeStorageProviderDelete = (provider: any) =>
    provider && typeof provider.deleteFile === "function"
      ? provider.deleteFile.bind(provider)
      : null;

  const deleteRemoteKeysBestEffort = async (keys: string[] = [], activeProvider: any) => {
    if (
      !keys.length ||
      !activeProvider ||
      typeof activeStorageProviderDelete(activeProvider) !== "function"
    ) {
      return [];
    }

    const stillReferenced = new Set<string>();
    try {
      const remaining =
        (await adminGetAll(
          `SELECT storage_key, thumb_storage_key
           FROM chat_message_files
           WHERE storage_key = ANY($1::text[])
              OR thumb_storage_key = ANY($1::text[])`,
          [keys],
        )) || [];
      remaining.forEach((row: any) => {
        const sk = String(row?.storage_key || "").trim();
        if (sk) stillReferenced.add(sk);
        const tk = String(row?.thumb_storage_key || "").trim();
        if (tk) stillReferenced.add(tk);
      });
    } catch (_) {
      // Best effort
    }

    const toDelete = keys.filter((key) => !stillReferenced.has(key));
    const deleted: string[] = [];
    const doDelete = activeStorageProviderDelete(activeProvider);
    for (const key of toDelete) {
      try {
        await doDelete(key);
        deleted.push(key);
      } catch (_) {
        // Best effort per object
      }
    }
    return deleted;
  };

  const removeLocalThumbFiles = async (fileRows: any[] = []) => {
    const thumbKeys = new Set<string>();
    (fileRows || []).forEach((row: any) => {
      const driver = String(
        row?.storage_driver ?? row?.storageDriver ?? "local",
      ).toLowerCase();
      if (driver === "remote" || driver === "s3") return;
      const thumbKey = String(
        row?.thumb_storage_key ?? row?.thumbStorageKey ?? "",
      ).trim();
      if (thumbKey) thumbKeys.add(thumbKey);
    });
    if (!thumbKeys.size) return 0;

    const stillReferenced = new Set<string>();
    try {
      const remaining =
        (await adminGetAll(
          "SELECT thumb_storage_key FROM chat_message_files WHERE thumb_storage_key = ANY($1::text[])",
          [Array.from(thumbKeys)],
        )) || [];
      remaining.forEach((row: any) => {
        const key = String(row?.thumb_storage_key || "").trim();
        if (key) stillReferenced.add(key);
      });
    } catch (_) {
      // Best effort
    }

    let removed = 0;
    thumbKeys.forEach((thumbKey) => {
      if (stillReferenced.has(thumbKey)) return;
      const base = path.basename(String(thumbKey));
      const candidates =
        base && base !== String(thumbKey)
          ? [
              path.join(uploadRootDir, String(thumbKey)),
              path.join(uploadRootDir, base),
            ]
          : [path.join(uploadRootDir, String(thumbKey))];
      for (const candidate of candidates) {
        try {
          if (fs.existsSync(candidate)) {
            fs.unlinkSync(candidate);
            removed += 1;
            break;
          }
        } catch (_) {
          break;
        }
      }
    });
    return removed;
  };

  const cleanupExpiredMessageFiles = (options: any = {}) => {
    if (getMessageFileRetentionDays() <= 0) {
      return { removedMessages: 0, removedFiles: 0 };
    }
    return (async () => {
      const nowIso = new Date().toISOString();
      const rows =
        (await adminGetAll(
          `SELECT DISTINCT stored_name
           FROM chat_message_files
           WHERE expires_at IS NOT NULL
             AND expires_at != ''
             AND expires_at::timestamptz <= $1::timestamptz`,
          [nowIso],
        )) || [];
      const storedNames = rows.map((row: any) => row.stored_name);
      const messageIds = await resolveSharedMessageIdsByStoredNames(storedNames);
      const uniqueMsgIds = Array.from(new Set(messageIds));
      if (!uniqueMsgIds.length) {
        return { removedMessages: 0, removedFiles: 0 };
      }

      const safeFileRows =
        (await adminGetAll(
          `SELECT stored_name, storage_key, storage_driver, thumb_storage_key
           FROM chat_message_files
           WHERE message_id = ANY($1::text[])`,
          [uniqueMsgIds],
        )) || [];
      const allStoredNames = safeFileRows.map((row: any) => row.stored_name);
      const remoteKeys = collectRemoteKeysFromFileRows(safeFileRows);
      const activeProvider =
        (options && options.storageProvider) || storageProvider;

      await runDeleteChunks(uniqueMsgIds);
      removeStoredFileNames(allStoredNames);
      const removedLocalThumbs = await removeLocalThumbFiles(safeFileRows);
      if (typeof adminSave === "function") adminSave();

      const result: any = {
        removedMessages: uniqueMsgIds.length,
        removedFiles: allStoredNames.length,
        removedLocalThumbs,
      };
      if (!remoteKeys.length || !activeStorageProviderDelete(activeProvider)) {
        return result;
      }
      const deletedKeys = await deleteRemoteKeysBestEffort(
        remoteKeys,
        activeProvider,
      );
      return {
        ...result,
        removedRemoteFiles: deletedKeys.length,
        removedRemoteKeys: deletedKeys,
      };
    })();
  };

  const backfillMessageFileExpiry = () => {
    const nowDays = getMessageFileRetentionDays();
    if (nowDays <= 0) return 0;
    return (async () => {
      const row = await adminGetRow(
        "SELECT COUNT(*) AS n FROM chat_message_files WHERE expires_at IS NULL OR expires_at = ''",
      );
      const pending = Number(row?.n || 0);
      if (!pending) return 0;
      await adminRun(
        `UPDATE chat_message_files
         SET expires_at = to_char(
           (created_at::timestamptz + ($1 * INTERVAL '1 day')) AT TIME ZONE 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
         )
         WHERE expires_at IS NULL OR expires_at = ''`,
        [nowDays],
      );
      if (typeof adminSave === "function") adminSave();
      return pending;
    })();
  };

  const removeAllMessageUploads = () => {
    try {
      if (fs.existsSync(uploadRootDir)) {
        fs.rmSync(uploadRootDir, { recursive: true, force: true });
      }
      fs.mkdirSync(uploadRootDir, { recursive: true });
    } catch (_) {
      // ignore
    }
  };

  const computeExpiryIso = (
    createdAt = new Date(),
    days = getMessageFileRetentionDays(),
  ) => {
    const safeDays = Number(days || 0);
    if (!Number.isFinite(safeDays) || safeDays <= 0) return null;
    const base = createdAt instanceof Date ? createdAt : new Date(createdAt);
    const expiry = new Date(base.getTime() + safeDays * 24 * 60 * 60 * 1000);
    return expiry.toISOString();
  };

  const pruneOrphanRemoteObjects = async (options: any = {}) => {
    const {
      maxAgeMs = 60 * 60 * 1000,
      storageProvider: activeStorageProvider = storageProvider,
      storageKeys: customKeys = null,
    } = options;

    const cutoffIso = new Date(Date.now() - maxAgeMs).toISOString();
    let keysToCheck: string[] = [];

    if (Array.isArray(customKeys) && customKeys.length > 0) {
      keysToCheck = customKeys;
    } else {
      const pendingRows =
        (await adminGetAll(
          "SELECT storage_key FROM pending_presigned_uploads WHERE created_at <= $1",
          [cutoffIso],
        )) || [];
      keysToCheck = pendingRows.map((r: any) => r.storage_key).filter(Boolean);
    }

    if (!keysToCheck.length) {
      return { prunedCount: 0, prunedKeys: [] };
    }

    const referencedRows =
      (await adminGetAll(
        "SELECT storage_key FROM chat_message_files WHERE storage_key = ANY($1::text[])",
        [keysToCheck],
      )) || [];
    const referencedKeysSet = new Set<string>(
      referencedRows.map((r: any) => r.storage_key).filter(Boolean),
    );

    const avatarKeysToCheck = keysToCheck.filter(
      (k) =>
        k.startsWith("uploads/avatars/") ||
        k.startsWith("avatars/") ||
        k.includes("avatar-"),
    );

    if (avatarKeysToCheck.length) {
      const userRows =
        (await adminGetAll(
          "SELECT avatar_url FROM users WHERE avatar_url IS NOT NULL",
        )) || [];
      userRows.forEach((row: any) => {
        const fn = path.basename(String(row?.avatar_url || "").trim());
        if (fn) {
          avatarKeysToCheck.forEach((k) => {
            if (k.endsWith(fn)) referencedKeysSet.add(k);
          });
        }
      });

      const chatRows =
        (await adminGetAll(
          "SELECT group_avatar_url FROM chats WHERE group_avatar_url IS NOT NULL",
        )) || [];
      chatRows.forEach((row: any) => {
        const fn = path.basename(String(row?.group_avatar_url || "").trim());
        if (fn) {
          avatarKeysToCheck.forEach((k) => {
            if (k.endsWith(fn)) referencedKeysSet.add(k);
          });
        }
      });

      try {
        const sourceRows =
          (await adminGetAll(
            "SELECT source_avatar_url FROM remote_channel_sources WHERE source_avatar_url IS NOT NULL",
          )) || [];
        sourceRows.forEach((row: any) => {
          const fn = path.basename(String(row?.source_avatar_url || "").trim());
          if (fn) {
            avatarKeysToCheck.forEach((k) => {
              if (k.endsWith(fn)) referencedKeysSet.add(k);
            });
          }
        });
      } catch (_) {}

      const totalAvatarRows = userRows.length + chatRows.length;
      if (totalAvatarRows === 0) {
        keysToCheck = keysToCheck.filter((k) => !avatarKeysToCheck.includes(k));
      }
    }

    const orphanKeys = keysToCheck.filter((key) => !referencedKeysSet.has(key));
    const claimedKeys = keysToCheck.filter((key) => referencedKeysSet.has(key));

    if (claimedKeys.length) {
      await adminRun(
        "DELETE FROM pending_presigned_uploads WHERE storage_key = ANY($1::text[])",
        [claimedKeys],
      );
    }

    const prunedKeys: string[] = [];
    for (const key of orphanKeys) {
      try {
        if (
          activeStorageProvider &&
          typeof activeStorageProvider.deleteFile === "function"
        ) {
          await activeStorageProvider.deleteFile(key);
        }
        prunedKeys.push(key);
      } catch (_) {
        // best effort cleanup per object
      }
    }

    if (prunedKeys.length) {
      await adminRun(
        "DELETE FROM pending_presigned_uploads WHERE storage_key = ANY($1::text[])",
        [prunedKeys],
      );
      if (typeof adminSave === "function") adminSave();
    }

    return {
      prunedCount: prunedKeys.length,
      prunedKeys,
    };
  };

  const pruneOrphanAvatarObjects = async (options: any = {}) => {
    const {
      maxAgeMs = 60 * 60 * 1000,
      storageProvider: activeStorageProvider = storageProvider,
    } = options;

    if (
      !activeStorageProvider ||
      (activeStorageProvider.type !== "remote" &&
        activeStorageProvider.type !== "s3") ||
      typeof activeStorageProvider.listObjects !== "function"
    ) {
      return { prunedCount: 0, prunedKeys: [] };
    }

    const s3ObjectsNew =
      (await activeStorageProvider.listObjects("uploads/avatars/")) || [];
    let s3ObjectsLegacy: any[] = [];
    try {
      s3ObjectsLegacy =
        (await activeStorageProvider.listObjects("avatars/")) || [];
    } catch (_) {
      s3ObjectsLegacy = [];
    }

    const seenKeys = new Set<string>();
    const s3Objects = [...s3ObjectsNew, ...s3ObjectsLegacy].filter((obj) => {
      const cleanKey = String(obj?.key || "").trim();
      if (!cleanKey || cleanKey.endsWith("/") || seenKeys.has(cleanKey)) return false;
      seenKeys.add(cleanKey);
      return true;
    });
    if (!s3Objects.length) {
      return { prunedCount: 0, prunedKeys: [] };
    }

    const cutoffTime = Date.now() - maxAgeMs;
    const candidates = s3Objects.filter((obj) => {
      if (obj.lastModified && obj.lastModified.getTime() > cutoffTime) {
        return false;
      }
      return true;
    });
    if (!candidates.length) {
      return { prunedCount: 0, prunedKeys: [] };
    }

    const activeFileNames = new Set<string>();
    try {
      const userRows =
        (await adminGetAll(
          "SELECT avatar_url FROM users WHERE avatar_url IS NOT NULL",
        )) || [];
      userRows.forEach((r: any) => {
        const fn = path.basename(String(r?.avatar_url || "").trim());
        if (fn) activeFileNames.add(fn);
      });
    } catch (_) {
      return { prunedCount: 0, prunedKeys: [] };
    }

    try {
      const chatRows =
        (await adminGetAll(
          "SELECT group_avatar_url FROM chats WHERE group_avatar_url IS NOT NULL",
        )) || [];
      chatRows.forEach((r: any) => {
        const fn = path.basename(String(r?.group_avatar_url || "").trim());
        if (fn) activeFileNames.add(fn);
      });
    } catch (_) {}

    try {
      const sourceRows =
        (await adminGetAll(
          "SELECT source_avatar_url FROM remote_channel_sources WHERE source_avatar_url IS NOT NULL",
        )) || [];
      sourceRows.forEach((r: any) => {
        const fn = path.basename(String(r?.source_avatar_url || "").trim());
        if (fn) activeFileNames.add(fn);
      });
    } catch (_) {}

    if (activeFileNames.size === 0) {
      return { prunedCount: 0, prunedKeys: [] };
    }

    const prunedKeys: string[] = [];
    for (const obj of candidates) {
      const fileName = path.basename(obj.key);
      if (fileName && !activeFileNames.has(fileName)) {
        try {
          if (typeof activeStorageProvider.deleteFile === "function") {
            await activeStorageProvider.deleteFile(obj.key);
            prunedKeys.push(obj.key);
          }
        } catch (_) {}
      }
    }

    return {
      prunedCount: prunedKeys.length,
      prunedKeys,
    };
  };

  return {
    chunkArray,
    cleanupMissingMessageFiles,
    cleanupExpiredMessageFiles,
    backfillMessageFileExpiry,
    removeAllMessageUploads,
    computeExpiryIso,
    pruneOrphanRemoteObjects,
    pruneOrphanAvatarObjects,
  };
}

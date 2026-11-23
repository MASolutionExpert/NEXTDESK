import path from "node:path";
import { createInviteToken } from "../lib/inviteTokens.ts";
import { createMembershipService } from "../lib/services/membershipService.ts";
import { createDeletionService } from "../lib/services/deletionService.ts";
import { normalizeNextDeskSource, normalizeTelegramSource, resolveNextDeskSource } from "../lib/remoteChannels.ts";
import { resolveThumbUrl } from "../lib/thumbUrl.ts";
import { validateUuidParams, validateUuidBody } from "../lib/uuidMiddleware.ts";

function registerChatRoutes(app, deps) {
  const {
    USERNAME_REGEX,
    USER_COLORS,
    addChatMember,
    ALLOWED_AVATAR_MIME_TYPES,
    AVATAR_FILE_LIMITS,
    avatarUploadRootDir,
    cleanupMissingMessageFiles,
    clearChatMemberLeft,
    crypto,
    createChat,
    createMessage,
    deleteChatById,
    deleteUserById,
    emitChatEvent,
    emitSseEvent,
    ensureSavedChatForUser,
    ensureAvatarExists,
    findChatById,
    findChatByGroupUsername,
    findChatByInviteToken,
    findMessageById,
    findDmChat,
    findUserByUsername,
    findUserById,
    hideChatsForUser,
    hydrateMissingVideoMetadata,
    isConnected,
    isGroupMemberRemoved,
    isMember,
    isVideoFileProcessing,
    listChatMembers,
    listChatMembersForChats,
    listChatsForUser,
    listMessageFilesByMessageIds,
    listChatFilesForUser = null,
    countChatFilesForUser = null,
    searchChatMessagesForUser = null,
    listUsers,
    removeAvatarByUrl,
    removePendingPresignedUploads,
    removeStoredFileNames,
    clearGroupMemberRemoved,
    bcrypt,
    markChatMemberLeft,
    markGroupMemberRemoved,
    removeChatMember,
    regenerateGroupInviteToken,
    removeUploadedFiles,
    requireSession,
    requireSessionUsernameMatch,
    searchUsers,
    searchPublicGroups,
    searchPublicChannels,
    setChatMuted,
    storageEncryption,
    updateGroupChat,
    updateChannelChat,
    unhideChat,
    uploadAvatar,
    storeAvatarFile = deps.storeAvatarFile,
    setChatMemberRole,
    getSetting,
    REMOTE_CHANNELS,
    getMessages,
    remoteChannelManager,
    upsertRemoteChannelSource,
    writeAdminAuditLog = null,
  } = deps;
  const MODERATOR_ROLES = new Set(["owner", "admin", "operator"]);
  const isModeratorRole = (role: any) =>
    MODERATOR_ROLES.has(String(role || "").trim().toLowerCase());
  const recordModerationAudit = async (entry: any) => {
    if (typeof writeAdminAuditLog !== "function") return;
    try {
      const r: any = writeAdminAuditLog(entry);
      if (r && typeof r.then === "function") await r;
    } catch {
      // Audit logging must never break request flows
    }
  };

  const resolveMaybePromise = async (value) =>
    value && typeof value.then === "function" ? await value : value;

  const membershipService: any = createMembershipService({
    getChatById: (id) => findChatById(id),
    listChatMembers,
    addChatMember,
    removeChatMember,
    updateChatMemberRole: setChatMemberRole,
    findUserById,
    findUserByUsername,
    findGroupByInviteToken: (tok) => findChatByInviteTarget(tok),
    addSystemMessage: (chatId, body, userId) =>
      createMessage(chatId, userId, body, null, null, null, { allowPlaintextSystemMessage: true }),
  });

  const deletionService: any = createDeletionService({
    deleteChatById,
    deleteUserById,
    findChatById: (id) => findChatById(id),
    findUserById,
    listChatMembers,
    listChatsForUser,
  });

  const resolveClientBaseOrigin = (req) => {
    const referer: any = String(req.headers?.referer || "").trim();
    let refererOrigin = "";
    if (referer) {
      try {
        refererOrigin = new URL(referer).origin;
      } catch {
        refererOrigin = "";
      }
    }

    const originHeader: any = String(req.headers?.origin || "").trim();
    const forwardedProto: any = String(req.headers?.["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim();
    const forwardedHost: any = String(req.headers?.["x-forwarded-host"] || "")
      .split(",")[0]
      .trim();
    const fallbackOrigin = `${forwardedProto || req.protocol}://${forwardedHost || req.get("host")}`;
    const origin = refererOrigin || originHeader || fallbackOrigin;
    // Remove trailing slashes safely without ReDoS vulnerability
    return origin.endsWith("/") ? origin.slice(0, -1) : origin;
  };
  const normalizeGroupAvatarUrl = (value) => {
    const raw: any = String(value || "").trim();
    if (!raw) return null;
    if (raw.startsWith("/api/uploads/avatars/")) return raw;
    if (raw.startsWith("/uploads/avatars/")) return `/api${raw}`;
    return raw;
  };
  const normalizeInviteUsername = (value) => {
    const cleaned: any = String(value || "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase();
    // Limit length to prevent ReDoS attacks
    return cleaned.slice(0, 100);
  };
  const decodeInviteTarget = (value) => {
    const target: any = String(value || "").trim();
    try {
      return decodeURIComponent(target);
    } catch {
      return target;
    }
  };
  const isPublicChat = (chat) =>
    String(chat?.group_visibility || "public").trim().toLowerCase() ===
    "public";
  const isRemoteChannelAvailable = () =>
    Boolean(REMOTE_CHANNELS?.enabled);
  const isTelegramAvailable = () =>
    Boolean(REMOTE_CHANNELS?.enabled && REMOTE_CHANNELS?.telegramConfigured);
  const normalizeCreateRemoteChannel = async ({
    remoteChannel,
    chatType,
    visibility,
  }: any) => {
    if (
      chatType !== "channel" ||
      !remoteChannel ||
      typeof remoteChannel !== "object"
    ) {
      return { shouldSave: false };
    }

    const enabled: any = Boolean(remoteChannel.enabled);
    const rawSource: any = String(
      remoteChannel.source || remoteChannel.sourceRaw || "",
    ).trim();
    const syncMetadata = enabled && Boolean(remoteChannel.syncMetadata);
    const streamMedia = enabled && Boolean(getSetting("FILE_UPLOAD") && remoteChannel.streamMedia);
    const shouldSave: any = Boolean(
      enabled || rawSource || syncMetadata || streamMedia,
    );
    if (!shouldSave) return { shouldSave: false };

    if (!isRemoteChannelAvailable()) {
      return {
        shouldSave: true,
        error: "Remote Channel is not configured on this server.",
        status: 503,
      };
    }
    // REMOTE_CHANNEL_UI=false hides the user-facing UI; only server admins
    // (admin panel routes) may configure mirroring then.
    if (!getSetting("REMOTE_CHANNEL_UI")) {
      return {
        shouldSave: true,
        error: "Remote Channel is managed by server admins.",
        status: 403,
      };
    }
    if (enabled && String(visibility || "").toLowerCase() === "private") {
      return {
        shouldSave: true,
        error: "Remote Channel can only be enabled for public channels.",
        status: 400,
      };
    }

    const provider: any = String(remoteChannel.provider || "telegram").toLowerCase();
    if (provider !== "telegram" && provider !== "nextdesk") {
      return {
        shouldSave: true,
        error: "Remote Channel source is invalid.",
        status: 400,
      };
    }

    if (provider === "telegram" && !isTelegramAvailable()) {
      return {
        shouldSave: true,
        error: "Telegram Remote Channel is not configured on this server.",
        status: 503,
      };
    }

    let normalized: any = {
      ok: true,
      sourceRaw: rawSource,
      sourceChatId: "",
      sourceUsername: "",
      sourceUrl: "",
    };

    if (provider === "telegram") {
      if (enabled) {
        normalized = normalizeTelegramSource(rawSource);
        if (!normalized.ok) {
          return { shouldSave: true, error: normalized.error, status: 400 };
        }
      } else if (rawSource) {
        const optionalNormalized: any = normalizeTelegramSource(rawSource);
        if (optionalNormalized.ok) normalized = optionalNormalized;
      }
      if (enabled && !normalized.sourceChatId && !normalized.sourceUsername) {
        return {
          shouldSave: true,
          error: "Telegram source is required.",
          status: 400,
        };
      }
    } else {
      // provider === "nextdesk"
      if (enabled) {
        normalized = normalizeNextDeskSource(rawSource);
        if (!normalized.ok) {
          return { shouldSave: true, error: normalized.error, status: 400 };
        }
        // Resolve the actual channel username from the target server.
        const resolved: any = await resolveNextDeskSource(
          normalized.sourceUrl,
          normalized.inviteTarget,
        );
        if (!resolved.ok) {
          return { shouldSave: true, error: resolved.error, status: 400 };
        }
        normalized = { ...normalized, sourceUsername: resolved.sourceUsername };
      } else if (rawSource) {
        const optionalNormalized: any = normalizeNextDeskSource(rawSource);
        if (optionalNormalized.ok) normalized = optionalNormalized;
      }
      if (enabled && !normalized.sourceUrl) {
        return {
          shouldSave: true,
          error: "NextDesk source URL is required.",
          status: 400,
        };
      }
    }

    return {
      shouldSave: true,
      enabled,
      provider,
      sourceRaw: normalized.sourceRaw,
      sourceChatId: normalized.sourceChatId || "",
      sourceUsername: normalized.sourceUsername || "",
      sourceUrl: normalized.sourceUrl || "",
      syncMetadata,
      streamMedia,
    };
  };
  const buildGroupInviteLink = (baseOrigin: any, chat: any, inviteToken?: any) => {
    const username: any = normalizeInviteUsername(chat?.group_username);
    if (isPublicChat(chat) && username) {
      return `${baseOrigin}/invite/${encodeURIComponent(username)}`;
    }
    const token: any = String(inviteToken ?? chat?.invite_token ?? "").trim();
    return token ? `${baseOrigin}/invite/${encodeURIComponent(token)}` : "";
  };
  const findPublicChatByInviteUsername = async (value) => {
    const username: any = normalizeInviteUsername(value);
    if (!username) return null;
    const rawChat: any = findChatByGroupUsername(username);
    const chat = rawChat && typeof rawChat.then === "function" ? await rawChat : rawChat;
    if (!chat || !isPublicChat(chat)) return null;
    return chat;
  };
  const findChatByInviteTarget = async (value) => {
    const target: any = decodeInviteTarget(value);
    if (!target) return null;
    if (target.startsWith("@")) return findPublicChatByInviteUsername(target);

    const rawChat: any = findChatByInviteToken(target);
    const chat = rawChat && typeof rawChat.then === "function" ? await rawChat : rawChat;
    return chat || findPublicChatByInviteUsername(target);
  };
  const emitChatListChangedToChatParticipants = (chatId, extraUsernames: any = []) => {
    const rawMembers: any = listChatMembers(chatId);
    const processMembers = (members) => {
      const memberList = Array.isArray(members) ? members : [];
      const memberUsernames: any = memberList
        .map((member) => String(member?.username || "").toLowerCase())
        .filter(Boolean);
      const targets: any = new Set([
        ...memberUsernames,
        ...(Array.isArray(extraUsernames) ? extraUsernames : [])
          .map((value) => String(value || "").toLowerCase())
          .filter(Boolean),
      ]);
      targets.forEach((targetUsername) => {
        try {
          emitSseEvent(targetUsername, { type: "chat_list_changed", chatId });
        } catch {
          // ignore realtime list errors
        }
      });
    };

    if (rawMembers && typeof rawMembers.then === "function") {
      rawMembers.then(processMembers).catch(() => {});
    } else {
      processMembers(rawMembers);
    }
  };

  app.get("/api/chats", async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const username: any = req.query.username?.toString();
    if (!username) {
      return res.status(400).json({ error: "Username is required." });
    }
    if (!requireSessionUsernameMatch(res, session, username)) return;

    const rawUser: any = findUserByUsername(username.toLowerCase());
    const user = rawUser && typeof rawUser.then === "function" ? await rawUser : rawUser;
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const rawConvs: any = listChatsForUser(user.id);
    const convs = (rawConvs && typeof rawConvs.then === "function" ? await rawConvs : rawConvs) || [];
    const rawMembersMap: any = listChatMembersForChats(convs.map((c) => c.id));
    const membersMap = (rawMembersMap && typeof rawMembersMap.then === "function" ? await rawMembersMap : rawMembersMap) || new Map<any, any>();
    const chats: any = convs.map((conv) => {
      const members: any = (membersMap.get(conv.id) || []).map((member) => ({
        ...member,
        avatar_url: ensureAvatarExists(member.id, member.avatar_url),
        status:
          typeof isConnected === "function" && member?.username && isConnected(member.username) && String(member?.status || "online").toLowerCase() !== "invisible"
            ? "online"
            : "offline",
      }));
      return { ...conv, members };
    });

    const lastMessageIds: any = chats
      .map((chat) => chat.last_message_id)
      .filter(Boolean);

    // Missing-file cleanup + ffprobe hydration used to run inline (and could
    // re-run listChatsForUser). Defer them like GET /api/messages so the list
    // response is not blocked on disk walks / ffprobe. SSE chat_message_deleted
    // and the next list fetch pick up cleanup results.
    if (lastMessageIds.length) {
      setImmediate(() => {
        try {
          const cleanup: any = cleanupMissingMessageFiles(lastMessageIds);
          if (cleanup.changed && cleanup.deletedByChat?.size) {
            cleanup.deletedByChat.forEach((messageIds, chatId) => {
              emitChatEvent(chatId, {
                type: "chat_message_deleted",
                chatId,
                messageIds,
              });
            });
          }
        } catch {
          // best-effort background cleanup — never crash the server
        }

        // Re-read file rows after cleanup so we do not probe deleted messages.
        try {
          const rows: any = listMessageFilesByMessageIds(lastMessageIds);
          void hydrateMissingVideoMetadata(rows);
        } catch {
          // best-effort background hydrate
        }
      });
    }

    // Serve stored metadata only — do not await ffprobe on the request path.
    const rawLastFiles: any = listMessageFilesByMessageIds(lastMessageIds);
    const lastFiles = (rawLastFiles && typeof rawLastFiles.then === "function" ? await rawLastFiles : rawLastFiles) || [];

    const filesByMessageId: any = {};
    for (const file of lastFiles) {
      const messageId = file.message_id;
      if (!filesByMessageId[messageId]) filesByMessageId[messageId] = [];

      const driver = file.storage_driver;
      const storageKey = file.storage_key;
      const thumbKey = file.thumb_storage_key || file.thumbStorageKey;
      let fileUrl = `/api/uploads/messages/${file.stored_name}`;
      let thumbUrl: any = await resolveThumbUrl({
        storageProvider: deps.storageProvider,
        file,
        thumbKey,
        fileId: file.id,
      });
      if (
        (driver === "remote" || driver === "s3") &&
        deps.storageProvider &&
        typeof deps.storageProvider.getDownloadUrl === "function"
      ) {
        if (storageKey) {
          try {
            fileUrl = await deps.storageProvider.getDownloadUrl(storageKey);
          } catch (_) {}
        }
      }

      filesByMessageId[messageId].push({
        id: file.id,
        kind: file.kind,
        name: file.original_name,
        mimeType: file.mime_type,
        processing: isVideoFileProcessing(file),
        sizeBytes: Number(file.size_bytes || 0),
        width: Number.isFinite(Number(file.width_px))
          ? Number(file.width_px)
          : null,
        height: Number.isFinite(Number(file.height_px))
          ? Number(file.height_px)
          : null,
        durationSeconds: Number.isFinite(Number(file.duration_seconds))
          ? Number(file.duration_seconds)
          : null,
        expiresAt: file.expires_at || null,
        thumbStorageKey: thumbKey || null,
        thumbUrl: thumbUrl || null,
        url: fileUrl,
      });
    }

    const enrichedChats: any = chats.map((chat) => ({
      ...chat,
      last_message_files:
        filesByMessageId[chat.last_message_id] || [],
    }));

    res.json({ chats: enrichedChats });
  });

  app.get("/api/chats/saved", async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const username: any = req.query.username?.toString();
    if (!username) {
      return res.status(400).json({ error: "Username is required." });
    }
    if (!requireSessionUsernameMatch(res, session, username)) return;

    const rawUser: any = findUserByUsername(String(username || "").toLowerCase());
    const user = rawUser && typeof rawUser.then === "function" ? await rawUser : rawUser;
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const rawSavedChat: any = ensureSavedChatForUser(user.id);
    const savedChat = rawSavedChat && typeof rawSavedChat.then === "function" ? await rawSavedChat : rawSavedChat;
    if (!savedChat?.id) {
      return res.status(500).json({ error: "Unable to open saved messages." });
    }
    const unhideRes: any = unhideChat(user.id, savedChat.id);
    if (unhideRes && typeof unhideRes.then === "function") await unhideRes;

    return res.json({ id: savedChat.id });
  });

  app.post("/api/chats/dm", async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const { from, to } = req.body || {};
    if (!from || !to) {
      return res.status(400).json({ error: "Both users are required." });
    }

    if (!requireSessionUsernameMatch(res, session, from)) return;

    const rawFromUser: any = findUserByUsername(from.toLowerCase());
    const fromUser = rawFromUser && typeof rawFromUser.then === "function" ? await rawFromUser : rawFromUser;
    const rawToUser: any = findUserByUsername(to.toLowerCase());
    const toUser = rawToUser && typeof rawToUser.then === "function" ? await rawToUser : rawToUser;
    if (!fromUser || !toUser) {
      return res.status(404).json({ error: "User not found." });
    }

    // Strictly scope direct-message creation to the "direct" channel so a
    // plain DM never reuses or resurrects an existing support ticket thread.
    const rawExistingId: any = findDmChat(fromUser.id, toUser.id, { channel: "direct" });
    const existingId = rawExistingId && typeof rawExistingId.then === "function" ? await rawExistingId : rawExistingId;
    if (existingId) {
      // Unhide the chat for both users (in case it was previously deleted)
      const u1: any = unhideChat(fromUser.id, existingId);
      if (u1 && typeof u1.then === "function") await u1;
      const u2: any = unhideChat(toUser.id, existingId);
      if (u2 && typeof u2.then === "function") await u2;

      return res.json({ id: existingId, channel: "direct" });
    }

    const rawChatId: any = createChat(null, "dm", { channel: "direct" });
    const chatId = rawChatId && typeof rawChatId.then === "function" ? await rawChatId : rawChatId;
    if (!chatId) {
      return res.status(500).json({ error: "Failed to create chat." });
    }

    const m1: any = addChatMember(chatId, fromUser.id, "owner");
    if (m1 && typeof m1.then === "function") await m1;
    const m2: any = addChatMember(chatId, toUser.id, "member");
    if (m2 && typeof m2.then === "function") await m2;

    res.json({ id: chatId, channel: "direct" });
  });

  app.post("/api/chats", async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const { name, type, members = [], creator } = req.body || {};
    if (!creator) {
      return res.status(400).json({ error: "Creator is required." });
    }

    if (!requireSessionUsernameMatch(res, session, creator)) return;

    const rawCreatorUser: any = findUserByUsername(creator.toLowerCase());
    const creatorUser = rawCreatorUser && typeof rawCreatorUser.then === "function" ? await rawCreatorUser : rawCreatorUser;
    if (!creatorUser) {
      return res.status(404).json({ error: "Creator not found." });
    }

    const normalizedType = type === "channel" ? "channel" : "group";
    const rawChatId: any = createChat(name || "Untitled", normalizedType);
    const chatId = rawChatId && typeof rawChatId.then === "function" ? await rawChatId : rawChatId;

    const m1: any = addChatMember(chatId, creatorUser.id, "owner");
    if (m1 && typeof m1.then === "function") await m1;

    const memberSet: any = new Set(
      members.map((value) => value.toString().toLowerCase()),
    );
    memberSet.delete(creatorUser.username);

    for (const username of memberSet) {
      const rawMember: any = findUserByUsername(username);
      const member = rawMember && typeof rawMember.then === "function" ? await rawMember : rawMember;
      if (member) {
        const m: any = addChatMember(chatId, member.id, "member");
        if (m && typeof m.then === "function") await m;
      }
    }

    res.json({ id: chatId });
  });

  app.post("/api/chats/group", async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const {
      type,
      creator,
      nickname,
      username,
      visibility,
      allowMemberInvites = true,
      groupColor,
      color,
      members = [],
      remoteChannel = null,
    } = req.body || {};

    if (!creator) {
      return res.status(400).json({ error: "Creator is required." });
    }
    if (!requireSessionUsernameMatch(res, session, creator)) return;

    const rawCreatorUser: any = findUserByUsername(String(creator).toLowerCase());
    const creatorUser = rawCreatorUser && typeof rawCreatorUser.then === "function" ? await rawCreatorUser : rawCreatorUser;
    if (!creatorUser) {
      return res.status(404).json({ error: "Creator not found." });
    }

    const normalizedType =
      String(type || "group").toLowerCase() === "channel" ? "channel" : "group";
    const label = normalizedType === "channel" ? "Channel" : "Group";
    const groupNickname: any = String(nickname || "").trim();
    const groupUsername: any = String(username || "")
      .trim()
      .toLowerCase();
    if (!groupNickname) {
      return res.status(400).json({ error: `${label} nickname is required.` });
    }
    if (!groupUsername) {
      return res.status(400).json({ error: `${label} username is required.` });
    }
    if (groupUsername.length < 3) {
      return res
        .status(400)
        .json({ error: `${label} username must be at least 3 characters.` });
    }
    if (!USERNAME_REGEX.test(groupUsername)) {
      return res.status(400).json({
        error:
          `${label} username can only include english letters, numbers, dot (.), and underscore (_).`,
      });
    }

    const rawExistingUser: any = findUserByUsername(groupUsername);
    const existingUser = rawExistingUser && typeof rawExistingUser.then === "function" ? await rawExistingUser : rawExistingUser;
    if (existingUser) {
      return res.status(409).json({ error: `${label} username already exists.` });
    }

    const rawExistingGroup: any = findChatByGroupUsername(groupUsername);
    const existingGroup = rawExistingGroup && typeof rawExistingGroup.then === "function" ? await rawExistingGroup : rawExistingGroup;
    if (existingGroup) {
      return res.status(409).json({ error: `${label} username already exists.` });
    }

    const normalizedVisibility =
      String(visibility || "").toLowerCase() === "private"
        ? "private"
        : "public";
    const remoteChannelConfig: any = await normalizeCreateRemoteChannel({
      remoteChannel,
      chatType: normalizedType,
      visibility: normalizedVisibility,
    });
    if (remoteChannelConfig.error) {
      return res
        .status(remoteChannelConfig.status || 400)
        .json({ error: remoteChannelConfig.error });
    }
    const suppliedGroupColor: any = String(groupColor || color || "")
      .trim()
      .toLowerCase();
    const normalizedGroupColor = Array.isArray(USER_COLORS) &&
      USER_COLORS.includes(suppliedGroupColor)
      ? suppliedGroupColor
      : "";
    const inviteToken: any = createInviteToken(crypto);
    const rawChatId: any = createChat(groupNickname, normalizedType, {
      groupUsername,
      groupVisibility: normalizedVisibility,
      inviteToken,
      createdByUserId: creatorUser.id,
      groupColor: normalizedGroupColor,
      allowMemberInvites: Boolean(allowMemberInvites),
    });
    const chatId = rawChatId && typeof rawChatId.then === "function" ? await rawChatId : rawChatId;

    if (!chatId) {
      return res.status(500).json({ error: `Failed to create ${label.toLowerCase()}.` });
    }

    const mOwner: any = addChatMember(chatId, creatorUser.id, "owner");
    if (mOwner && typeof mOwner.then === "function") await mOwner;

    const memberSet: any = new Set(
      (Array.isArray(members) ? members : [])
        .map((value) => String(value || "").toLowerCase())
        .filter(Boolean),
    );
    memberSet.delete(String(creatorUser.username || "").toLowerCase());
    for (const memberUsername of memberSet) {
      const rawMember: any = findUserByUsername(memberUsername);
      const member = rawMember && typeof rawMember.then === "function" ? await rawMember : rawMember;
      if (member) {
        const m: any = addChatMember(chatId, member.id, "member");
        if (m && typeof m.then === "function") await m;
      }
    }

    if (remoteChannelConfig.shouldSave) {
      let remoteSource: any = null;
      try {
        remoteSource = await resolveMaybePromise(
          upsertRemoteChannelSource({
            chatId,
            provider: remoteChannelConfig.provider,
            sourceRaw: remoteChannelConfig.sourceRaw,
            sourceChatId: remoteChannelConfig.sourceChatId,
            sourceUsername: remoteChannelConfig.sourceUsername,
            sourceUrl: remoteChannelConfig.sourceUrl || "",
            syncMetadata: remoteChannelConfig.syncMetadata,
            streamMedia: remoteChannelConfig.streamMedia,
            enabled: remoteChannelConfig.enabled,
          }),
        );
        if (
          remoteChannelConfig.enabled &&
          remoteChannelConfig.provider === "telegram" &&
          remoteChannelConfig.syncMetadata &&
          typeof remoteChannelManager?.syncSourceMetadata === "function"
        ) {
          await remoteChannelManager.syncSourceMetadata(remoteSource?.id);
        }
      } catch (error) {
        await resolveMaybePromise(deleteChatById(chatId));
        return res.status(400).json({
          error: remoteChannelConfig.syncMetadata
            ? `Unable to sync Telegram metadata: ${
                error?.message || "Unknown error"
              }`
            : error?.message || "Unable to configure Remote Channel.",
        });
      }
    }

    emitChatListChangedToChatParticipants(chatId);

    const createdChat: any = await resolveMaybePromise(findChatById(chatId));
    const baseOrigin: any = resolveClientBaseOrigin(req);
    const inviteLink: any = buildGroupInviteLink(baseOrigin, createdChat, inviteToken);
    return res.json({
      id: chatId,
      inviteToken,
      inviteLink,
      color: createdChat?.group_color || normalizedGroupColor || "#10b981",
      visibility: normalizedVisibility,
    });
  });

  app.get("/api/groups/invite/:token", async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const target: any = String(req.params?.token || "").trim();
    if (!target) {
      return res.status(400).json({ error: "Invite link is required." });
    }

    const rawChat: any = findChatByInviteTarget(target);
    const chat = rawChat && typeof rawChat.then === "function" ? await rawChat : rawChat;
    if (!chat) {
      return res.status(404).json({ error: "Invite link is invalid." });
    }

    const rawUser: any = findUserByUsername(String(session.username || "").toLowerCase());
    const user = rawUser && typeof rawUser.then === "function" ? await rawUser : rawUser;
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const rawMembers: any = listChatMembers(chat.id);
    const memberList = (rawMembers && typeof rawMembers.then === "function" ? await rawMembers : rawMembers) || [];
    const members: any = memberList.map((member) => ({
      ...member,
      avatar_url: ensureAvatarExists(member.id, member.avatar_url),
    }));
    const label = chat.type === "channel" ? "Channel" : "Group";

    const rawMemberCheck: any = isMember(chat.id, user.id);

    return res.json({
      group: {
        id: chat.id,
        name: chat.name || label,
        type: chat.type || "group",
        username: chat.group_username || "",
        color: chat.group_color || "#10b981",
        avatarUrl: normalizeGroupAvatarUrl(chat.group_avatar_url),
        verified: Boolean(chat.verified),
        visibility: chat.group_visibility || "public",
        allowMemberInvites: Boolean(Number(chat.allow_member_invites || 0)),
        membersCount: members.length,
      },
      alreadyMember:
        rawMemberCheck && typeof rawMemberCheck.then === "function"
          ? await rawMemberCheck
          : rawMemberCheck,
    });
  });

  app.post("/api/groups/invite/:token/join", async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const target: any = String(req.params?.token || "").trim();
    const suppliedUsername: any = req.body?.username?.toString();
    if (suppliedUsername && !requireSessionUsernameMatch(res, session, suppliedUsername)) {
      return;
    }
    if (!target) {
      return res.status(400).json({ error: "Invite link is required." });
    }

    const chat: any = await findChatByInviteTarget(target);
    if (!chat) {
      return res.status(404).json({ error: "Invite link is invalid." });
    }

    const rawUser: any = findUserByUsername(String(session.username || "").toLowerCase());
    const user = rawUser && typeof rawUser.then === "function" ? await rawUser : rawUser;
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const chatId = chat.id;
    // Re-show chats that were previously hidden from this user's list.
    const rawUnhide: any = unhideChat(user.id, chatId);
    if (rawUnhide && typeof rawUnhide.then === "function") await rawUnhide;
    const rawRemoved: any = isGroupMemberRemoved(chatId, user.id);
    const removed = rawRemoved && typeof rawRemoved.then === "function" ? await rawRemoved : rawRemoved;
    if (removed) {
      return res.status(403).json({
        error: "You were removed from this group. Only the owner can re-add you.",
      });
    }
    const rawWasMember: any = isMember(chatId, user.id);
    const wasMember = rawWasMember && typeof rawWasMember.then === "function" ? await rawWasMember : rawWasMember;
    if (!wasMember) {
      const result: any = await membershipService.joinByInvite({ inviteToken: target, userId: user.id });
      result.sseEvents.forEach((ev) => {
        try {
          emitSseEvent(ev.targetUsername, ev.payload);
        } catch (_) {}
      });
    }
    const rawUnhideAgain: any = unhideChat(user.id, chatId);
    if (rawUnhideAgain && typeof rawUnhideAgain.then === "function") await rawUnhideAgain;
    await emitChatListChangedToChatParticipants(chatId);

    return res.json({
      ok: true,
      id: chatId,
      alreadyMember: wasMember,
    });
  });

  // Public unauthenticated metadata endpoint used by remote NextDesk servers
  // to sync channel name and avatar when "Sync Channel Metadata" is enabled.
  // Only works for public channels on servers with SIGN_UP enabled.
  app.get("/api/channels/:username/meta", async (req, res) => {
    if (!getSetting("SIGN_UP")) {
      // Private server — refuse to expose channel metadata to remote servers.
      return res.status(403).json({ error: "This server is private." });
    }

    const username: any = String(req.params?.username || "").trim().toLowerCase();
    if (!username) {
      return res.status(400).json({ error: "Channel username is required." });
    }

    const chat: any = await resolveMaybePromise(findChatByGroupUsername(username));
    if (
      !chat ||
      String(chat.type || "").toLowerCase() !== "channel" ||
      !isPublicChat(chat)
    ) {
      return res.status(404).json({ error: "Channel not found." });
    }

    // Cache for 5 minutes — metadata changes rarely and this endpoint is public.
    res.setHeader("Cache-Control", "public, max-age=300");

    return res.json({
      name: chat.name || "Channel",
      username: chat.group_username || "",
      avatarUrl: normalizeGroupAvatarUrl(chat.group_avatar_url) || null,
      color: chat.group_color || "#10b981",
    });
  });

  // Public unauthenticated messages endpoint used by remote NextDesk servers
  app.get("/api/channels/:username/messages", async (req, res) => {
    if (!getSetting("SIGN_UP")) {
      return res.status(403).json({ error: "This server is private." });
    }

    const username: any = String(req.params?.username || "").trim().toLowerCase();
    if (!username) {
      return res.status(400).json({ error: "Channel username is required." });
    }

    const chat: any = await resolveMaybePromise(findChatByGroupUsername(username));
    if (
      !chat ||
      String(chat.type || "").toLowerCase() !== "channel" ||
      !isPublicChat(chat)
    ) {
      return res.status(404).json({ error: "Channel not found." });
    }

    const afterId = req.query.afterId || null;
    const limitRaw: any = Number(req.query.limit || 50);
    const limit: any = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 50));

    let afterCreatedAt: any = null;
    if (afterId && typeof findMessageById === "function") {
      try {
        const anchor: any = await resolveMaybePromise(findMessageById(afterId));
        if (anchor && String(anchor.chat_id || "") === String(chat.id || "")) {
          afterCreatedAt = anchor.created_at || null;
        }
      } catch {
        afterCreatedAt = null;
      }
    }

    const msgData: any = await resolveMaybePromise(
      getMessages(chat.id, {
        afterId: afterId || null,
        afterCreatedAt: afterCreatedAt || null,
        limit,
        viewerUserId: null,
      }),
    );
    const messages = Array.isArray(msgData?.messages)
      ? msgData.messages
      : Array.isArray(msgData)
        ? msgData
        : [];

    // Return only the fields the remote poller needs — no auth-sensitive data.
    const publicMessages: any = messages.map((msg) => ({
      id: msg.id,
      body: String(msg.body || "").trim(),
      createdAt: msg.created_at || null,
      clientRequestId: msg.client_request_id || null,
    }));

    return res.json({
      channelUsername: chat.group_username || username,
      messages: publicMessages,
      hasMore: publicMessages.length === limit,
    });
  });

  app.get("/api/chats/:chatId/preview", validateUuidParams("chatId"), async (req, res) => {
    const missingPreview = String(req.query.allowMissing || "").toLowerCase() === "true" ||
      String(req.query.allowMissing || "") === "1";
    const respondChatNotFound = () =>
      missingPreview
        ? res.json({ missing: true })
        : res.status(404).json({ error: "Chat not found." });

    const session: any = await requireSession(req, res);
    if (!session) return;

    const chatId = req.params.chatId;
    const username: any = String(req.query.username || "").trim();
    if (!username) {
      return res.status(400).json({ error: "Chat id and username are required." });
    }
    if (!requireSessionUsernameMatch(res, session, username)) return;

    const rawUser: any = findUserByUsername(username.toLowerCase());
    const user = rawUser && typeof rawUser.then === "function" ? await rawUser : rawUser;
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const rawChat: any = findChatById(chatId);
    const chat = rawChat && typeof rawChat.then === "function" ? await rawChat : rawChat;
    if (!chat || !["group", "channel"].includes(String(chat.type || "").toLowerCase())) {
      return respondChatNotFound();
    }

    const rawMemberFlag: any = isMember(chatId, user.id);
    const isMemberFlag = rawMemberFlag && typeof rawMemberFlag.then === "function" ? await rawMemberFlag : rawMemberFlag;
    const visibility: any = String(chat.group_visibility || "public").trim().toLowerCase();
    if (!isMemberFlag && visibility !== "public") {
      return respondChatNotFound();
    }

    const rawMembers: any = listChatMembers(chatId);
    const members = (rawMembers && typeof rawMembers.then === "function" ? await rawMembers : rawMembers) || [];

    return res.json({
      id: chat.id,
      type: chat.type === "channel" ? "channel" : "group",
      name: chat.name || (chat.type === "channel" ? "Channel" : "Group"),
      username: chat.group_username || "",
      visibility: chat.group_visibility || "public",
      color: chat.group_color || "#10b981",
      avatarUrl: normalizeGroupAvatarUrl(chat.group_avatar_url),
      inviteToken: chat.invite_token || "",
      membersCount: members.length,
      isMember: Boolean(isMemberFlag),
    });
  });

  app.get("/api/chats/group/:chatId/invite-link", validateUuidParams("chatId"), async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const chatId = req.params.chatId;

    const chat: any = await resolveMaybePromise(findChatById(chatId));
    if (!chat || (chat.type !== "group" && chat.type !== "channel")) {
      return res.status(404).json({ error: "Chat not found." });
    }

    const user: any = await resolveMaybePromise(
      findUserByUsername(String(session.username || "").toLowerCase()),
    );
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }
    if (!await resolveMaybePromise(isMember(chatId, user.id))) {
      return res.status(403).json({ error: "Not a member of this group." });
    }

    const members = (await resolveMaybePromise(listChatMembers(chatId))) || [];
    const label = chat.type === "channel" ? "channel" : "group";
    const isOwner: any = members.some(
      (member) =>
        member.id === user.id &&
        String(member.role || "").toLowerCase() === "owner",
    );
    const allowMemberInvites: any = Boolean(Number(chat.allow_member_invites || 0));
    if (!isOwner && !allowMemberInvites) {
      return res
        .status(403)
        .json({ error: `Only ${label} owner can share invite link.` });
    }

    const baseOrigin: any = resolveClientBaseOrigin(req);

    return res.json({
      inviteToken: chat.invite_token || "",
      inviteLink: buildGroupInviteLink(baseOrigin, chat),
      allowMemberInvites,
      isOwner,
    });
  });

  app.post("/api/chats/group/:chatId/regenerate-invite", validateUuidParams("chatId"), async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const chatId = req.params.chatId;
    const username: any = req.body?.username?.toString();
    if (!username) {
      return res.status(400).json({ error: "Chat id and username are required." });
    }
    if (!requireSessionUsernameMatch(res, session, username)) return;

    const user: any = await resolveMaybePromise(
      findUserByUsername(String(username || "").toLowerCase()),
    );
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }
    const chat: any = await resolveMaybePromise(findChatById(chatId));
    if (!chat || (chat.type !== "group" && chat.type !== "channel")) {
      return res.status(404).json({ error: "Chat not found." });
    }
    const members = (await resolveMaybePromise(listChatMembers(chatId))) || [];
    const label = chat.type === "channel" ? "channel" : "group";
    const isOwner: any = members.some(
      (member) =>
        member.id === user.id &&
        String(member.role || "").toLowerCase() === "owner",
    );
    if (!isOwner) {
      return res
        .status(403)
        .json({ error: `Only ${label} owner can regenerate invite link.` });
    }

    const inviteToken: any = createInviteToken(crypto);
    regenerateGroupInviteToken(chatId, inviteToken);
    const baseOrigin: any = resolveClientBaseOrigin(req);
    return res.json({
      ok: true,
      inviteToken,
      inviteLink: buildGroupInviteLink(baseOrigin, chat, inviteToken),
    });
  });

  app.put("/api/chats/group/:chatId", validateUuidParams("chatId"), async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const chatId = req.params.chatId;

    const {
      username,
      nickname,
      groupUsername,
      visibility,
      allowMemberInvites = true,
      members: memberUsernames = [],
    } = req.body || {};
    if (!username) {
      return res.status(400).json({ error: "Username is required." });
    }
    if (!requireSessionUsernameMatch(res, session, username)) return;

    const user: any = await resolveMaybePromise(
      findUserByUsername(String(username || "").toLowerCase()),
    );
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const chat: any = await resolveMaybePromise(findChatById(chatId));
    if (!chat || (chat.type !== "group" && chat.type !== "channel")) {
      return res.status(404).json({ error: "Chat not found." });
    }

    const chatMembers = (await resolveMaybePromise(listChatMembers(chatId))) || [];
    const label = chat.type === "channel" ? "Channel" : "Group";
    const isOwner: any = chatMembers.some(
      (member) =>
        member.id === user.id &&
        String(member.role || "").toLowerCase() === "owner",
    );
    if (!isOwner) {
      return res
        .status(403)
        .json({ error: `Only ${label.toLowerCase()} owner can edit this ${label.toLowerCase()}.` });
    }

    const normalizedNickname: any = String(nickname || "").trim();
    const normalizedGroupUsername: any = String(groupUsername || "")
      .trim()
      .toLowerCase();
    if (!normalizedNickname) {
      return res.status(400).json({ error: `${label} nickname is required.` });
    }
    if (normalizedGroupUsername.length < 3) {
      return res
        .status(400)
        .json({ error: `${label} username must be at least 3 characters.` });
    }
    if (!USERNAME_REGEX.test(normalizedGroupUsername)) {
      return res.status(400).json({
        error:
          `${label} username can only include english letters, numbers, dot (.), and underscore (_).`,
      });
    }

    const rawExistingUser: any = findUserByUsername(normalizedGroupUsername);
    const existingUser = rawExistingUser && typeof rawExistingUser.then === "function" ? await rawExistingUser : rawExistingUser;
    if (existingUser) {
      return res.status(409).json({ error: `${label} username already exists.` });
    }

    const rawExistingGroup: any = findChatByGroupUsername(normalizedGroupUsername);
    const existingGroup = rawExistingGroup && typeof rawExistingGroup.then === "function" ? await rawExistingGroup : rawExistingGroup;
    if (existingGroup && existingGroup.id !== chatId) {
      return res.status(409).json({ error: `${label} username already exists.` });
    }

    const updateFn = chat.type === "channel" ? updateChannelChat : updateGroupChat;
    const resUpdate: any = updateFn(chatId, {
      name: normalizedNickname,
      groupUsername: normalizedGroupUsername,
      groupVisibility: visibility,
      allowMemberInvites: Boolean(allowMemberInvites),
    });
    if (resUpdate && typeof resUpdate.then === "function") await resUpdate;

    const nextMembers: any = new Set(
      (Array.isArray(memberUsernames) ? memberUsernames : [])
        .map((item) => String(item || "").toLowerCase())
        .filter(Boolean),
    );
    nextMembers.delete(String(user.username || "").toLowerCase());
    for (const memberUsername of nextMembers) {
      const rawMember: any = findUserByUsername(memberUsername);
      const member = rawMember && typeof rawMember.then === "function" ? await rawMember : rawMember;
      if (!member) continue;
      const rawIsMem: any = isMember(chatId, member.id);
      const isMem = rawIsMem && typeof rawIsMem.then === "function" ? await rawIsMem : rawIsMem;
      if (isMem) {
        const u: any = unhideChat(member.id, chatId);
        if (u && typeof u.then === "function") await u;
        continue;
      }
      const c1: any = clearChatMemberLeft(chatId, member.id);
      if (c1 && typeof c1.then === "function") await c1;
      const c2: any = clearGroupMemberRemoved(chatId, member.id);
      if (c2 && typeof c2.then === "function") await c2;
      const u: any = unhideChat(member.id, chatId);
      if (u && typeof u.then === "function") await u;
      const a: any = addChatMember(chatId, member.id, "member");
      if (a && typeof a.then === "function") await a;
      if (chat.type === "group") {
        const body = `[[system:joined:${member.nickname || member.username}]]`;
        await resolveMaybePromise(createMessage(
          chatId,
          user.id,
          body,
          null,
          null,
          null,
          { allowPlaintextSystemMessage: true },
        ));
        emitChatEvent(chatId, {
          type: "chat_message",
          chatId,
          username: user.username,
          body,
        });
      }
      try {
        emitSseEvent(member.username, { type: "chat_list_changed", chatId });
      } catch {
        // ignore realtime list errors
      }
    }

    const updated: any = await resolveMaybePromise(findChatById(chatId));
    const baseOrigin: any = resolveClientBaseOrigin(req);
    emitChatListChangedToChatParticipants(chatId);
    return res.json({
      ok: true,
      group: updated,
      inviteToken: updated?.invite_token || "",
      inviteLink: buildGroupInviteLink(baseOrigin, updated),
    });
  });

  app.post("/api/chats/group/:chatId/leave", validateUuidParams("chatId"), async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const chatId = req.params.chatId;
    const username: any = req.body?.username?.toString();
    if (!username) {
      return res.status(400).json({ error: "Chat id and username are required." });
    }
    if (!requireSessionUsernameMatch(res, session, username)) return;

    const user: any = await resolveMaybePromise(findUserByUsername(String(username || "").toLowerCase()));
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const chat: any = await resolveMaybePromise(findChatById(chatId));
    if (!chat || (chat.type !== "group" && chat.type !== "channel")) {
      return res.status(404).json({ error: "Chat not found." });
    }
    if (!await resolveMaybePromise(isMember(chatId, user.id))) {
      return res.status(400).json({ error: "You are not a member of this group." });
    }

    const members = (await resolveMaybePromise(listChatMembers(chatId))) || [];
    const isOwner: any = members.some(
      (member) =>
        member.id === user.id &&
        String(member.role || "").toLowerCase() === "owner",
    );
    if (isOwner) {
      const remainingMembers: any = members.filter(
        (member) => member.id !== user.id,
      );
      if (remainingMembers.length === 0) {
        const result: any = await deletionService.deleteChat({ chatId });
        if (Array.isArray(result.storedFilesToRemove) && result.storedFilesToRemove.length > 0) {
          removeStoredFileNames(result.storedFilesToRemove);
        }
        if (result.avatarFileToRemove) {
          removeAvatarByUrl(result.avatarFileToRemove);
        }
        return res.json({ ok: true, deleted: true });
      }
      const nextOwner = crypto?.randomInt
        ? remainingMembers[crypto.randomInt(remainingMembers.length)]
        : remainingMembers[Math.floor(Math.random() * remainingMembers.length)];
      if (nextOwner?.id) {
        await resolveMaybePromise(setChatMemberRole(chatId, nextOwner.id, "owner"));
      }
    }

    await resolveMaybePromise(removeChatMember(chatId, user.id));
    await resolveMaybePromise(markChatMemberLeft(chatId, user.id));
    if (chat.type === "group") {
      const body = `[[system:left:${user.nickname || user.username}]]`;
      const messageId: any = await resolveMaybePromise(createMessage(
        chatId,
        user.id,
        body,
        null,
        null,
        null,
        { allowPlaintextSystemMessage: true },
      ));
      emitChatEvent(chatId, {
        type: "chat_message",
        chatId,
        messageId,
        username: user.username,
        userId: user.id,
        body,
      });
    }
    emitChatListChangedToChatParticipants(chatId, [user.username]);
    return res.json({ ok: true });
  });

  app.post("/api/chats/group/:chatId/delete", validateUuidParams("chatId"), async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const chatId = req.params.chatId;
    const username: any = req.body?.username?.toString();
    const password: any = req.body?.password?.toString();
    if (!username || !password) {
      return res.status(400).json({
        error: "Chat id, username, and password are required.",
      });
    }
    if (!requireSessionUsernameMatch(res, session, username)) return;

    const user: any = await resolveMaybePromise(findUserByUsername(String(username || "").toLowerCase()));
    if (!user || !(await resolveMaybePromise(bcrypt.compare(String(password || ""), user.password_hash)))) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const chat: any = await resolveMaybePromise(findChatById(chatId));
    if (!chat || (chat.type !== "group" && chat.type !== "channel")) {
      return res.status(404).json({ error: "Chat not found." });
    }

    const members = (await resolveMaybePromise(listChatMembers(chatId))) || [];
    const owner: any = members.find(
      (member) =>
        member.id === user.id &&
        String(member.role || "").toLowerCase() === "owner",
    );
    if (!owner) {
      return res
        .status(403)
        .json({ error: "Only the owner can delete this chat." });
    }

    const memberUsernames: any = members
      .map((member) => String(member?.username || "").toLowerCase())
      .filter(Boolean);

    const result: any = await deletionService.deleteChat({ chatId });
    if (Array.isArray(result.storedFilesToRemove) && result.storedFilesToRemove.length > 0) {
      removeStoredFileNames(result.storedFilesToRemove);
    }
    if (result.avatarFileToRemove) {
      removeAvatarByUrl(result.avatarFileToRemove);
    }
    result.sseEvents.forEach((ev) => {
      try {
        emitSseEvent(ev.targetUsername, ev.payload);
      } catch (_) {}
    });
    await recordModerationAudit({
      actorUserId: user.id,
      actorUsername: user.username,
      action: "chat.delete",
      targetType: "chat",
      targetLabel: chat.name || String(chatId),
      details: {
        chatId,
        type: chat.type,
        removedFiles: Array.isArray(result.storedFilesToRemove) ? result.storedFilesToRemove.length : 0,
      },
    });
    return res.json({ ok: true, deleted: true });
  });

  app.post("/api/chats/group/:chatId/remove-member", validateUuidParams("chatId"), async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const chatId = req.params.chatId;
    const username: any = req.body?.username?.toString();
    const targetUsername: any = req.body?.targetUsername?.toString();
    if (!username || !targetUsername) {
      return res.status(400).json({
        error: "Chat id, username, and targetUsername are required.",
      });
    }
    if (!requireSessionUsernameMatch(res, session, username)) return;

    const actor: any = await resolveMaybePromise(findUserByUsername(String(username || "").toLowerCase()));
    const target: any = await resolveMaybePromise(findUserByUsername(String(targetUsername || "").toLowerCase()));
    if (!actor || !target) {
      return res.status(404).json({ error: "User not found." });
    }
    const chat: any = await resolveMaybePromise(findChatById(chatId));
    if (!chat || (chat.type !== "group" && chat.type !== "channel")) {
      return res.status(404).json({ error: "Chat not found." });
    }

    const members = (await resolveMaybePromise(listChatMembers(chatId))) || [];
    const label = chat.type === "channel" ? "channel" : "group";
    const actorMember: any = members.find((member) => member.id === actor.id);
    if (!actorMember || String(actorMember.role || "").toLowerCase() !== "owner") {
      return res
        .status(403)
        .json({ error: `Only ${label} owner can remove members.` });
    }
    const targetMember: any = members.find((member) => member.id === target.id);
    if (!targetMember) {
      return res.status(400).json({ error: "Target user is not a group member." });
    }
    if (String(targetMember.role || "").toLowerCase() === "owner") {
      return res.status(400).json({ error: "Owner cannot be removed." });
    }

    await resolveMaybePromise(removeChatMember(chatId, target.id));
    await resolveMaybePromise(markGroupMemberRemoved(chatId, target.id, actor.id));
    if (chat.type === "group") {
      const body = `[[system:removed:${target.nickname || target.username}]]`;
      const messageId: any = await resolveMaybePromise(createMessage(
        chatId,
        actor.id,
        body,
        null,
        null,
        null,
        { allowPlaintextSystemMessage: true },
      ));
      emitChatEvent(chatId, {
        type: "chat_message",
        chatId,
        messageId,
        username: actor.username,
        userId: actor.id,
        body,
      });
    }
    emitChatListChangedToChatParticipants(chatId, [target.username]);
    return res.json({ ok: true });
  });

  app.post(
    "/api/chats/group/:chatId/avatar",
    validateUuidParams("chatId"),
    uploadAvatar.single("avatar"),
    async (req, res) => {
      const session: any = await requireSession(req, res);
      if (!session) {
        removeUploadedFiles(req.file ? [req.file] : [], avatarUploadRootDir);
        return;
      }

      const chatId = req.params.chatId;
      const username: any = req.body?.username?.toString();
      const file = req.file;
      if (!username) {
        removeUploadedFiles(file ? [file] : [], avatarUploadRootDir);
        return res
          .status(400)
          .json({ error: "Group chat id and username are required." });
      }
      if (!requireSessionUsernameMatch(res, session, username)) {
        removeUploadedFiles(file ? [file] : [], avatarUploadRootDir);
        return;
      }
      if (!file && !req.body?.avatarUrl) {
        return res.status(400).json({ error: "Avatar file is required." });
      }

      const chat: any = await resolveMaybePromise(findChatById(chatId));
      if (!chat || (chat.type !== "group" && chat.type !== "channel")) {
        removeUploadedFiles(file ? [file] : [], avatarUploadRootDir);
        return res.status(404).json({ error: "Chat not found." });
      }
      const user: any = await resolveMaybePromise(findUserByUsername(String(username || "").toLowerCase()));
      if (!user) {
        removeUploadedFiles(file ? [file] : [], avatarUploadRootDir);
        return res.status(404).json({ error: "User not found." });
      }
      const rawMembers: any = listChatMembers(chatId);
      const members = (rawMembers && typeof rawMembers.then === "function" ? await rawMembers : rawMembers) || [];
      const label = chat.type === "channel" ? "channel" : "group";
      const isOwner: any = members.some(
        (member) =>
          member.id === user.id &&
          String(member.role || "").toLowerCase() === "owner",
      );
      if (!isOwner) {
        removeUploadedFiles(file ? [file] : [], avatarUploadRootDir);
        return res
          .status(403)
          .json({ error: `Only ${label} owner can update ${label} avatar.` });
      }

      const directAvatarUrl: any = String(req.body?.avatarUrl || "").trim();
      let avatarUrl = "";

      if (directAvatarUrl) {
        const fileName: any = path.basename(directAvatarUrl);
        if (
          (!directAvatarUrl.startsWith("/api/uploads/avatars/") &&
            !directAvatarUrl.startsWith("/uploads/avatars/")) ||
          !fileName.startsWith("avatar-") ||
          fileName.includes("..")
        ) {
          return res.status(400).json({ error: "Invalid avatar URL." });
        }
        avatarUrl = directAvatarUrl.startsWith("/uploads/")
          ? `/api${directAvatarUrl}`
          : directAvatarUrl;
      } else {
        const avatarMime: any = String(file.mimetype || "").toLowerCase();
        if (!ALLOWED_AVATAR_MIME_TYPES.has(avatarMime)) {
          removeUploadedFiles([file], avatarUploadRootDir);
          return res
            .status(400)
            .json({ error: "Avatar must be a JPEG, PNG, GIF, WEBP, or BMP image." });
        }

        try {
          if (typeof storeAvatarFile === "function") {
            const stored: any = await storeAvatarFile(file);
            avatarUrl = stored.avatarUrl;
          } else {
            avatarUrl = `/api/uploads/avatars/${file.filename}`;
            storageEncryption?.encryptFileInPlace?.(file.path);
          }
        } catch {
          removeUploadedFiles([file], avatarUploadRootDir);
          return res
            .status(500)
            .json({ error: "Unable to store avatar securely." });
        }
      }

      if (String(chat.group_avatar_url || "").trim() && chat.group_avatar_url !== avatarUrl) {
        removeAvatarByUrl(chat.group_avatar_url);
      }

      const updateFn = chat.type === "channel" ? updateChannelChat : updateGroupChat;
      await resolveMaybePromise(
        updateFn(chatId, {
          name: chat.name,
          groupUsername: chat.group_username,
          groupVisibility: chat.group_visibility,
          allowMemberInvites: Boolean(Number(chat.allow_member_invites || 0)),
          groupAvatarUrl: avatarUrl,
        }),
      );
      const fileName: any = path.basename(avatarUrl);
      if (fileName && typeof removePendingPresignedUploads === "function") {
        removePendingPresignedUploads([
          `uploads/avatars/${fileName}`,
          // Legacy key from before uploads/avatars unification.
          `avatars/${fileName}`,
        ]);
      }
      emitChatListChangedToChatParticipants(chatId);

      return res.json({
        ok: true,
        avatarUrl,
        maxFileSizeBytes: AVATAR_FILE_LIMITS.maxFileSizeBytes,
      });
    },
  );

  app.delete("/api/chats/group/:chatId/avatar", validateUuidParams("chatId"), async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const chatId = req.params.chatId;
    const username: any = req.body?.username?.toString();
    if (!username) {
      return res
        .status(400)
        .json({ error: "Group chat id and username are required." });
    }
    if (!requireSessionUsernameMatch(res, session, username)) return;

    const chat: any = await resolveMaybePromise(findChatById(chatId));
    if (!chat || (chat.type !== "group" && chat.type !== "channel")) {
      return res.status(404).json({ error: "Chat not found." });
    }
    const user: any = await resolveMaybePromise(findUserByUsername(String(username || "").toLowerCase()));
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }
    const rawMembers: any = listChatMembers(chatId);
    const members = (rawMembers && typeof rawMembers.then === "function" ? await rawMembers : rawMembers) || [];
    const label = chat.type === "channel" ? "channel" : "group";
    const isOwner: any = members.some(
      (member) =>
        member.id === user.id &&
        String(member.role || "").toLowerCase() === "owner",
    );
    if (!isOwner) {
      return res
        .status(403)
        .json({ error: `Only ${label} owner can update ${label} avatar.` });
    }

    if (String(chat.group_avatar_url || "").trim()) {
      removeAvatarByUrl(chat.group_avatar_url);
    }
    const updateFn = chat.type === "channel" ? updateChannelChat : updateGroupChat;
    await resolveMaybePromise(
      updateFn(chatId, {
        name: chat.name,
        groupUsername: chat.group_username,
        groupVisibility: chat.group_visibility,
        allowMemberInvites: Boolean(Number(chat.allow_member_invites || 0)),
        groupAvatarUrl: null,
      }),
    );
    emitChatListChangedToChatParticipants(chatId);

    return res.json({
      ok: true,
      avatarUrl: null,
    });
  });

  app.put("/api/chats/:chatId/mute", validateUuidParams("chatId"), async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const chatId = req.params.chatId;
    const username: any = req.body?.username?.toString();
    const muted: any = Boolean(req.body?.muted);
    if (!username) {
      return res.status(400).json({ error: "Chat id and username are required." });
    }
    if (!requireSessionUsernameMatch(res, session, username)) return;

    const user: any = await resolveMaybePromise(findUserByUsername(String(username || "").toLowerCase()));
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const chat: any = await resolveMaybePromise(findChatById(chatId));
    if (!chat) {
      return res.status(404).json({ error: "Chat not found." });
    }
    if (!await resolveMaybePromise(isMember(chatId, user.id))) {
      return res.status(403).json({ error: "Not a member of this chat." });
    }

    await resolveMaybePromise(setChatMuted(user.id, chatId, muted));
    return res.json({ ok: true, chatId, muted });
  });

  app.post("/api/chats/hide", async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const { username, chatIds = [] } = req.body || {};
    if (!username || !Array.isArray(chatIds) || !chatIds.length) {
      return res
        .status(400)
        .json({ error: "Username and chatIds are required." });
    }

    if (!requireSessionUsernameMatch(res, session, username)) return;

    const user: any = await resolveMaybePromise(findUserByUsername(username.toLowerCase()));
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const cleanIds = chatIds.filter(Boolean);
    const resolvedChats: any[] = [];
    for (const cid of cleanIds) {
      const c: any = await resolveMaybePromise(findChatById(cid));
      if (c) resolvedChats.push(c);
    }

    const dmChats = resolvedChats.filter(
      (c) => String(c?.type || "").toLowerCase() === "dm",
    );
    if (dmChats.length > 0 && !isModeratorRole(user.role)) {
      return res.status(403).json({
        error: "Only moderators can delete threads.",
      });
    }

    await resolveMaybePromise(hideChatsForUser(user.id, cleanIds));

    if (dmChats.length > 0 && isModeratorRole(user.role)) {
      for (const dm of dmChats) {
        await recordModerationAudit({
          actorUserId: user.id,
          actorUsername: user.username,
          action: "thread.delete",
          targetType: "chat",
          targetLabel: String(dm.id),
          details: {
            chatId: dm.id,
            channel: dm.channel || "direct",
            departmentId: dm.department_id ?? null,
          },
        });
      }
    }

    res.json({ ok: true });
  });

  app.post("/api/chats/group/:chatId/join-public", validateUuidParams("chatId"), async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const chatId = req.params.chatId;
    const username: any = req.body?.username?.toString();
    if (!username) {
      return res.status(400).json({ error: "Group chat id and username are required." });
    }
    if (!requireSessionUsernameMatch(res, session, username)) return;

    const rawUser: any = findUserByUsername(String(username || "").toLowerCase());
    const user: any = await resolveMaybePromise(rawUser);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const rawChat: any = findChatById(chatId);
    const chat: any = await resolveMaybePromise(rawChat);
    if (!chat || (chat.type !== "group" && chat.type !== "channel")) {
      return res.status(404).json({ error: "Chat not found." });
    }
    if (String(chat.group_visibility || "").toLowerCase() !== "public") {
      return res.status(403).json({ error: "This group is private." });
    }
    const removed: any = await resolveMaybePromise(isGroupMemberRemoved(chatId, user.id));
    if (removed) {
      return res.status(403).json({
        error: "You were removed from this group. Only the owner can re-add you.",
      });
    }

    await resolveMaybePromise(unhideChat(user.id, chatId));
    const alreadyMember: any = Boolean(await resolveMaybePromise(isMember(chatId, user.id)));
    if (!alreadyMember) {
      await resolveMaybePromise(clearChatMemberLeft(chatId, user.id));
      await resolveMaybePromise(addChatMember(chatId, user.id, "member"));
      if (chat.type === "group") {
        const body = `[[system:joined:${user.nickname || user.username}]]`;
        await resolveMaybePromise(createMessage(
          chatId,
          user.id,
          body,
          null,
          null,
          null,
          { allowPlaintextSystemMessage: true },
        ));
        emitChatEvent(chatId, {
          type: "chat_message",
          chatId,
          username: user.username,
          body,
        });
      }
    }
    emitChatListChangedToChatParticipants(chatId);

    return res.json({
      ok: true,
      id: chatId,
      alreadyMember,
    });
  });


  // ─── Per-thread Files Gallery (members-only) ─────────────────────────────
  app.get(
    "/api/chats/:chatId/files",
    validateUuidParams("chatId"),
    async (req, res) => {
      const session: any = await requireSession(req, res);
      if (!session) return;

      const chatId = req.params.chatId;
      const username: any = req.query.username?.toString();
      if (!username) {
        return res.status(400).json({ error: "Username is required." });
      }
      if (!requireSessionUsernameMatch(res, session, username)) return;

      const user: any = await resolveMaybePromise(
        findUserByUsername(String(username).toLowerCase()),
      );
      if (!user) {
        return res.status(404).json({ error: "User not found." });
      }

      const member = await resolveMaybePromise(isMember(chatId, user.id));
      if (!member) {
        return res.status(403).json({ error: "Not a member of this chat." });
      }

      const limit = Math.min(Math.max(1, Number(req.query.limit) || 40), 100);
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const rawRows: any =
        typeof listChatFilesForUser === "function"
          ? await resolveMaybePromise(
              listChatFilesForUser(chatId, user.id, { limit, offset }),
            )
          : [];
      const total: number =
        typeof countChatFilesForUser === "function"
          ? Number(
              await resolveMaybePromise(countChatFilesForUser(chatId, user.id)),
            ) || 0
          : Array.isArray(rawRows)
            ? rawRows.length
            : 0;

      const files: any[] = [];
      for (const file of rawRows || []) {
        let fileUrl = `/api/uploads/messages/${file.stored_name}`;
        const driver = file.storage_driver;
        const storageKey = file.storage_key;
        const thumbKey = file.thumb_storage_key || file.thumbStorageKey;
        const thumbUrl = await resolveThumbUrl({
          storageProvider: deps.storageProvider,
          file,
          thumbKey,
          fileId: file.id,
        });
        if (
          (driver === "remote" || driver === "s3") &&
          deps.storageProvider &&
          typeof deps.storageProvider.getDownloadUrl === "function" &&
          storageKey
        ) {
          try {
            fileUrl = await deps.storageProvider.getDownloadUrl(storageKey);
          } catch {}
        }

        files.push({
          id: file.id,
          messageId: file.message_id,
          kind: file.kind,
          name: file.original_name,
          mimeType: file.mime_type,
          sizeBytes: Number(file.size_bytes || 0),
          width: Number.isFinite(Number(file.width_px)) ? Number(file.width_px) : null,
          height: Number.isFinite(Number(file.height_px)) ? Number(file.height_px) : null,
          durationSeconds: Number.isFinite(Number(file.duration_seconds))
            ? Number(file.duration_seconds)
            : null,
          processing:
            typeof isVideoFileProcessing === "function"
              ? isVideoFileProcessing(file)
              : String(file.processing_status || "").toLowerCase() === "processing",
          url: fileUrl,
          thumbUrl: thumbUrl || null,
          createdAt: file.message_created_at || file.file_created_at,
          sender: {
            id: file.sender_id,
            username: file.sender_username,
            nickname: file.sender_nickname || file.sender_username,
            avatarUrl: ensureAvatarExists(file.sender_id, file.sender_avatar_url),
            color: file.sender_color || "#10b981",
            verified: Boolean(file.sender_verified),
            role: file.sender_role || "user",
          },
        });
      }

      return res.json({
        files,
        total,
        limit,
        offset,
        hasMore: offset + files.length < total,
      });
    },
  );

  // ─── Per-thread Full-History Search (members-only) ───────────────────────
  app.get(
    "/api/chats/:chatId/search",
    validateUuidParams("chatId"),
    async (req, res) => {
      const session: any = await requireSession(req, res);
      if (!session) return;

      const chatId = req.params.chatId;
      const username: any = req.query.username?.toString();
      const query: any = req.query.query?.toString() || "";
      if (!username) {
        return res.status(400).json({ error: "Username is required." });
      }
      if (!query.trim()) {
        return res.status(400).json({ error: "Search query is required." });
      }
      if (!requireSessionUsernameMatch(res, session, username)) return;

      const user: any = await resolveMaybePromise(
        findUserByUsername(String(username).toLowerCase()),
      );
      if (!user) {
        return res.status(404).json({ error: "User not found." });
      }

      const member = await resolveMaybePromise(isMember(chatId, user.id));
      if (!member) {
        return res.status(403).json({ error: "Not a member of this chat." });
      }

      const limit = Math.min(Math.max(1, Number(req.query.limit) || 30), 100);
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const searchResult: any =
        typeof searchChatMessagesForUser === "function"
          ? await resolveMaybePromise(
              searchChatMessagesForUser(chatId, user.id, query, { limit, offset }),
            )
          : { results: [], hasMore: false };

      const results = (searchResult?.results || []).map((item: any) => ({
        ...item,
        avatarUrl: ensureAvatarExists(item.userId, item.avatarUrl),
      }));

      return res.json({
        results,
        limit,
        offset,
        hasMore: Boolean(searchResult?.hasMore),
      });
    },
  );

  app.get("/api/users", async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const exclude: any = req.query.exclude?.toString();
    const rawQuery: any = req.query.query?.toString();
    if (exclude && !requireSessionUsernameMatch(res, session, exclude)) return;

    const startedAt = Date.now();
    const hasQueryParam = typeof rawQuery === "string" && rawQuery.trim().length > 0;
    const normalizedQuery = hasQueryParam
      ? rawQuery.trim().replace(/^@+/, "").trim().toLowerCase()
      : "";

    let userList: any[] = [];
    if (hasQueryParam) {
      if (normalizedQuery) {
        const rawUsers = searchUsers(normalizedQuery, exclude);
        userList = (rawUsers && typeof rawUsers.then === "function" ? await rawUsers : rawUsers) || [];
      }
    } else {
      const rawUsers = listUsers(exclude);
      userList = (rawUsers && typeof rawUsers.then === "function" ? await rawUsers : rawUsers) || [];
    }

    const users: any = userList.map(
      (item) => ({
        ...item,
        avatar_url: ensureAvatarExists(item.id, item.avatar_url),
        status:
          isConnected(item.username) && String(item.status || "").toLowerCase() === "online"
            ? "online"
            : "offline",
      }),
    );

    if (typeof getSetting === "function" && getSetting("APP_DEBUG")) {
      const elapsedMs = Date.now() - startedAt;
      console.info(
        `[app-debug] api:users:search query=${JSON.stringify(rawQuery || "")} normalized=${JSON.stringify(normalizedQuery)} exclude=${JSON.stringify(exclude || "")} matched=${users.length} elapsedMs=${elapsedMs}`,
      );
    }

    res.json({ users });
  });

  app.post("/api/mentions/resolve", async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const username: any = req.body?.username?.toString();
    const mentions = Array.isArray(req.body?.mentions) ? req.body.mentions : [];
    if (!username || !mentions.length) {
      return res.status(400).json({ error: "Username and mentions are required." });
    }
    if (!requireSessionUsernameMatch(res, session, username)) return;
    const requester: any = await resolveMaybePromise(findUserByUsername(username.toLowerCase()));
    if (!requester) {
      return res.status(404).json({ error: "User not found." });
    }

    const unique: any = Array.from(
      new Set(
        mentions
          .map((item) => String(item || "").trim().toLowerCase())
          .map((item) => item.replace(/^@+/, ""))
          .filter((item) => item.length >= 3),
      ),
    ).slice(0, 50);

    const results: any = [];
    for (const mention of unique) {
      const user: any = await resolveMaybePromise(findUserByUsername(mention));
      if (user) {
        results.push({
          kind: "user",
          username: user.username,
          nickname: user.nickname || user.username,
          avatarUrl: ensureAvatarExists(user.id, user.avatar_url) || null,
          color: user.color || "#10b981",
          role: user.role || "user",
          verified: Boolean(user.verified),
        });
        continue;
      }
      const chat: any = await resolveMaybePromise(findChatByGroupUsername(mention));
      if (!chat) continue;
      const visibility: any = String(chat.group_visibility || "public").trim().toLowerCase();
      const isMemberFlag: any = await resolveMaybePromise(isMember(chat.id, requester.id));
      if (visibility === "private" && !isMemberFlag) continue;
      const rawMembers: any = listChatMembers(chat.id);
      const members = (rawMembers && typeof rawMembers.then === "function" ? await rawMembers : rawMembers) || [];
      const membersCount = members.length;
      results.push({
        kind: chat.type === "channel" ? "channel" : "group",
        chatId: chat.id,
        username: chat.group_username || mention,
        name: chat.name || (chat.type === "channel" ? "Channel" : "Group"),
        avatarUrl: normalizeGroupAvatarUrl(chat.group_avatar_url),
        color: chat.group_color || "#10b981",
        visibility: chat.group_visibility || "public",
        inviteToken: chat.invite_token || "",
        membersCount,
        isMember: Boolean(isMemberFlag),
      });
    }

    return res.json({ mentions: results });
  });

  app.get("/api/discover", async (req, res) => {
    const session: any = await requireSession(req, res);
    if (!session) return;

    const username: any = req.query.username?.toString();
    const query: any = String(req.query.query || "").trim();
    if (!username || !query) {
      return res.status(400).json({ error: "Username and query are required." });
    }
    if (!requireSessionUsernameMatch(res, session, username)) return;

    const rawUser: any = findUserByUsername(String(username || "").toLowerCase());
    const user = rawUser && typeof rawUser.then === "function" ? await rawUser : rawUser;
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const strippedQuery = query.replace(/^@+/, "").trim().toLowerCase();
    const rawSearchUsers: any = strippedQuery ? searchUsers(strippedQuery, username) : [];
    const searchUsersList = (rawSearchUsers && typeof rawSearchUsers.then === "function" ? await rawSearchUsers : rawSearchUsers) || [];
    const users: any = searchUsersList
      .map((item) => ({
        ...item,
        avatar_url: ensureAvatarExists(item.id, item.avatar_url),
        status:
          isConnected(item.username) && String(item.status || "").toLowerCase() === "online"
            ? "online"
            : "offline",
      }))
      .slice(0, 20);

    const rawSearchGroups: any = strippedQuery ? searchPublicGroups(strippedQuery, user.id, 20) : [];
    const searchGroupsList = (rawSearchGroups && typeof rawSearchGroups.then === "function" ? await rawSearchGroups : rawSearchGroups) || [];
    const groups: any = searchGroupsList.map((group) => ({
      id: group.id,
      name: group.name || "Group",
      username: group.group_username || "",
      color: group.group_color || "#10b981",
      avatarUrl: group.group_avatar_url || null,
      inviteToken: group.invite_token || "",
      membersCount: Number(group.members_count || 0),
      isMember: Boolean(Number(group.is_member || 0)),
      verified: Boolean(group.verified),
      type: "group",
    }));

    const rawSearchChannels: any = searchPublicChannels(query.toLowerCase(), user.id, 20);
    const searchChannelsList = (rawSearchChannels && typeof rawSearchChannels.then === "function" ? await rawSearchChannels : rawSearchChannels) || [];
    const channels: any = searchChannelsList.map((channel) => ({
      id: channel.id,
      name: channel.name || "Channel",
      username: channel.group_username || "",
      color: channel.group_color || "#10b981",
      avatarUrl: channel.group_avatar_url || null,
      inviteToken: channel.invite_token || "",
      membersCount: Number(channel.members_count || 0),
      isMember: Boolean(Number(channel.is_member || 0)),
      verified: Boolean(channel.verified),
      type: "channel",
    }));

    return res.json({ users, groups, channels });
  });
}

export { registerChatRoutes };

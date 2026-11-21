/**
 * Membership Domain Service
 *
 * Encapsulates group/channel membership mutations (joining, adding, leaving,
 * removing, role changes, ownership transfers) and generates standardized
 * post-commit effects (system messages, SSE payloads, and notification targets).
 */

import { dbKnex } from "../../db/knex.ts";

export function createMembershipService(dbApi) {
  const {
    getChatById,
    listChatMembers,
    addChatMember,
    removeChatMember,
    updateChatMemberRole,
    findUserById,
    findUserByUsername,
    findGroupByInviteToken,
    addSystemMessage,
    getRow,
    getAll,
    run,
  } = dbApi;

  /**
   * Helper to check if a user previously left a chat.
   */
  function isUserPriorLeft(chatId, userId) {
    if (typeof getRow === "function") {
      const qb1: any = dbKnex("chat_left_members").select(dbKnex.raw("1 as prior_left")).where({ chat_id: chatId, user_id: userId });
      const qb2: any = dbKnex("chat_messages").select(dbKnex.raw("1 as prior_left")).where({ chat_id: chatId, user_id: userId }).where("body", "like", "[[system:left:%");
      const priorLeft: any = getRow(
        dbKnex.union([qb1, qb2]).first(),
      );
      return Boolean(priorLeft?.prior_left);
    }
    return false;
  }

  /**
   * Helper to clean up prior left markers on rejoin.
   */
  function clearPriorLeft(chatId, userId) {
    if (typeof run === "function") {
      run(dbKnex("chat_left_members").where({ chat_id: chatId, user_id: userId }).del());
    }
  }

  /**
   * Helper to collect system messages & SSE payloads for members.
   */
  function buildEffects(
    chatId,
    systemMsgBody,
    updatedMemberUsernames: any = [],
    systemMessageUserId: any = null,
  ) {
    const chat: any = getChatById(chatId);
    const members = listChatMembers(chatId) || [];
    const memberUsernames: any = members.map((m) =>
      String(m.username || "").toLowerCase(),
    );

    const sseEvents: any = [];
    const pushRecipients: any = [];

    // Notify all members (plus specific targets who may have left) of chat updates
    const sseTargets: any = new Set([
      ...memberUsernames,
      ...updatedMemberUsernames.map((u) => String(u).toLowerCase()),
    ]);
    sseTargets.forEach((username) => {
      if (username) {
        sseEvents.push({
          targetUsername: username,
          payload: { type: "chat_updated", chatId },
        });
        sseEvents.push({
          targetUsername: username,
          payload: { type: "chat_list_changed", chatId },
        });
      }
    });

    let systemMessageResult: any = null;
    if (
      systemMsgBody &&
      chat &&
      chat.type === "group" &&
      typeof addSystemMessage === "function"
    ) {
      systemMessageResult = addSystemMessage(
        chatId,
        systemMsgBody,
        systemMessageUserId,
      );
    }

    return {
      chat,
      members,
      systemMessage: systemMessageResult,
      sseEvents,
      pushRecipients: members.map((m) => m.id),
    };
  }

  /**
   * Add users to a chat (or rejoin).
   */
  function addMembers({
    chatId,
    targetUserIds = [],
    role = "member",
    force = false,
  }: any) {
    const rawChat: any = getChatById(chatId);
    const rawMembers: any = listChatMembers(chatId);
    const hasAsync =
      (rawChat && typeof rawChat.then === "function") ||
      (rawMembers && typeof rawMembers.then === "function");

    const doAdd = async () => {
      const chat = rawChat && typeof rawChat.then === "function" ? await rawChat : rawChat;
      if (!chat) throw new Error("Chat not found");

      let addedCount = 0;
      let skippedCount = 0;
      let systemMessageUserId: any = null;
      const addedUsernames: any = [];

      const existingMembers = (rawMembers && typeof rawMembers.then === "function" ? await rawMembers : rawMembers) || [];
      const existingUserIds: any = new Set(existingMembers.map((m) => m.id));

      for (const userId of targetUserIds) {
        if (existingUserIds.has(userId)) {
          skippedCount++;
          continue;
        }

        const rawPriorLeft: any = isUserPriorLeft(chatId, userId);
        const priorLeft = rawPriorLeft && typeof rawPriorLeft.then === "function" ? await rawPriorLeft : rawPriorLeft;
        if (!force && priorLeft) {
          skippedCount++;
          continue;
        }

        const rawClear: any = clearPriorLeft(chatId, userId);
        if (rawClear && typeof rawClear.then === "function") await rawClear;
        const rawAdd: any = addChatMember(chatId, userId, role);
        if (rawAdd && typeof rawAdd.then === "function") await rawAdd;
        addedCount++;

        const rawUser: any = findUserById(userId);
        const user = rawUser && typeof rawUser.then === "function" ? await rawUser : rawUser;
        if (user?.username) {
          addedUsernames.push(user.username);
          if (systemMessageUserId === null) systemMessageUserId = userId;
        }
      }

      const effects: any = await buildEffectsAsync(
        chatId,
        addedUsernames.length === 1
          ? `[[system:joined:${addedUsernames[0]}]]`
          : null,
        addedUsernames,
        systemMessageUserId,
      );

      return {
        success: true,
        addedCount,
        skippedCount,
        ...effects,
      };
    };

    if (hasAsync) return doAdd();

    if (!rawChat) throw new Error("Chat not found");

    let addedCount = 0;
    let skippedCount = 0;
    let systemMessageUserId: any = null;
    const addedUsernames: any = [];

    const existingMembers = rawMembers || [];
    const existingUserIds: any = new Set(existingMembers.map((m) => m.id));

    for (const userId of targetUserIds) {
      if (existingUserIds.has(userId)) {
        skippedCount++;
        continue;
      }

      if (!force && isUserPriorLeft(chatId, userId)) {
        skippedCount++;
        continue;
      }

      clearPriorLeft(chatId, userId);
      addChatMember(chatId, userId, role);
      addedCount++;

      const user: any = findUserById(userId);
      if (user?.username) {
        addedUsernames.push(user.username);
        if (systemMessageUserId === null) systemMessageUserId = userId;
      }
    }

    const effects: any = buildEffects(
      chatId,
      addedUsernames.length === 1
        ? `[[system:joined:${addedUsernames[0]}]]`
        : null,
      addedUsernames,
      systemMessageUserId,
    );

    return {
      success: true,
      addedCount,
      skippedCount,
      ...effects,
    };
  }

  async function buildEffectsAsync(
    chatId,
    systemMsgBody,
    updatedMemberUsernames: any = [],
    systemMessageUserId: any = null,
  ) {
    const rawChat: any = getChatById(chatId);
    const chat = rawChat && typeof rawChat.then === "function" ? await rawChat : rawChat;
    const rawMembers: any = listChatMembers(chatId);
    const members = (rawMembers && typeof rawMembers.then === "function" ? await rawMembers : rawMembers) || [];
    const memberUsernames: any = members.map((m) =>
      String(m.username || "").toLowerCase(),
    );

    const sseEvents: any = [];
    const sseTargets: any = new Set([
      ...memberUsernames,
      ...updatedMemberUsernames.map((u) => String(u).toLowerCase()),
    ]);
    sseTargets.forEach((username) => {
      if (username) {
        sseEvents.push({
          targetUsername: username,
          payload: { type: "chat_updated", chatId },
        });
        sseEvents.push({
          targetUsername: username,
          payload: { type: "chat_list_changed", chatId },
        });
      }
    });

    let systemMessageResult: any = null;
    if (
      systemMsgBody &&
      chat &&
      chat.type === "group" &&
      typeof addSystemMessage === "function"
    ) {
      const rawResult: any = addSystemMessage(
        chatId,
        systemMsgBody,
        systemMessageUserId,
      );
      systemMessageResult =
        rawResult && typeof rawResult.then === "function"
          ? await rawResult
          : rawResult;
    }

    return {
      chat,
      members,
      systemMessage: systemMessageResult,
      sseEvents,
      pushRecipients: members.map((m) => m.id),
    };
  }

  /**
   * Join group via invite token.
   */
  function joinByInvite({ inviteToken, userId }: any) {
    const rawChat: any = findGroupByInviteToken(inviteToken);
    const rawUser: any = findUserById(userId);
    const hasAsyncDependency =
      rawChat && typeof rawChat.then === "function" ||
      rawUser && typeof rawUser.then === "function";

    const join = async () => {
      const chat = rawChat && typeof rawChat.then === "function" ? await rawChat : rawChat;
      if (!chat) throw new Error("Invalid invite token");

      const user = rawUser && typeof rawUser.then === "function" ? await rawUser : rawUser;
      if (!user) throw new Error("User not found");

      const rawClear: any = clearPriorLeft(chat.id, user.id);
      if (rawClear && typeof rawClear.then === "function") await rawClear;
      const rawAdd: any = addChatMember(chat.id, user.id, "member");
      if (rawAdd && typeof rawAdd.then === "function") await rawAdd;

      const nickname = user.nickname || user.username;
      const effects: any = await buildEffectsAsync(
        chat.id,
        `[[system:joined:${nickname}]]`,
        [user.username],
        user.id,
      );

      return {
        success: true,
        chat,
        ...effects,
      };
    };

    if (hasAsyncDependency) return join();

    if (!rawChat) throw new Error("Invalid invite token");
    if (!rawUser) throw new Error("User not found");

    clearPriorLeft(rawChat.id, rawUser.id);
    addChatMember(rawChat.id, rawUser.id, "member");

    const nickname = rawUser.nickname || rawUser.username;
    const effects: any = buildEffects(
      rawChat.id,
      `[[system:joined:${nickname}]]`,
      [rawUser.username],
      rawUser.id,
    );

    return {
      success: true,
      chat: rawChat,
      ...effects,
    };
  }

  /**
   * Leave a chat.
   */
  function leaveChat({ chatId, userId }: any) {
    const rawChat: any = getChatById(chatId);
    const rawUser: any = findUserById(userId);
    const hasAsync =
      (rawChat && typeof rawChat.then === "function") ||
      (rawUser && typeof rawUser.then === "function");

    const doLeave = async () => {
      const chat = rawChat && typeof rawChat.then === "function" ? await rawChat : rawChat;
      if (!chat) throw new Error("Chat not found");

      const user = rawUser && typeof rawUser.then === "function" ? await rawUser : rawUser;
      if (!user) throw new Error("User not found");

      const rawRemove: any = removeChatMember(chatId, userId);
      if (rawRemove && typeof rawRemove.then === "function") await rawRemove;

      const nickname = user.nickname || user.username;
      const effects: any = await buildEffectsAsync(
        chatId,
        `[[system:left:${nickname}]]`,
        [user.username],
        user.id,
      );

      return {
        success: true,
        chat,
        ...effects,
      };
    };

    if (hasAsync) return doLeave();

    if (!rawChat) throw new Error("Chat not found");
    if (!rawUser) throw new Error("User not found");

    removeChatMember(chatId, userId);

    const nickname = rawUser.nickname || rawUser.username;
    const effects: any = buildEffects(chatId, `[[system:left:${nickname}]]`, [
      rawUser.username,
    ], rawUser.id);

    return {
      success: true,
      chat: rawChat,
      ...effects,
    };
  }

  /**
   * Remove a member from a chat.
   */
  function removeMember({ chatId, targetUserId, removedByUserId }: any) {
    const rawChat: any = getChatById(chatId);
    const rawUser: any = findUserById(targetUserId);
    const hasAsync =
      (rawChat && typeof rawChat.then === "function") ||
      (rawUser && typeof rawUser.then === "function");

    const doRemove = async () => {
      const chat = rawChat && typeof rawChat.then === "function" ? await rawChat : rawChat;
      if (!chat) throw new Error("Chat not found");

      const targetUser = rawUser && typeof rawUser.then === "function" ? await rawUser : rawUser;
      if (!targetUser) throw new Error("User not found");

      const rawRemove: any = removeChatMember(chatId, targetUserId);
      if (rawRemove && typeof rawRemove.then === "function") await rawRemove;

      const nickname = targetUser.nickname || targetUser.username;
      const effects: any = await buildEffectsAsync(
        chatId,
        `[[system:removed:${nickname}]]`,
        [targetUser.username],
        targetUser.id,
      );

      return {
        success: true,
        chat,
        ...effects,
      };
    };

    if (hasAsync) return doRemove();

    if (!rawChat) throw new Error("Chat not found");
    if (!rawUser) throw new Error("User not found");

    removeChatMember(chatId, targetUserId);

    const nickname = rawUser.nickname || rawUser.username;
    const effects: any = buildEffects(chatId, `[[system:removed:${nickname}]]`, [
      rawUser.username,
    ], rawUser.id);

    return {
      success: true,
      chat: rawChat,
      ...effects,
    };
  }

  /**
   * Update member role.
   */
  function updateMemberRole({ chatId, targetUserId, newRole }: any) {
    const rawChat: any = getChatById(chatId);
    const rawUser: any = findUserById(targetUserId);
    const hasAsync =
      (rawChat && typeof rawChat.then === "function") ||
      (rawUser && typeof rawUser.then === "function");

    const doUpdate = async () => {
      const chat = rawChat && typeof rawChat.then === "function" ? await rawChat : rawChat;
      if (!chat) throw new Error("Chat not found");

      const targetUser = rawUser && typeof rawUser.then === "function" ? await rawUser : rawUser;
      if (!targetUser) throw new Error("User not found");

      const rawUpdate: any = updateChatMemberRole(chatId, targetUserId, newRole);
      if (rawUpdate && typeof rawUpdate.then === "function") await rawUpdate;

      const effects: any = await buildEffectsAsync(chatId, null, [targetUser.username]);

      return {
        success: true,
        chat,
        ...effects,
      };
    };

    if (hasAsync) return doUpdate();

    if (!rawChat) throw new Error("Chat not found");
    if (!rawUser) throw new Error("User not found");

    updateChatMemberRole(chatId, targetUserId, newRole);
    const effects: any = buildEffects(chatId, null, [rawUser.username]);

    return {
      success: true,
      chat: rawChat,
      ...effects,
    };
  }

  return {
    addMembers,
    joinByInvite,
    leaveChat,
    removeMember,
    updateMemberRole,
  };
}

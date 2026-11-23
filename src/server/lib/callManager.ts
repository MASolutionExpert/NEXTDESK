import { isValidUuid } from "./uuidUtils.ts";

const VALID_REJECT_REASONS = new Set([
  "declined",
  "busy",
  "peer_media_failed",
  "unsupported",
]);

export function createCallManager(deps: any = {}) {
  const {
    isMember,
    findChatById,
    listChatMembers,
    findUserById,
    emitToUser,
    emitChatEvent,
    createCallMessage,
    updateCallMessageBody,
    sendPushNotificationToUsers,
    isUserConnected = null,
    env = process.env,
    maxCallDurationMs = 0,
    ringTimeoutMs = 60_000,
    staleCheckIntervalMs = 30_000,
    offlineGraceMs = 45_000,
    maxLifetimeMs = 12 * 60 * 60 * 1000,
  } = deps;

  const MAX_CALL_DURATION_MS = Math.max(0, Number(maxCallDurationMs) || 0);
  const RING_TIMEOUT_MS = Math.max(0, Number(ringTimeoutMs) || 0);
  const STALE_CHECK_INTERVAL_MS = Math.max(0, Number(staleCheckIntervalMs) || 0);
  const OFFLINE_GRACE_MS = Math.max(0, Number(offlineGraceMs) || 0);
  const MAX_LIFETIME_MS = Math.max(0, Number(maxLifetimeMs) || 0);

  // Plain JSON-serializable call records (NEVER store Timeout handles on call objects!)
  const activeCalls = new Map<string, any>();
  const ringTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const maxDurationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const bothOfflineSince = new Map<string, number>();

  const TURN_STUN_URL = env.TURN_STUN_URL || "stun:stun.l.google.com:19302";
  const TURN_URL = env.TURN_URL || "";
  const TURN_USERNAME = env.TURN_USERNAME || "";
  const TURN_CREDENTIAL = env.TURN_CREDENTIAL || "";

  function clearCallTimers(key: string) {
    const rt = ringTimers.get(key);
    if (rt) {
      clearTimeout(rt);
      ringTimers.delete(key);
    }
    const mt = maxDurationTimers.get(key);
    if (mt) {
      clearTimeout(mt);
      maxDurationTimers.delete(key);
    }
    bothOfflineSince.delete(key);
  }

  function getIceServers() {
    const servers: any[] = [{ urls: TURN_STUN_URL }];
    if (TURN_URL) {
      servers.push({
        urls: TURN_URL,
        username: TURN_USERNAME,
        credential: TURN_CREDENTIAL,
      });
    }
    return servers;
  }

  async function resolveIceServers() {
    if (!(env.TURN_TOKEN_ID && env.TURN_API_TOKEN)) return getIceServers();
    try {
      const res: any = await (deps.fetch || fetch)(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_TOKEN_ID}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.TURN_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ttl: 86400 }),
        },
      );
      if (res.ok) {
        const data: any = await res.json();
        if (Array.isArray(data.iceServers) && data.iceServers.length) {
          return data.iceServers;
        }
      }
    } catch (_) {}
    return getIceServers();
  }

  function sendCallPush(userIds: any[], payload: any) {
    if (typeof sendPushNotificationToUsers !== "function") return;
    try {
      void Promise.resolve(sendPushNotificationToUsers(userIds, payload)).catch(
        () => {},
      );
    } catch {
      // ignore synchronous throw
    }
  }

  function dismissCallPush(call: any) {
    if (!call || call.status !== "ringing") return;
    sendCallPush([call.calleeId], {
      data: { callPush: "dismiss", chatId: call.chatId },
    });
  }

  function broadcastRingEnded(call: any, reason = "ended") {
    if (typeof emitToUser !== "function" || !call) return;
    for (const target of [call.callerUsername, call.calleeUsername]) {
      if (target) {
        emitToUser(target, {
          type: "call:ring-ended",
          chatId: call.chatId,
          reason,
        });
      }
    }
  }

  function getActiveCall(chatId: string) {
    if (!chatId) return undefined;
    return activeCalls.get(String(chatId).toLowerCase());
  }

  function isParticipant(call: any, username: string) {
    if (!call || !username) return false;
    const lower = String(username).toLowerCase();
    return (
      String(call.callerUsername).toLowerCase() === lower ||
      String(call.calleeUsername).toLowerCase() === lower
    );
  }

  function encodeCallBody(
    type: string,
    status: string,
    durationSeconds: any = null,
  ) {
    return durationSeconds == null
      ? `[[call:${type}:${status}]]`
      : `[[call:${type}:${status}:${Math.max(0, Math.floor(Number(durationSeconds) || 0))}]]`;
  }

  function emitLogUpdate(call: any) {
    if (typeof emitChatEvent !== "function" || !call?.logMessageId) return;
    emitChatEvent(call.chatId, {
      type: "chat_message_updated",
      chatId: call.chatId,
      messageId: call.logMessageId,
      body: encodeCallBody(call.type, call.logStatus, call.logDuration),
    });
  }

  async function writeCallLog(
    call: any,
    status: string,
    durationSeconds: any = null,
  ) {
    call.logStatus = status;
    call.logDuration = durationSeconds;
    if (call.logMessageId) {
      if (typeof updateCallMessageBody === "function") {
        try {
          await updateCallMessageBody(
            call.logMessageId,
            encodeCallBody(call.type, status, durationSeconds),
          );
        } catch {}
      }
      emitLogUpdate(call);
      return;
    }
    if (typeof createCallMessage !== "function") return;
    try {
      const id: any = await createCallMessage(
        call.chatId,
        call.callerId,
        encodeCallBody(call.type, status, durationSeconds),
      );
      if (id) {
        call.logMessageId = id;
        if (typeof emitChatEvent === "function") {
          emitChatEvent(call.chatId, {
            type: "chat_message",
            chatId: call.chatId,
            messageId: id,
            userId: call.callerId,
            username: call.callerUsername,
            body: encodeCallBody(call.type, status, durationSeconds),
          });
        }
      }
    } catch {}
  }

  function peerUsernameOf(call: any, username: string) {
    const lower = String(username).toLowerCase();
    return String(call.callerUsername).toLowerCase() === lower
      ? call.calleeUsername
      : call.callerUsername;
  }

  function secondsSinceStart(call: any) {
    const base = Number(call.connectedAt || call.startedAt || 0);
    return Math.max(0, Math.round((Date.now() - base) / 1000));
  }

  function isCallStale(key: string, call: any, now = Date.now()): boolean {
    if (!call) return true;
    const age = now - Number(call.startedAt || 0);
    if (MAX_LIFETIME_MS > 0 && age >= MAX_LIFETIME_MS) {
      return true;
    }
    if (
      call.status === "ringing" &&
      RING_TIMEOUT_MS > 0 &&
      age >= RING_TIMEOUT_MS + 5_000
    ) {
      return true;
    }
    if (call.status === "connected" && typeof isUserConnected === "function") {
      const callerOnline = Boolean(isUserConnected(call.callerUsername));
      const calleeOnline = Boolean(isUserConnected(call.calleeUsername));
      if (!callerOnline && !calleeOnline) {
        const firstSeen = bothOfflineSince.get(key);
        if (firstSeen === undefined) {
          bothOfflineSince.set(key, now);
          return OFFLINE_GRACE_MS === 0;
        }
        return now - firstSeen >= OFFLINE_GRACE_MS;
      } else {
        bothOfflineSince.delete(key);
      }
    }
    return false;
  }

  async function finalizeStaleCall(key: string, call: any, reason = "timeout") {
    if (activeCalls.get(key) !== call) return;
    clearCallTimers(key);
    activeCalls.delete(key);
    dismissCallPush(call);

    const wasRinging = call.status === "ringing";
    if (typeof emitToUser === "function") {
      for (const peer of [call.callerUsername, call.calleeUsername]) {
        if (peer) {
          emitToUser(peer, {
            type: "call:ended",
            chatId: call.chatId,
            reason: wasRinging ? "missed" : reason,
          });
        }
      }
    }
    broadcastRingEnded(call, wasRinging ? "missed" : reason);

    if (wasRinging) {
      await writeCallLog(call, "missed");
    } else if (call.logMessageId) {
      await writeCallLog(call, "connected", secondsSinceStart(call));
    }
  }

  async function reapStaleCalls(now = Date.now()): Promise<number> {
    let reaped = 0;
    for (const [key, call] of Array.from(activeCalls.entries())) {
      if (isCallStale(key, call, now)) {
        await finalizeStaleCall(key, call, "stale");
        reaped += 1;
      }
    }
    return reaped;
  }

  let staleSweepInterval: ReturnType<typeof setInterval> | null = null;
  if (STALE_CHECK_INTERVAL_MS > 0) {
    staleSweepInterval = setInterval(() => {
      void reapStaleCalls();
    }, STALE_CHECK_INTERVAL_MS);
    staleSweepInterval.unref?.();
  }

  function scheduleRingTimeout(key: string, call: any) {
    if (RING_TIMEOUT_MS <= 0) return;
    const prev = ringTimers.get(key);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      ringTimers.delete(key);
      if (activeCalls.get(key) !== call || call.status !== "ringing") return;
      void finalizeStaleCall(key, call, "missed");
    }, RING_TIMEOUT_MS);
    timer.unref?.();
    ringTimers.set(key, timer);
  }

  function findOtherActiveCallForUser(username: string, excludeChatKey: string, now = Date.now()) {
    const lower = String(username || "").toLowerCase();
    for (const [k, c] of activeCalls.entries()) {
      if (k === excludeChatKey) continue;
      if (
        String(c.callerUsername).toLowerCase() === lower ||
        String(c.calleeUsername).toLowerCase() === lower
      ) {
        if (isCallStale(k, c, now)) {
          void finalizeStaleCall(k, c, "stale");
          continue;
        }
        return c;
      }
    }
    return null;
  }

  function emitIncomingToCallee(call: any, callerUser: any) {
    if (typeof emitToUser === "function") {
      emitToUser(call.calleeUsername, {
        type: "call:incoming",
        chatId: call.chatId,
        callType: call.type,
        caller: {
          id: callerUser.id,
          username: callerUser.username,
          nickname: callerUser.nickname || callerUser.username,
          avatarUrl: callerUser.avatar_url || "",
          color: callerUser.color || null,
          verified: Boolean(callerUser.verified),
          role: callerUser.role || "user",
        },
      });
    }
  }

  async function startCall({ user, chatId, type = "voice" }: any) {
    if (!user?.username) {
      return { status: 401, error: "Not authenticated" };
    }
    const normalizedChatId = String(chatId || "").trim();
    if (!isValidUuid(normalizedChatId)) {
      return { status: 400, error: "Invalid chat ID" };
    }

    const chat =
      typeof findChatById === "function"
        ? await findChatById(normalizedChatId)
        : null;
    if (!chat) {
      return { status: 404, error: "Chat not found" };
    }
    if (chat.type !== "dm") {
      return {
        status: 400,
        error: "Calls are only supported in direct messages",
      };
    }

    const memberCheck =
      typeof isMember === "function"
        ? await isMember(normalizedChatId, user.id)
        : false;
    if (!memberCheck) {
      return { status: 403, error: "You are not a member of this chat" };
    }

    const key = normalizedChatId.toLowerCase();
    const now = Date.now();
    const existing = activeCalls.get(key);
    if (existing) {
      if (isCallStale(key, existing, now)) {
        // Stale takeover: reap dead entry and allow a fresh call cleanly.
        await finalizeStaleCall(key, existing, "stale");
      } else if (
        existing.status === "ringing" &&
        String(existing.callerUsername).toLowerCase() ===
          String(user.username).toLowerCase()
      ) {
        // Redial resume: same caller redialling while still ringing resumes
        // the existing ringing call instead of failing with 409.
        emitIncomingToCallee(existing, user);
        return { status: 200, call: existing, resumed: true };
      } else {
        return {
          status: 409,
          code: "call_in_progress",
          error: "Call already in progress in this chat",
        };
      }
    }

    const members =
      typeof listChatMembers === "function"
        ? await listChatMembers(normalizedChatId)
        : [];
    const otherMember: any = members.find(
      (m: any) =>
        String(m.username).toLowerCase() !==
        String(user.username).toLowerCase(),
    );
    if (!otherMember?.username) {
      return { status: 404, error: "Other participant not found" };
    }

    const callee =
      typeof findUserById === "function"
        ? await findUserById(otherMember.id)
        : otherMember;
    if (!callee || callee.is_deleted || callee.username === "deleted") {
      return { status: 400, error: "Cannot call a deleted user" };
    }

    // Callee-busy pre-check: reject cleanly before ringing if callee is in another call.
    if (findOtherActiveCallForUser(otherMember.username, key, now)) {
      return {
        status: 409,
        code: "callee_busy",
        error: "The person you are calling is busy",
      };
    }

    const call: any = {
      chatId: normalizedChatId,
      callerId: user.id,
      callerUsername: user.username,
      calleeId: otherMember.id,
      calleeUsername: otherMember.username,
      type: type === "video" ? "video" : "voice",
      startedAt: now,
      status: "ringing",
    };

    activeCalls.set(key, call);
    scheduleRingTimeout(key, call);

    emitIncomingToCallee(call, user);

    sendCallPush([otherMember.id], {
      title: user.nickname || user.username,
      body:
        call.type === "video"
          ? "Incoming video call"
          : "Incoming voice call",
      tag: `call-${normalizedChatId}`,
      data: {
        callPush: "incoming",
        chatId: normalizedChatId,
        callType: call.type,
        url: "/",
      },
    });

    await writeCallLog(call, "outgoing");

    return { status: 200, call };
  }

  async function getIncomingCallForUser(username: string) {
    if (!username) return null;
    const lower = String(username).toLowerCase();
    for (const call of activeCalls.values()) {
      if (call.status !== "ringing") continue;
      if (String(call.calleeUsername).toLowerCase() !== lower) continue;
      const caller =
        typeof findUserById === "function"
          ? await findUserById(call.callerId)
          : null;
      return {
        type: "call:incoming",
        chatId: call.chatId,
        callType: call.type,
        caller: {
          id: call.callerId,
          username: call.callerUsername,
          nickname: caller?.nickname || call.callerUsername,
          avatarUrl: caller?.avatar_url || "",
          color: caller?.color || null,
          verified: Boolean(caller?.verified),
          role: caller?.role || "user",
        },
      };
    }
    return null;
  }

  async function acceptCall({ user, chatId }: any) {
    if (!user?.username) {
      return { status: 401, error: "Not authenticated" };
    }
    const key = String(chatId || "").toLowerCase();
    const call = activeCalls.get(key);
    if (!call) {
      return { status: 404, error: "No active call found for this chat" };
    }

    if (
      String(user.username).toLowerCase() !==
      String(call.calleeUsername).toLowerCase()
    ) {
      return { status: 403, error: "Only the recipient can accept the call" };
    }

    dismissCallPush(call);

    // Clear ring timer now that the call is answered.
    const rt = ringTimers.get(key);
    if (rt) {
      clearTimeout(rt);
      ringTimers.delete(key);
    }

    call.status = "connected";
    call.connectedAt = Date.now();

    if (MAX_CALL_DURATION_MS > 0) {
      const prevMax = maxDurationTimers.get(key);
      if (prevMax) clearTimeout(prevMax);
      const timer = setTimeout(() => {
        maxDurationTimers.delete(key);
        if (activeCalls.get(key) !== call) return;
        clearCallTimers(key);
        activeCalls.delete(key);
        dismissCallPush(call);
        for (const peer of [call.callerUsername, call.calleeUsername]) {
          if (typeof emitToUser === "function" && peer) {
            emitToUser(peer, {
              type: "call:ended",
              chatId: call.chatId,
              reason: "max_duration",
            });
          }
        }
        broadcastRingEnded(call, "max_duration");
        void writeCallLog(call, "connected", secondsSinceStart(call));
      }, MAX_CALL_DURATION_MS);
      timer.unref?.();
      maxDurationTimers.set(key, timer);
    }

    if (typeof emitToUser === "function") {
      emitToUser(call.callerUsername, {
        type: "call:accepted",
        chatId: call.chatId,
      });
    }
    // Dismiss ringing screens on any other sessions of both accounts.
    broadcastRingEnded(call, "accepted");

    return { status: 200, call };
  }

  async function rejectCall({ user, chatId, reason = null }: any) {
    if (!user?.username) {
      return { status: 401, error: "Not authenticated" };
    }
    const key = String(chatId || "").toLowerCase();
    const call = activeCalls.get(key);
    if (!call) {
      return { status: 404, error: "No active call found for this chat" };
    }

    if (!isParticipant(call, user.username)) {
      return { status: 403, error: "You are not a participant in this call" };
    }

    const normalizedReason = VALID_REJECT_REASONS.has(
      String(reason || "").toLowerCase(),
    )
      ? String(reason).toLowerCase()
      : "declined";

    clearCallTimers(key);
    activeCalls.delete(key);
    dismissCallPush(call);

    const peer = peerUsernameOf(call, user.username);
    if (typeof emitToUser === "function" && peer) {
      emitToUser(peer, {
        type: "call:rejected",
        chatId: call.chatId,
        reason: normalizedReason,
      });
    }
    broadcastRingEnded(call, normalizedReason);

    if (
      call.status === "ringing" &&
      String(user.username).toLowerCase() ===
        String(call.calleeUsername).toLowerCase()
    ) {
      const logOutcome =
        normalizedReason === "peer_media_failed" ? "failed" : "declined";
      await writeCallLog(call, logOutcome);
    }

    return { status: 200, ok: true };
  }

  async function endCall({ user, chatId, reason = null }: any) {
    if (!user?.username) {
      return { status: 401, error: "Not authenticated" };
    }
    const key = String(chatId || "").toLowerCase();
    const call = activeCalls.get(key);
    if (!call) {
      return { status: 404, error: "No active call found for this chat" };
    }

    if (!isParticipant(call, user.username)) {
      return { status: 403, error: "You are not a participant in this call" };
    }

    const endedRinging = call.status === "ringing";
    const wasCaller =
      String(user.username).toLowerCase() ===
      String(call.callerUsername).toLowerCase();

    clearCallTimers(key);
    activeCalls.delete(key);
    dismissCallPush(call);

    const peer = peerUsernameOf(call, user.username);
    if (typeof emitToUser === "function" && peer) {
      emitToUser(peer, {
        type: "call:ended",
        chatId: call.chatId,
        ...(reason ? { reason } : {}),
      });
    }
    broadcastRingEnded(call, reason || "ended");

    if (endedRinging) {
      const outcome =
        String(reason || "").toLowerCase() === "failed"
          ? "failed"
          : wasCaller
            ? "cancelled"
            : "failed";
      await writeCallLog(call, outcome);
    } else if (call.logMessageId) {
      await writeCallLog(call, "connected", secondsSinceStart(call));
    }

    return { status: 200, ok: true };
  }

  async function relaySignal({ user, chatId, signalType, payload = {} }: any) {
    if (!user?.username) {
      return { status: 401, error: "Not authenticated" };
    }
    const key = String(chatId || "").toLowerCase();
    const call = activeCalls.get(key);
    if (!call) {
      return {
        status: 404,
        code: "call_not_found",
        error: "No active call found for this chat",
      };
    }

    if (!isParticipant(call, user.username)) {
      return {
        status: 403,
        code: "not_participant",
        error: "You are not a participant in this chat",
      };
    }

    const peer = peerUsernameOf(call, user.username);
    if (typeof emitToUser === "function" && peer) {
      emitToUser(peer, {
        type: `call:${signalType}`,
        chatId: call.chatId,
        ...payload,
      });
    }

    return { status: 200, ok: true };
  }

  function cleanupUserCalls(username: string) {
    if (!username) return;
    const lower = String(username).toLowerCase();
    for (const [key, call] of Array.from(activeCalls.entries())) {
      if (
        String(call.callerUsername).toLowerCase() === lower ||
        String(call.calleeUsername).toLowerCase() === lower
      ) {
        clearCallTimers(key);
        activeCalls.delete(key);
        dismissCallPush(call);

        const wasCaller =
          String(call.callerUsername).toLowerCase() === lower;
        if (call.status === "ringing") {
          void writeCallLog(call, wasCaller ? "cancelled" : "failed");
        } else if (call.logMessageId) {
          void writeCallLog(call, "connected", secondsSinceStart(call));
        }

        const peer = peerUsernameOf(call, lower);
        if (typeof emitToUser === "function" && peer) {
          emitToUser(peer, {
            type: "call:ended",
            chatId: call.chatId,
            reason: "disconnect",
          });
        }
        broadcastRingEnded(call, "disconnect");
      }
    }
  }

  function stop() {
    if (staleSweepInterval) {
      clearInterval(staleSweepInterval);
      staleSweepInterval = null;
    }
    for (const key of Array.from(ringTimers.keys())) {
      clearCallTimers(key);
    }
    for (const key of Array.from(maxDurationTimers.keys())) {
      clearCallTimers(key);
    }
  }

  return {
    getIceServers,
    resolveIceServers,
    getActiveCall,
    getIncomingCallForUser,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    relaySignal,
    cleanupUserCalls,
    reapStaleCalls,
    stop,
  };
}

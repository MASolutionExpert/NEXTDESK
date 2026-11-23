'use client';

import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import MobileTabMenu from "../components/navigation/MobileTabMenu.tsx";
import ChatWindowPanel from "../components/chat/ChatWindowPanel.tsx";
import { CallScreen } from "../components/call/CallScreen.tsx";
import { ChatSidebar } from "../components/sidebar/index.ts";
import AppContextMenu from "../components/context-menu/AppContextMenu.tsx";
import { useAppContextMenu } from "../components/context-menu/useAppContextMenu.ts";
import { CHAT_PAGE_CONFIG } from "../settings/chatPageConfig.ts";
import { useI18n } from "../i18n/index.ts";
import { getAvatarInitials } from "../utils/avatarInitials.ts";
import { getRandomAvatarColor } from "../utils/avatarColor.ts";
import { NICKNAME_MAX, USERNAME_MAX, USERNAME_REGEX } from "../utils/nameLimits.ts";
import { resolveReplyPreview, summarizeFiles, truncateText } from "../utils/messagePreview.ts";
import {
  formatBytesAsMb,
  formatChatCardTimestamp,
  formatCompactCount,
  formatDayLabel,
  formatTime,
  parseServerDate,
} from "../utils/chatFormat.ts";
import { useChatEvents } from "../hooks/chat/useChatEvents.ts";
import { useChatScroll } from "../hooks/chat/useChatScroll.ts";
import { useChatCacheStats } from "../hooks/chat/useChatCacheStats.ts";
import { useChatNotifications } from "../hooks/chat/useChatNotifications.ts";
import { useDiscoverSearch } from "../hooks/chat/useDiscoverSearch.ts";
import { useActiveChatState } from "../hooks/chat/useActiveChatState.ts";
import { useAppActivity } from "../hooks/chat/useAppActivity.ts";
import { useHealthCheck } from "../hooks/chat/useHealthCheck.ts";
import { useOverlayBack } from "../hooks/chat/useOverlayBack.ts";
import { useMessagesLoader } from "../hooks/chat/useMessagesLoader.ts";
import { useMobileViewport } from "../hooks/chat/useMobileViewport.ts";
import { useNewChatSearch } from "../hooks/chat/useNewChatSearch.ts";
import { useNewGroupModal } from "../hooks/chat/useNewGroupModal.ts";
import { usePerfTelemetry } from "../hooks/chat/usePerfTelemetry.ts";
import { useResumeRefresh } from "../hooks/chat/useResumeRefresh.ts";
import { useMessageVisibility } from "../hooks/chat/useMessageVisibility.ts";
import { useWebRTCCall } from "../hooks/chat/useWebRTCCall.ts";
import {
  isCallSupported,
  isScreenShareSupported,
} from "../utils/callCapabilities.ts";
import { useAppReleaseInfo } from "../hooks/useAppReleaseInfo.ts";
import { Bookmark } from "../icons/lucide.ts";
import { CLIPBOARD_COPY_EVENT } from "../utils/clipboard.ts";
import { CACHE_STORES } from "../utils/cacheDb.ts";
import { downloadMessageFiles } from "../utils/fileDownload.ts";
import {
  CHAT_CACHE_VERSION,
  buildChatListCacheKey,
  buildMessagesCacheKey,
  canUseIdb,
  deleteIdbCache,
  normalizeMessageBody,
  normalizeMessagesForRender,
  pruneMessagesIndex,
  readChatListCacheAsync,
  readMessagesCacheAsync,
  readMessagesIndexAsync,
  sanitizeMessagesForCache,
  readChannelSeenCacheAsync,
  writeChannelSeenCacheAsync,
  writeIdbCache,
  migrateLocalCacheToIdb,
  updateMessagesIndex,
  writeMessagesIndex,
} from "../utils/chatCache.ts";
import { getMessageFiles } from "../utils/messageContent.ts";
import {
  isMessageAuthoredByUser,
  isMessageFromOtherUser,
  isRemoteChannelMessage,
} from "../utils/messageOwnership.ts";
import { normalizeUuid, isValidUuid } from "../utils/uuidUtils.ts";
import {
  createDmChat,
  discoverUsersAndGroups,
  createChannelChat,
  createGroupChat,
  deleteMessage,
  deleteAccount,
  deleteGroupChat,
  editMessage,
  fetchHealth,
  getProfileByUsername,
  fetchPresence,
  getChatPreview,
  getGroupInviteLink,
  getMessagesUploadUrl,
  getSseStreamUrl,
  hideChats,
  leaveGroupChat,
  listChatsForUser,
  listCalls,
  listMessagesByQuery,
  logout,
  markMessageRead,
  markMessagesRead,
  fetchFirstUnreadMessage,
  deleteCall,
  searchUsers,
  sendTypingIndicator,
  sendMessage,
  removeGroupMember,
  removeGroupAvatar,
  regenerateGroupInviteLink,
  setChatMute,
  getRemoteChannelSettings,
  updateChannelChat,
  getMessageReadCounts,
  updateRemoteChannelSettings,
  updateGroupChat,
  uploadGroupAvatar,
  getSavedMessagesChat,
  fetchPushPublicKey,
  forwardMessage,
  subscribePush,
  unsubscribePush,
  sendPushTest,
  updatePassword,
  updateProfile,
  updateStatus as updateStatusRequest,
  uploadAvatar,
  uploadAvatarFile,
  prepareFilesForMessage,
} from "../api/chatApi.ts";
import { useMessageMaxChars } from "../settings/appConfig.ts";
import {
  MOBILE_CLOSE_ANIMATION_MS,
  NEW_CHAT_SEARCH_DEBOUNCE_MS,
  NOTIFICATION_PREVIEW_MAX_CHARS,
  OPEN_CHAT_ID_KEY,
  UPLOAD_PROGRESS_HIDE_DELAY_MS,
} from "../utils/chatPageConstants.ts";

const loadChatProfileModal = () => import("../components/modals/ChatProfileModal.tsx");
const loadChatFilesModal = () => import("../components/modals/ChatFilesModal.tsx");
const loadChatSearchModal = () => import("../components/modals/ChatSearchModal.tsx");
const loadDeleteChatsModal = () => import("../components/modals/DeleteChatsModal.tsx");
const loadDeleteMessageScopeModal = () =>
  import("../components/modals/DeleteMessageScopeModal.tsx");
const loadForwardMessageModal = () =>
  import("../components/modals/ForwardMessageModal.tsx");
const loadLeaveGroupModal = () => import("../components/modals/LeaveGroupModal.tsx");
const loadGroupInviteLinkModal = () => import("../components/modals/GroupInviteLinkModal.tsx");
const loadNewChatModal = () => import("../components/modals/NewChatModal.tsx");
const loadSupportRequestModal = () => import("../components/modals/SupportRequestModal.tsx");
const loadNewCallModal = () => import("../components/modals/NewCallModal.tsx");
const loadNewGroupModal = () => import("../components/modals/NewGroupModal.tsx");
const loadNotificationsSettingsModal = () =>
  import("../components/settings/modals/NotificationsSettingsModal.tsx").then((mod) => ({
    default: mod.NotificationsSettingsModal,
  }));
const loadWhatsNewModal = () => import("../components/modals/WhatsNewModal.tsx");

const ChatProfileModal: any = lazy(loadChatProfileModal);
const ChatFilesModal: any = lazy(loadChatFilesModal);
const ChatSearchModal: any = lazy(loadChatSearchModal);
const DeleteChatsModal: any = lazy(loadDeleteChatsModal);
const DeleteMessageScopeModal: any = lazy(loadDeleteMessageScopeModal);
const ForwardMessageModal: any = lazy(loadForwardMessageModal);
const LeaveGroupModal: any = lazy(loadLeaveGroupModal);
const GroupInviteLinkModal: any = lazy(loadGroupInviteLinkModal);
const NewChatModal: any = lazy(loadNewChatModal);
const SupportRequestModal: any = lazy(loadSupportRequestModal);
const NewCallModal: any = lazy(loadNewCallModal);
const NewGroupModal: any = lazy(loadNewGroupModal);
const NotificationsSettingsModal: any = lazy(loadNotificationsSettingsModal);
const WhatsNewModal: any = lazy(loadWhatsNewModal);

const preloadChatPageCriticalChunks = () =>
  Promise.allSettled([
    loadNewChatModal(),
    loadNewCallModal(),
    loadNewGroupModal(),
    loadNotificationsSettingsModal(),
    loadWhatsNewModal(),
  ]);

const preloadChatPageLazyChunks = () =>
  Promise.allSettled([
    loadChatProfileModal(),
    loadDeleteChatsModal(),
    loadDeleteMessageScopeModal(),
    loadForwardMessageModal(),
    loadLeaveGroupModal(),
    loadGroupInviteLinkModal(),
    loadNewChatModal(),
    loadNewCallModal(),
    loadNewGroupModal(),
    loadNotificationsSettingsModal(),
    loadWhatsNewModal(),
  ]);

const resolveChunkPreloadMode = () => {
  if (typeof navigator === "undefined") return "eager";
  const connection =
    navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) return "eager";
  if (connection.saveData) return "idle";
  const effectiveType: any = String(connection.effectiveType || "").toLowerCase();
  if (effectiveType === "slow-2g" || effectiveType === "2g") return "idle";
  return "eager";
};

const IN_MEMORY_MESSAGES_CACHE_MAX_CHATS = 8;
const IN_MEMORY_MESSAGES_PER_CHAT = 480;
const IN_MEMORY_MESSAGES_CACHE_STALE_MS = 20 * 60 * 1000;

const pruneMessagesForMemory = (messages) => {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length <= IN_MEMORY_MESSAGES_PER_CHAT) return list;
  return list.slice(-IN_MEMORY_MESSAGES_PER_CHAT);
};

const getMessageContextKey = (message) =>
  String(message?._clientId ?? message?._serverId ?? message?.id ?? "");

const normalizeMessagesCachePayloadForMemory = (payload) => {
  if (!payload || !Array.isArray(payload.messages)) return payload;
  const trimmedMessages: any = pruneMessagesForMemory(payload.messages);
  if (trimmedMessages === payload.messages) return payload;
  const nextLastMessageId = trimmedMessages.length
    ? (trimmedMessages[trimmedMessages.length - 1]?.id || null)
    : null;
  return {
    ...payload,
    messages: trimmedMessages,
    hasOlderMessages: true,
    lastMessageId: nextLastMessageId,
    updatedAt: Date.now(),
  };
};

const readMessagesCacheMemory = (cacheMap, chatId) => {
  const cacheKey: any = String(chatId || "");
  if (!cacheKey || !cacheMap?.has(cacheKey)) return null;
  const value: any = cacheMap.get(cacheKey);
  cacheMap.delete(cacheKey);
  cacheMap.set(cacheKey, value);
  return value;
};

const pruneMessagesCacheMemory = (cacheMap, activeChatId: any = null) => {
  if (!cacheMap || !cacheMap.size) return;
  const activeId: any = String(activeChatId || "");
  const now: any = Date.now();
  const staleKeys: any = [];
  cacheMap.forEach((value, key) => {
    const updatedAt: any = Number(value?.updatedAt || 0);
    if (!updatedAt) return;
    if (activeId && String(key) === activeId) return;
    if (now - updatedAt > IN_MEMORY_MESSAGES_CACHE_STALE_MS) {
      staleKeys.push(key);
    }
  });
  staleKeys.forEach((key) => cacheMap.delete(key));
  while (cacheMap.size > IN_MEMORY_MESSAGES_CACHE_MAX_CHATS) {
    const oldestKey = cacheMap.keys().next().value;
    if (oldestKey === undefined) break;
    if (activeId && String(oldestKey) === activeId && cacheMap.size > 1) {
      const activeValue: any = cacheMap.get(oldestKey);
      cacheMap.delete(oldestKey);
      cacheMap.set(oldestKey, activeValue);
      continue;
    }
    cacheMap.delete(oldestKey);
  }
};

const writeMessagesCacheMemory = (cacheMap, chatId, payload, activeChatId: any = null) => {
  const cacheKey: any = String(chatId || "");
  if (!cacheKey || !payload || !cacheMap) return;
  const normalized: any = normalizeMessagesCachePayloadForMemory(payload);
  cacheMap.set(cacheKey, normalized);
  if (cacheMap.size > 1) {
    const current: any = cacheMap.get(cacheKey);
    cacheMap.delete(cacheKey);
    cacheMap.set(cacheKey, current);
  }
  pruneMessagesCacheMemory(cacheMap, activeChatId || cacheKey);
};

const patchChatAndMoveToFront = (chats, chatId, updateChat) => {
  const targetChatId: any = String(chatId || "");
  if (!targetChatId) return chats;
  const index: any = chats.findIndex((chat) => String(chat?.id || "") === targetChatId);
  if (index < 0) return chats;
  const currentChat = chats[index];
  const nextChat: any = updateChat(currentChat);
  if (!nextChat || nextChat === currentChat) return chats;
  if (index === 0) {
    const nextChats: any = chats.slice();
    nextChats[0] = nextChat;
    return nextChats;
  }
  const nextChats: any = chats.slice();
  nextChats.splice(index, 1);
  nextChats.unshift(nextChat);
  return nextChats;
};

const normalizeInviteUsername = (value) =>
  String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

const buildInvitePathForChat = (chat) => {
  const visibility: any = String(
    chat?.group_visibility || chat?.visibility || "public",
  )
    .trim()
    .toLowerCase();
  const username: any = normalizeInviteUsername(
    chat?.group_username || chat?.username,
  );
  if (visibility === "public" && username) {
    return `/invite/${encodeURIComponent(username)}`;
  }
  const token: any = String(chat?.inviteToken || chat?.invite_token || "").trim();
  return token ? `/invite/${encodeURIComponent(token)}` : "";
};

const getInviteOrigin = () => {
  if (typeof window === "undefined") return "";
  return String(window.location?.origin || "").replace(/\/+$/, "");
};

const buildInviteLinkForChat = (chat) => {
  const path: any = buildInvitePathForChat(chat);
  if (!path) return "";
  const origin: any = getInviteOrigin();
  return origin ? `${origin}${path}` : path;
};

export default function ChatPage({ user, setUser, isDark, setIsDark, toggleTheme, adminPanelEnabled = true }: any) {
  /* eslint-disable react-hooks/exhaustive-deps */
  const { t, lang } = useI18n();
  const messageMaxChars: any = useMessageMaxChars();
  const [profileError, setProfileError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [loadingChats, setLoadingChats] = useState(true);
  const [chats, setChats] = useState<any>([]);
  const [activeChatId, setActiveChatId] = useState<any>(null);
  const [messages, setMessages] = useState<any>([]);
  const [channelSeenCounts, setChannelSeenCounts] = useState<any>({});
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [mobileTab, setMobileTab] = useState("chats");
  const [calls, setCalls] = useState<any>([]);
  const [loadingCalls, setLoadingCalls] = useState(false);
  const [callsEditMode, setCallsEditMode] = useState(false);
  const [selectedCalls, setSelectedCalls] = useState<any>([]);
  const [newCallOpen, setNewCallOpen] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<any>(null);
  const [chatsSearchFocused, setChatsSearchFocused] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileModalMember, setProfileModalMember] = useState<any>(null);
  const [profileInviteLink, setProfileInviteLink] = useState("");
  const [profileInviteLinkLoading, setProfileInviteLinkLoading] = useState(false);
  const [profileRemoteChannelStatus, setProfileRemoteChannelStatus] = useState<any>(null);
  const [mentionProfile, setMentionProfile] = useState<any>(null);
  const [mentionRefreshToken, _setMentionRefreshToken] = useState(0);
  const [editingGroup, setEditingGroup] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedChats, setSelectedChats] = useState<any>([]);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<any>([]);
  const [confirmDeleteCallOpen, setConfirmDeleteCallOpen] = useState(false);
  const [pendingDeleteCallIds, setPendingDeleteCallIds] = useState<any>([]);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [pendingLeaveChatId, setPendingLeaveChatId] = useState<any>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [unreadInChat, setUnreadInChat] = useState(0);
  const [unreadMarkerId, setUnreadMarkerId] = useState<any>(null);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<any>([]);
  const [pendingUploadType, setPendingUploadType] = useState("");
  const [pendingVoiceMessage, setPendingVoiceMessage] = useState<any>(null);
  const [uploadError, setUploadError] = useState("");
  const [activeUploadProgress, setActiveUploadProgress] = useState<any>(null);
  const [replyTarget, setReplyTarget] = useState<any>(null);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [messageDeleteScopeOpen, setMessageDeleteScopeOpen] = useState(false);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<any>(null);
  const [forwardMessageTarget, setForwardMessageTarget] = useState<any>(null);
  const [forwardSavedChat, setForwardSavedChat] = useState<any>(null);
  const [forwardedChatPreviewById, setForwardedChatPreviewById] = useState<any>({});
  const [forwardedUserPreviewByKey, setForwardedUserPreviewByKey] = useState<any>({});
  const [forwardedChatPreviewTick, setForwardedChatPreviewTick] = useState(0);
  const [copyToastVisible, setCopyToastVisible] = useState(false);
  const updateToastTimerRef: any = useRef<any>(null);
  const copyToastTimerRef: any = useRef<any>(null);
  const chatScrollRef: any = useRef<any>(null);
  const composerInputRef: any = useRef<any>(null);
  const lastMessageIdRef: any = useRef<any>(null);
  const isAtBottomRef: any = useRef(true);
  const userScrolledUpRef: any = useRef(false);
  const pendingScrollToBottomRef: any = useRef(false);
  const pendingScrollToUnreadRef: any = useRef<any>(null);
  const unreadMarkerIdRef: any = useRef<any>(null);
  const openingHadUnreadRef: any = useRef(false);
  const openingUnreadCountRef: any = useRef(0);
  const allowStartReachedRef: any = useRef(false);
  const unreadAnchorLockUntilRef: any = useRef(0);
  const unreadAlignTimersRef: any = useRef<any>([]);
  const suppressScrolledUpRef: any = useRef(false);
  const shouldAutoMarkReadRef: any = useRef(true);
  const openingChatRef: any = useRef(false);
  const smoothScrollLockRef: any = useRef(0);
  const pendingUploadFilesRef: any = useRef<any>([]);
  const pendingVoiceMessageRef: any = useRef<any>(null);
  const prevUploadProgressRef: any = useRef<any>(null);
  const activeUploadProgressHideTimerRef: any = useRef<any>(null);
  const mediaLoadSnapTimerRef: any = useRef<any>(null);
  const messageRefreshTimerRef: any = useRef<any>(null);
  const forwardedChatPreviewInFlightRef: any = useRef(new Set<any>());
  const forwardedUserPreviewInFlightRef: any = useRef(new Set<any>());
  const channelSeenQueueRef: any = useRef<any>([]);
  const channelSeenActiveRef: any = useRef(false);
  const channelSeenLoadedRef: any = useRef(new Set<any>());
  // Always-current snapshot of messages for use in callbacks without stale closures
  const messagesRef: any = useRef<any>([]);
  const channelSeenTimerRef: any = useRef<any>(null);
  const channelSeenLatestRefreshRef: any = useRef(0);
  const messagesCacheRef: any = useRef(new Map<any, any>());
  const messagesCacheWriteTimerRef: any = useRef<any>(null);
  const messageBlobUrlsRef: any = useRef(new Set<any>());
  const [sseConnected, setSseConnected] = useState(false);
  const lazyChunksPreloadedRef: any = useRef(false);
  const [showFloatingLabel, setShowFloatingLabel] = useState(false);

  useEffect(() => {
    setReplyTarget(null);
    setEditTarget(null);
    setMessageDeleteScopeOpen(false);
    setPendingDeleteMessage(null);
    setForwardMessageTarget(null);
    setForwardSavedChat(null);
    setShowFloatingLabel(false);
  }, [activeChatId]);

  useEffect(() => {
    if (lazyChunksPreloadedRef.current) return;
    let cancelled = false;
    let idleId: any = null;
    let criticalTimerId: any = null;
    let timerId: any = null;
    const mode: any = resolveChunkPreloadMode();
    const eagerNetwork = mode === "eager";

    const warmCritical = () => {
      if (cancelled) return;
      void preloadChatPageCriticalChunks();
    };

    const warm = () => {
      if (cancelled) return;
      if (lazyChunksPreloadedRef.current) return;
      lazyChunksPreloadedRef.current = true;
      void preloadChatPageLazyChunks();
    };
    const handleFirstIntent = () => {
      warm();
    };
    window.addEventListener("pointerdown", handleFirstIntent, {
      once: true,
      passive: true,
      capture: true,
    });
    window.addEventListener("keydown", handleFirstIntent, {
      once: true,
      passive: true,
      capture: true,
    });

    criticalTimerId = window.setTimeout(warmCritical, eagerNetwork ? 90 : 240);
    if (eagerNetwork) {
      timerId = window.setTimeout(warm, 120);
    } else if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(warm, { timeout: 1500 });
    } else {
      timerId = window.setTimeout(warm, 900);
    }
    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", handleFirstIntent, {
        capture: true,
      });
      window.removeEventListener("keydown", handleFirstIntent, {
        capture: true,
      });
      if (
        idleId !== null &&
        typeof window !== "undefined" &&
        typeof window.cancelIdleCallback === "function"
      ) {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== null && typeof window !== "undefined") {
        window.clearTimeout(timerId);
      }
      if (criticalTimerId !== null && typeof window !== "undefined") {
        window.clearTimeout(criticalTimerId);
      }
    };
  }, []);

  const { dataCacheStats, handleClearCache } = useChatCacheStats({
    user,
    settingsPanel,
    messagesCacheRef,
  });
  const {
    appInfo,
    appInfoLoading,
    appInfoError,
    whatsNewOpen,
    openWhatsNew,
    dismissWhatsNew,
  } = useAppReleaseInfo();
  const { isAppActive } = useAppActivity();
  const { isMobileViewport } = useMobileViewport();
  const { isConnected } = useHealthCheck({
    fetchHealth,
    intervalMs: CHAT_PAGE_CONFIG.healthCheckIntervalMs,
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const hasTopLayerModal: any = Boolean(profileModalOpen);
    if (hasTopLayerModal) {
      root.style.setProperty("--app-z", "90");
    } else if (isMobileViewport && activeChatId) {
      root.style.setProperty("--app-z", "40");
    } else {
      root.style.setProperty("--app-z", "20");
    }
    return () => {
      root.style.setProperty("--app-z", "20");
    };
  }, [activeChatId, isMobileViewport, profileModalOpen]);

  const {
    notificationsModalOpen,
    setNotificationsModalOpen,
    notificationsEnabled,
    notificationPermission,
    notificationsSupported,
    notificationsActive,
    notificationsDisabled,
    notificationStatusLabel,
    notificationsDebugLine,
    messagePreviewEnabled,
    handleToggleNotifications,
    handleToggleMessagePreview,
  } = useChatNotifications({
    user,
    settingsPanel,
    fetchPushPublicKey,
    subscribePush,
    unsubscribePush,
    sendPushTest,
  });

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const handleSwMessage = (event) => {
      if (event?.data?.type !== "APP_SHELL_UPDATED") return;
      setIsUpdatingChats(true);
      if (updateToastTimerRef.current) {
        window.clearTimeout(updateToastTimerRef.current);
      }
      updateToastTimerRef.current = window.setTimeout(() => {
        setIsUpdatingChats(false);
      }, 2000);
    };
    navigator.serviceWorker.addEventListener("message", handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handleSwMessage);
      if (updateToastTimerRef.current) {
        window.clearTimeout(updateToastTimerRef.current);
      }
    };
  }, []);

  const showCopiedToast: any = useCallback(() => {
    setCopyToastVisible(true);
    if (copyToastTimerRef.current) {
      window.clearTimeout(copyToastTimerRef.current);
    }
    copyToastTimerRef.current = window.setTimeout(() => {
      setCopyToastVisible(false);
    }, 1400);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleClipboardCopy = () => {
      showCopiedToast();
    };
    window.addEventListener(CLIPBOARD_COPY_EVENT, handleClipboardCopy);
    return () => {
      window.removeEventListener(CLIPBOARD_COPY_EVENT, handleClipboardCopy);
      if (copyToastTimerRef.current) {
        window.clearTimeout(copyToastTimerRef.current);
      }
    };
  }, [showCopiedToast]);

  useEffect(() => {
    if (!isMobileViewport) return;
    if (activeChatId) {
      window.dispatchEvent(new Event("nextdesk-hide-install-bar"));
    } else {
      window.dispatchEvent(new Event("nextdesk-show-install-bar"));
    }
  }, [activeChatId, isMobileViewport]);
  const [microphonePermission, setMicrophonePermission] = useState("unknown");
  const [microphonePermissionSupported, setMicrophonePermissionSupported] =
    useState(false);
  const [permissionPromptDelayUntil, setPermissionPromptDelayUntil] = useState(0);
  const PERMISSION_DISMISS_PREFIX = "nextdesk-permission-dismiss-";
  const PERMISSION_DISMISS_MS = 3 * 24 * 60 * 60 * 1000;
  const PERMISSION_PROMPT_DELAY_MS = 1000;
  const readPermissionDismissed = (kind) => {
    if (typeof window === "undefined") return false;
    const key = `${PERMISSION_DISMISS_PREFIX}${kind}`;
    const raw: any = window.localStorage.getItem(key);
    if (!raw) return false;
    const until: any = Number(raw);
    if (!Number.isFinite(until) || until <= Date.now()) {
      window.localStorage.removeItem(key);
      return false;
    }
    return true;
  };
  const [permissionsDismissed, setPermissionsDismissed] = useState(() => ({
    notification: readPermissionDismissed("notification"),
    microphone: readPermissionDismissed("microphone"),
  }));
  const requestMicrophonePermission: any = useCallback(async () => {
    if (typeof navigator === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream: any = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream?.getTracks?.().forEach((track) => track.stop());
      setMicrophonePermission("granted");
      if (typeof window !== "undefined") {
        const key = `${PERMISSION_DISMISS_PREFIX}microphone`;
        const until = Date.now() + PERMISSION_DISMISS_MS;
        window.localStorage.setItem(key, String(until));
        setPermissionsDismissed((prev) => ({ ...prev, microphone: true }));
        setPermissionPromptDelayUntil(Date.now() + PERMISSION_PROMPT_DELAY_MS);
      }
    } catch (err) {
      const message: any = String(err?.name || err?.message || "");
      if (message.toLowerCase().includes("notallowed")) {
        setMicrophonePermission("denied");
      }
    }
  }, [PERMISSION_DISMISS_MS, PERMISSION_DISMISS_PREFIX, PERMISSION_PROMPT_DELAY_MS]);
  const dismissPermissionsPrompt: any = useCallback(
    (mode) => {
      if (typeof window === "undefined") return;
      const kind = mode || "notification";
      const key = `${PERMISSION_DISMISS_PREFIX}${kind}`;
      const until = Date.now() + PERMISSION_DISMISS_MS;
      window.localStorage.setItem(key, String(until));
      setPermissionsDismissed((prev) => ({ ...prev, [kind]: true }));
      setPermissionPromptDelayUntil(Date.now() + PERMISSION_PROMPT_DELAY_MS);
    },
    [PERMISSION_DISMISS_MS, PERMISSION_PROMPT_DELAY_MS],
  );
  const requestNotificationsPermission: any = useCallback(async () => {
    if (notificationPermission !== "default") return;
    await handleToggleNotifications();
  }, [handleToggleNotifications, notificationPermission]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    let active = true;
    let permissionStatus: any = null;
    const handlePermissionChange = () => {
      if (!active || !permissionStatus) return;
      setMicrophonePermission(permissionStatus.state || "prompt");
    };
    const refresh = async () => {
      const supported: any = Boolean(navigator.mediaDevices?.getUserMedia);
      if (!active) return;
      setMicrophonePermissionSupported(supported);
      if (!supported) {
        setMicrophonePermission("unsupported");
        return;
      }
      if (!navigator.permissions?.query) {
        setMicrophonePermission("unknown");
        return;
      }
      try {
        permissionStatus = await navigator.permissions.query({
          name: "microphone",
        });
        if (!active) return;
        setMicrophonePermission(permissionStatus.state || "prompt");
        permissionStatus.addEventListener?.("change", handlePermissionChange);
      } catch {
        setMicrophonePermission("unknown");
      }
    };
    refresh();
    return () => {
      active = false;
      permissionStatus?.removeEventListener?.("change", handlePermissionChange);
    };
  }, [isAppActive]);
  const {
    newChatOpen,
    setNewChatOpen,
    newChatUsername,
    setNewChatUsername,
    newChatError,
    setNewChatError,
    newChatResults,
    setNewChatResults,
    newChatLoading,
    newChatSelection,
    setNewChatSelection,
  } = useNewChatSearch({
    user,
    searchUsers,
    debounceMs: NEW_CHAT_SEARCH_DEBOUNCE_MS,
    maxResults: CHAT_PAGE_CONFIG.newChatSearchMaxResults,
  });
  const {
    chatsSearchQuery,
    setChatsSearchQuery,
    discoverLoading,
    discoverUsers,
    discoverGroups,
    discoverChannels,
    discoverSaved,
  } = useDiscoverSearch({
    user,
    discoverUsersAndGroups,
    debounceMs: NEW_CHAT_SEARCH_DEBOUNCE_MS,
    maxResults: CHAT_PAGE_CONFIG.newChatSearchMaxResults,
  });
  const {
    newGroupOpen,
    setNewGroupOpen,
    creatingGroup,
    setCreatingGroup,
    groupModalType,
    setGroupModalType,
    newGroupForm,
    setNewGroupForm,
    newGroupSearch,
    setNewGroupSearch,
    newGroupSearchResults,
    setNewGroupSearchResults,
    newGroupSearchLoading,
    newGroupMembers,
    setNewGroupMembers,
    newGroupError,
    setNewGroupError,
    groupInviteOpen,
    setGroupInviteOpen,
    createdGroupInviteLink,
    setCreatedGroupInviteLink,
    createdGroupInviteType,
    setCreatedGroupInviteType,
    editGroupInviteToken,
    setEditGroupInviteToken,
    regeneratingGroupInviteLink,
    setRegeneratingGroupInviteLink,
  } = useNewGroupModal({
    user,
    chats,
    activeChatId,
    editingGroup,
    searchUsers,
    debounceMs: NEW_CHAT_SEARCH_DEBOUNCE_MS,
    maxResults: CHAT_PAGE_CONFIG.newChatSearchMaxResults,
  });
  const [profileForm, setProfileForm] = useState({
    nickname: user?.nickname || "",
    username: user?.username || "",
    avatarUrl: user?.avatarUrl || "",
  });
  const [avatarPreview, setAvatarPreview] = useState(user?.avatarUrl || "");
  const [groupAvatarPreview, setGroupAvatarPreview] = useState("");
  const [groupAvatarMarkedForRemoval, setGroupAvatarMarkedForRemoval] = useState(false);
  const [pendingGroupAvatarFile, setPendingGroupAvatarFile] = useState<any>(null);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<any>(null);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [statusSelection, setStatusSelection] = useState(
    user?.status || "online",
  );
  const [isUpdatingChats, setIsUpdatingChats] = useState(false);
  const [sidebarScrollEpoch, setSidebarScrollEpoch] = useState(0);
  const [chatsScrollToTopEpoch, setChatsScrollToTopEpoch] = useState(0);
  const [activePeer, setActivePeer] = useState<any>(null);
  const [peerPresence, setPeerPresence] = useState({
    status: "offline",
    rawStatus: "offline",
    lastSeen: null,
  });
  const [typingByChat, setTypingByChat] = useState<any>({});

  const activeChatIdRef: any = useRef<any>(null);
  const activeChatTypeRef: any = useRef<any>(null);
  const sseReconnectRef: any = useRef<any>(null);
  const isMarkingReadRef: any = useRef(false);
  const sendingClientIdsRef: any = useRef(new Set<any>());
  const usernameRef: any = useRef(String(user?.username || ""));
  const loadChatsRef: any = useRef<any>(null);
  const scheduleMessageRefreshRef: any = useRef<any>(null);
  const presenceStateRef: any = useRef(new Map<any, any>());
  const typingStateRef: any = useRef({
    chatId: 0,
    isTyping: false,
    lastSentAt: 0,
  });
  const typingStopTimerRef: any = useRef<any>(null);
  const typingExpiryTimersRef: any = useRef(new Map<any, any>());
  const loadChatsAbortRef: any = useRef<any>(null);
  const loadChatsInFlightRef: any = useRef(false);
  const queuedLoadChatsOptionsRef: any = useRef<any>(null);

  const clearUnreadAlignTimers = () => {
    unreadAlignTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    unreadAlignTimersRef.current = [];
  };

  const TYPING_IDLE_TIMEOUT_MS = 3000;
  const TYPING_SIGNAL_THROTTLE_MS = 1500;
  const TYPING_REMOTE_TTL_MS = 5000;

  const clearTypingExpiryTimer: any = useCallback((chatId, username) => {
    const key = `${String(chatId || "")}:${String(username || "").toLowerCase()}`;
    const timer: any = typingExpiryTimersRef.current.get(key);
    if (timer) {
      window.clearTimeout(timer);
      typingExpiryTimersRef.current.delete(key);
    }
  }, []);

  const removeTypingUser: any = useCallback((chatId, username) => {
    const normalizedUsername: any = String(username || "").toLowerCase();
    const chatKey: any = String(chatId || "");
    if (!chatKey || !normalizedUsername) return;
    setTypingByChat((prev) => {
      const chatTyping = prev?.[chatKey];
      if (!chatTyping || !chatTyping[normalizedUsername]) return prev;
      const nextChatTyping: any = { ...chatTyping };
      delete nextChatTyping[normalizedUsername];
      if (!Object.keys(nextChatTyping).length) {
        const next: any = { ...prev };
        delete next[chatKey];
        return next;
      }
      return {
        ...prev,
        [chatKey]: nextChatTyping,
      };
    });
  }, []);

  const setTypingUser: any = useCallback(
    (chatId, username, nickname = "") => {
      const normalizedUsername: any = String(username || "").toLowerCase();
      const chatKey: any = String(chatId || "");
      if (!chatKey || !normalizedUsername) return;
      setTypingByChat((prev) => {
        const chatTyping = prev?.[chatKey] || {};
        const nextChatTyping: any = {
          ...chatTyping,
          [normalizedUsername]: {
            username: normalizedUsername,
            nickname: String(nickname || "").trim() || normalizedUsername,
            updatedAt: Date.now(),
          },
        };
        return {
          ...prev,
          [chatKey]: nextChatTyping,
        };
      });
    },
    [],
  );

  const scheduleTypingExpiry: any = useCallback(
    (chatId, username) => {
      const normalizedUsername: any = String(username || "").toLowerCase();
      const chatKey: any = String(chatId || "");
      if (!chatKey || !normalizedUsername) return;
      clearTypingExpiryTimer(chatKey, normalizedUsername);
      const key = `${chatKey}:${normalizedUsername}`;
      const timer: any = window.setTimeout(() => {
        typingExpiryTimersRef.current.delete(key);
        removeTypingUser(chatKey, normalizedUsername);
      }, TYPING_REMOTE_TTL_MS);
      typingExpiryTimersRef.current.set(key, timer);
    },
    [clearTypingExpiryTimer, removeTypingUser, TYPING_REMOTE_TTL_MS],
  );

  const sendTypingSignal: any = useCallback(
    (chatId, isTyping) => {
      const chatKey: any = String(chatId || "");
      const currentUsername: any = String(usernameRef.current || "").toLowerCase();
      if (!chatKey || !currentUsername) return;
      const activeChatType: any = String(activeChatTypeRef.current || "").toLowerCase();
      if (Boolean(isTyping) && activeChatType === "channel") return;
      const canBroadcastTyping =
        String(user?.status || "").toLowerCase() === "online";
      if (!canBroadcastTyping && Boolean(isTyping)) return;
      sendTypingIndicator({
        chatId: chatKey,
        username: currentUsername,
        isTyping: Boolean(isTyping),
      }).catch(() => null);
    },
    [user?.status],
  );

  const clearLocalTypingStopTimer: any = useCallback(() => {
    if (typingStopTimerRef.current) {
      window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
  }, []);

  const stopTypingIndicator: any = useCallback(
    (chatIdOverride: any = null) => {
      const targetChatId =
        chatIdOverride ||
        typingStateRef.current.chatId || activeChatIdRef.current || null;
      if (!targetChatId) return;
      clearLocalTypingStopTimer();
      if (typingStateRef.current.isTyping) {
        sendTypingSignal(targetChatId, false);
      }
      typingStateRef.current = {
        chatId: targetChatId,
        isTyping: false,
        lastSentAt: Date.now(),
      };
    },
    [clearLocalTypingStopTimer, sendTypingSignal],
  );

  const handleStartReply = (msg) => {
    if (!msg) return;
    const targetId = msg.id || msg._serverId || null;
    if (!targetId) return;
    setEditTarget(null);
    // In channel chats, show the channel name instead of the message author's name
    const replyName = isActiveChannelChat
      ? (activeChat?.name || t("chat.chat.channel"))
      : (msg.nickname || msg.username || msg.replyTo?.nickname || msg.replyTo?.username || "");
    const replyColor = isActiveChannelChat
      ? (activeChat?.group_color || "#10b981")
      : (msg.color || "#10b981");
    const preview: any = resolveReplyPreview(msg);
    setReplyTarget({
      id: targetId,
      username: msg.username || "",
      nickname: msg.nickname || "",
      body: preview.text,
      icon: preview.icon,
      displayName: replyName || t("chat.chat.unknown"),
      color: replyColor,
      verified: isActiveChannelChat ? Boolean(activeChat?.verified) : Boolean(msg.user_verified),
      role: isActiveChannelChat ? null : (msg.user_role || null),
    });
    scrollToBottomIfSafe("auto");
  };

  const handleClearReply = () => {
    setReplyTarget(null);
    scrollToBottomIfSafe("auto");
  };

  const handleStartEdit = (msg) => {
    if (!msg) return;
    const targetId = msg.id || msg._serverId || null;
    if (!targetId) return;
    setReplyTarget(null);
    setEditTarget({
      id: targetId,
      username: msg.username || "",
      nickname: msg.nickname || "",
      displayName:
        msg.nickname || msg.username || activeChat?.name || t("chat.chat.unknown"),
      body: msg.body || "",
      files: Array.isArray(msg.files) ? msg.files : [],
    });
    scrollToBottomIfSafe("auto");
  };

  const handleClearEdit = () => {
    setEditTarget(null);
  };

  const handleOpenForwardModal = (message) => {
    if (!message) return;
    void (async () => {
      try {
        let savedChat: any = chats.find((chat) => String(chat?.type || "").toLowerCase() === "saved");
        if (!savedChat) {
          const res: any = await getSavedMessagesChat(user.username);
          const data: any = await res.json();
          if (res.ok && data?.id) {
            savedChat = {
              id: data.id,
              type: "saved",
              name: t("chat.chat.savedMessages"),
              members: [],
              group_color: "#10b981",
              group_avatar_url: "",
              last_outgoing_time: null,
              last_time: null,
            };
          }
        }
        setForwardSavedChat(savedChat || null);
      } catch {
        // ignore
      } finally {
        setForwardMessageTarget(message);
      }
    })();
  };

  const handleSaveMessageFiles: any = useCallback((message) => {
    const files: any = getMessageFiles(message);
    if (!files.length) return;
    downloadMessageFiles(files);
  }, []);

  // ─── Call Hooks ───────────────────────────────────────────────────────────
  const realtimeSenderRef: any = useRef<any>(null);
  const {
    callState,
    callEndReason,
    callFailureDetail,
    isCallClosing,
    callType,
    callPeer,
    callDuration,
    callQuality,
    isMuted,
    isCameraOff,
    isCameraUnavailable,
    isRemoteCameraOff,
    isSpeakerOn,
    isScreenSharing,
    isRemoteScreenSharing,
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    screenAudioRef,
    screenAudioStreamRef,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
    toggleSpeaker,
    toggleScreenShare,
    toggleScreenAudio,
    flipCamera,
    canFlipCamera,
    isScreenAudioMuted,
    handleSignal: handleCallSignal,
  } = useWebRTCCall({ realtimeSenderRef });
  // Screen sharing sends video, so it follows the video-call setting.
  const screenShareSupported =
    Boolean(CHAT_PAGE_CONFIG.callsEnabled) &&
    Boolean(CHAT_PAGE_CONFIG.videoCallsEnabled) &&
    isScreenShareSupported();

  const resolvedCallPeer: any = useMemo(() => {
    if (!callPeer) return null;
    const lowerUsername: any = String(callPeer.username || "").toLowerCase();
    let memberMatch: any = null;
    for (const chat of chats || []) {
      const found: any = (chat.members || []).find(
        (m) => String(m?.username || "").toLowerCase() === lowerUsername,
      );
      if (found) {
        memberMatch = found;
        break;
      }
    }
    return {
      ...callPeer,
      color: callPeer.color || memberMatch?.color || null,
      verified:
        callPeer.verified !== undefined
          ? callPeer.verified
          : memberMatch
            ? Boolean(memberMatch.user_verified ?? memberMatch.verified)
            : false,
      role:
        callPeer.role !== undefined
          ? callPeer.role
          : memberMatch?.user_role || memberMatch?.role || null,
    };
  }, [callPeer, chats]);

  const handleOpenForwardOrigin = async (target) => {
    if (!target) return;
    if (target.kind === "self") {
      openOwnProfileModal();
      return;
    }
    if (target.kind === "user") {
      const fallbackMember: any = {
        id: target.userId || null,
        username: target.username || "",
        nickname: target.nickname || "",
        avatar_url: target.avatar_url || "",
        color: target.color || "#10b981",
        status: "online",
        role: "",
      };
      const targetUsername: any = String(target.username || "").trim();
      if (!targetUsername) {
        openMemberProfileFromList({
          ...fallbackMember,
          _readOnly: true,
        });
        return;
      }
      try {
        const res: any = await getProfileByUsername(targetUsername);
        const data: any = await res.json().catch(() => ({}));
        if (res.ok) {
          openMemberProfileFromList({
            id: data?.id || fallbackMember.id || null,
            username: data?.username || fallbackMember.username || "",
            nickname:
              data?.nickname ||
              fallbackMember.nickname ||
              data?.username ||
              fallbackMember.username ||
              "",
            avatar_url: data?.avatarUrl || fallbackMember.avatar_url || "",
            color: data?.color || fallbackMember.color || "#10b981",
            status: data?.status || fallbackMember.status || "online",
            role: "",
          });
          return;
        }
        if (res.status === 404) {
          openMemberProfileFromList({
            ...fallbackMember,
            _readOnly: true,
          });
          return;
        }
      } catch {
        // ignore lookup failures and fall back to snapshot
      }
      openMemberProfileFromList(fallbackMember);
      return;
    }
    const numericChatId: any = String(target.chatId || "");
    if (!numericChatId) return;
    let targetChat: any = chats.find((chat) => String(chat.id) === numericChatId);
    if (!targetChat) {
      try {
        const res: any = await getChatPreview({
          chatId: numericChatId,
          username: user.username,
        });
        const data: any = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || "Unable to open forwarded chat.");
        }
        targetChat = {
          id: String(data?.id || numericChatId),
          type: data?.type || "group",
          name: data?.name || t("chat.chat.fallbackName"),
          group_username: data?.username || "",
          group_visibility: data?.visibility || "public",
          group_color: data?.color || "#10b981",
          group_avatar_url: data?.avatarUrl || "",
          invite_token: data?.inviteToken || "",
          membersCount: Number(data?.membersCount || 0),
          members: [],
          _previewOnly: true,
          _isMember: Boolean(data?.isMember),
        };
      } catch {
        setMentionProfile({
          kind: "group",
          chatId: numericChatId,
          name: target.label || t("chat.chat.fallbackName"),
          username: "",
          visibility: "private",
          color: target.color || "#10b981",
          avatarUrl: target.avatar_url || "",
          inviteToken: "",
          membersCount: 0,
          isMember: false,
          _actionState: "none",
          _readOnly: true,
        });
        setProfileModalOpen(true);
        return;
      }
    }
    if (String(targetChat.type || "").toLowerCase() === "dm") {
      const peer: any = (targetChat.members || []).find(
        (member) =>
          String(member?.username || "").toLowerCase() !==
          String(user?.username || "").toLowerCase(),
      );
      if (peer) {
        openMemberProfileFromList(peer);
      }
      return;
    }
    setMentionProfile({
      kind: String(targetChat.type || "group").toLowerCase(),
      chatId: Number(targetChat.id || 0),
      name: targetChat.name || t("chat.chat.fallbackName"),
      username: targetChat.group_username || "",
      visibility: targetChat.group_visibility || "public",
      color: targetChat.group_color || "#10b981",
      avatarUrl: targetChat.group_avatar_url || "",
      inviteToken: targetChat.invite_token || "",
      membersCount:
        Array.isArray(targetChat.members) && targetChat.members.length
          ? targetChat.members.length
          : Number(targetChat.membersCount || 0),
      isMember:
        targetChat._previewOnly === true
          ? Boolean(targetChat._isMember)
          : true,
    });
    setProfileModalOpen(true);
  };

  const scheduleUnreadAnchorAlignment = (unreadId) => {
    clearUnreadAlignTimers();
    const attempt = () => {
      const divider =
        document.getElementById(`unread-divider-${unreadId}`) ||
        document.getElementById(`message-${unreadId}`);
      if (!divider) return false;
      const scroller = chatScrollRef.current;
      if (scroller) {
        const dividerRect: any = divider.getBoundingClientRect();
        const containerRect: any = scroller.getBoundingClientRect();
        const offsetTop =
          scroller.scrollTop + (dividerRect.top - containerRect.top) - 12;
        scroller.scrollTo({ top: Math.max(0, offsetTop), behavior: "auto" });
      } else if (typeof divider.scrollIntoView === "function") {
        divider.scrollIntoView({ block: "start", behavior: "auto" });
      }
      return true;
    };
    attempt();
    for (let i = 1; i <= 12; i += 1) {
      const timer: any = window.setTimeout(() => {
        if (Date.now() > Number(unreadAnchorLockUntilRef.current || 0)) return;
        if (userScrolledUpRef.current === false) return;
        attempt();
      }, i * 80);
      unreadAlignTimersRef.current.push(timer);
    }
  };

  const setPendingUploadProgress = (clientId, progress, chatId: any = null) => {
    const nextProgress: any = Math.max(0, Math.min(100, Number(progress || 0)));
    const activeId: any = String(activeChatIdRef.current || "");
    const targetId: any = String(chatId || "");
    if (!targetId || activeId === targetId) {
      setActiveUploadProgress(nextProgress);
    }
    setMessages((prev) =>
      prev.map((msg) =>
        msg._clientId === clientId ? { ...msg, _uploadProgress: nextProgress } : msg,
      ),
    );
  };

  const scheduleActiveUploadProgressHide: any = useCallback(() => {
    if (activeUploadProgressHideTimerRef.current) {
      window.clearTimeout(activeUploadProgressHideTimerRef.current);
    }
    activeUploadProgressHideTimerRef.current = window.setTimeout(() => {
      activeUploadProgressHideTimerRef.current = null;
      setActiveUploadProgress(null);
    }, UPLOAD_PROGRESS_HIDE_DELAY_MS);
  }, []);

  const updateOwnLatestChatPreview = ({
    chatId,
    body = "",
    files = [],
    createdAt = null,
    messageId = null,
  }: any) => {
    const targetChatId: any = String(chatId || "");
    if (!targetChatId) return;
    const previewTime = createdAt || new Date().toISOString();
    const previewBody: any = normalizeMessageBody(body).trim();
    const previewFiles = Array.isArray(files)
      ? files.map((file) => ({
          id: file?.id || file?._localId || null,
          kind: file?.kind || "document",
          name: file?.name || "",
          mimeType: file?.mimeType || "",
          sizeBytes: Number(file?.sizeBytes || 0) || 0,
          width: Number.isFinite(Number(file?.width)) ? Number(file.width) : null,
          height: Number.isFinite(Number(file?.height)) ? Number(file.height) : null,
          durationSeconds: Number.isFinite(Number(file?.durationSeconds))
            ? Number(file.durationSeconds)
            : null,
          url: file?.url || file?._localUrl || null,
          processing: Boolean(file?.processing),
        }))
      : [];
    setChats((prev) => {
      return patchChatAndMoveToFront(prev, targetChatId, (chat) => {
        const isSaved = chat?.type === "saved";
        return {
          ...chat,
          last_message_id:
            Number(messageId || 0) || chat?.last_message_id || null,
          last_message: previewBody || chat?.last_message || "",
          last_message_files: previewFiles,
          last_time: previewTime,
          last_sender_username: user.username,
          last_sender_nickname: user.nickname || user.username,
          last_sender_avatar_url: user.avatarUrl || "",
          last_message_client_request_id: null,
          last_message_read_at: isSaved
            ? previewTime
            : chat?.last_message_read_at || null,
        };
      });
    });
  };

  const isAmbiguousSendStatus = (status) =>
    [502, 503, 504].includes(Number(status || 0));

  const createAmbiguousSendError = (status, message) => {
    const error: any = new Error(
      message || t("chat.errors.unconfirmedDelivery", { code: status }),
    );
    error._ambiguousSendStatus = Number(status || 0);
    return error;
  };

  const scheduleMessageRefresh = (chatId, options: any = {}) => {
    if (!chatId) return;
    if (messageRefreshTimerRef.current) {
      window.clearTimeout(messageRefreshTimerRef.current);
    }
    const { delayMs, tailDelta, ...loadOptions } = options;
    const refreshDelayMs = Number.isFinite(Number(delayMs))
      ? Math.max(0, Number(delayMs))
      : 280;
    // For plain appends (new messages) on the active chat we don't need to
    // re-pull the whole window. Anchor a bounded tail fetch on the newest
    // loaded message so only brand-new rows come down. We still fall back to a
    // full window fetch when we have no usable anchor (e.g. empty chat) or when
    // the caller needs a full reconcile (pruneMissing / prepend / afterId).
    let deltaOptions: any = null;
    if (
      tailDelta &&
      !loadOptions.prepend &&
      !loadOptions.pruneMissing &&
      !loadOptions.afterId
    ) {
      const current = messagesRef.current || [];
      let anchor: any = null;
      for (let i = current.length - 1; i >= 0; i -= 1) {
        const candidate = current[i];
        const serverId: any = String(candidate?._serverId || candidate?.id || "");
        if (
          serverId &&
          candidate?.created_at &&
          String(candidate?._chatId || chatId) === String(chatId)
        ) {
          anchor = candidate;
          break;
        }
      }
      if (anchor) {
        deltaOptions = {
          afterId: String(anchor._serverId || anchor.id),
          afterCreatedAt: anchor.created_at,
          tailDelta: true,
          limit: CHAT_PAGE_CONFIG.messageFetchLimit,
        };
      }
    }
    messageRefreshTimerRef.current = window.setTimeout(() => {
      messageRefreshTimerRef.current = null;
      void loadMessages(chatId, {
        silent: true,
        preserveHistory: true,
        ...loadOptions,
        ...(deltaOptions || {}),
      });
    }, refreshDelayMs);
  };

  const fileUploadInProgress: any = useMemo(
    () =>
      messages.some(
        (msg) =>
          msg?._delivery === "sending" &&
          Array.isArray(msg?._files) &&
          msg._files.length > 0,
      ),
    [messages],
  );
  const canMarkReadInCurrentView = !isMobileViewport || mobileTab === "chat";
  const {
    handleChatScroll,
    handleJumpToLatest,
    handleMessageMediaLoaded,
    scrollChatToBottom,
    cancelSmoothScroll,
  } = useChatScroll({
    activeChatId,
    canMarkReadInCurrentView,
    chatScrollRef,
    clearUnreadAlignTimers,
    smoothScrollLockRef,
    messages,
    user,
    isAppActive,
    markMessagesRead,
    pendingScrollToUnreadRef,
    isAtBottomRef,
    userScrolledUpRef,
    unreadAnchorLockUntilRef,
    suppressScrolledUpRef,
    mediaLoadSnapTimerRef,
    activeChatIdRef,
    isMarkingReadRef,
    setUnreadInChat,
    setIsAtBottom,
    setUserScrolledUp,
    setChats,
    unreadMarkerIdRef,
    openingChatRef,
    setShowFloatingLabel
  });

  /**
   * Scroll to bottom only when it is safe to do so.
   *
   * @param {"auto"|"smooth"} behavior
   * @param {{ force?: boolean }} opts  Pass force:true to bypass the anchor
   *   check (e.g. after the user explicitly clicks "jump to latest").
   */
  const scrollToBottomIfSafe: any = useCallback(
    (behavior = "auto", { force = false }: any = {}) => {
      if (!force) {
        if (unreadMarkerIdRef.current !== null) return;
        if (Date.now() < Number(unreadAnchorLockUntilRef.current || 0)) return;
        if (pendingScrollToUnreadRef.current !== null) return;
      }
      if (userScrolledUpRef.current && !force) return;
      pendingScrollToBottomRef.current = true;
      scrollChatToBottom(behavior);
      requestAnimationFrame(() => {
        scrollChatToBottom(behavior);
      });
      window.setTimeout(() => {
        scrollChatToBottom(behavior);
      }, 80);
    },
    [scrollChatToBottom, unreadMarkerIdRef, unreadAnchorLockUntilRef, pendingScrollToUnreadRef, userScrolledUpRef, pendingScrollToBottomRef],
  );

  useEffect(() => {
    pendingUploadFilesRef.current = pendingUploadFiles;
  }, [pendingUploadFiles]);

  useEffect(() => {
    pendingVoiceMessageRef.current = pendingVoiceMessage;
  }, [pendingVoiceMessage]);

  useEffect(() => {
    usernameRef.current = String(user?.username || "");
  }, [user?.username]);

  useEffect(() => {
    const nextBlobUrls: any = new Set<any>();
    const appendIfBlob = (value) => {
      const url: any = String(value || "");
      if (url.startsWith("blob:")) {
        nextBlobUrls.add(url);
      }
    };
    messages.forEach((msg) => {
      const pendingFiles = Array.isArray(msg?._files) ? msg._files : [];
      pendingFiles.forEach((file) => {
        appendIfBlob(file?._localUrl);
        appendIfBlob(file?.url);
      });
      const messageFiles = Array.isArray(msg?.files) ? msg.files : [];
      messageFiles.forEach((file) => {
        appendIfBlob(file?._localUrl);
        appendIfBlob(file?.url);
      });
    });

    messageBlobUrlsRef.current.forEach((url) => {
      if (nextBlobUrls.has(url)) return;
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore invalid/revoked object URLs
      }
    });
    messageBlobUrlsRef.current = nextBlobUrls;
  }, [messages]);

  useEffect(() => {
    return () => {
      pendingUploadFilesRef.current.forEach((file) => {
        if (file.previewUrl) {
          URL.revokeObjectURL(file.previewUrl);
        }
      });
      if (pendingVoiceMessageRef.current?.previewUrl) {
        URL.revokeObjectURL(pendingVoiceMessageRef.current.previewUrl);
      }
      if (pendingGroupAvatarFile?.previewUrl) {
        URL.revokeObjectURL(pendingGroupAvatarFile.previewUrl);
      }
      messageBlobUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore invalid/revoked object URLs
        }
      });
      messageBlobUrlsRef.current.clear();
      clearUnreadAlignTimers();
    };
  }, [pendingGroupAvatarFile]);

  useEffect(() => {
    if (!user) return;
    setPendingAvatarFile(null);
    setProfileForm({
      nickname: user.nickname || "",
      username: user.username || "",
      avatarUrl: user.avatarUrl || "",
    });
    setAvatarPreview(user.avatarUrl || "");
    setStatusSelection(user.status || "online");
  }, [user]);

  useEffect(() => {
    if (!user?.username) return;
    if (!canUseIdb()) return;
    let isActive = true;
    void (async () => {
      const idbCached: any = await readChatListCacheAsync(user.username);
      if (!isActive || !idbCached) return;
      if (!Array.isArray(idbCached.chats) || idbCached.chats.length === 0)
        return;
      const normalizedCached: any = idbCached.chats.map((chat) => ({
        ...chat,
        last_message: normalizeMessageBody(chat.last_message),
      }));
      setChats((prev) => (prev.length ? prev : normalizedCached));
      setLoadingChats(false);

      const pendingOpenChatIdRaw =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem(OPEN_CHAT_ID_KEY)
          : null;
      const pendingOpenChatId = normalizeUuid(pendingOpenChatIdRaw) || pendingOpenChatIdRaw;
      if (pendingOpenChatId && !activeChatIdRef.current) {
        const pendingChat: any = normalizedCached.find(
          (item) => item.id === pendingOpenChatId,
        );
        if (pendingChat) {
          setActiveChatId(pendingOpenChatId);
          if (pendingChat.type === "dm") {
            const nextOther: any = (pendingChat.members || []).find(
              (member) =>
                String(member?.username || "").toLowerCase() !==
                String(user?.username || "").toLowerCase(),
            );
            setActivePeer(nextOther || null);
          } else {
            setActivePeer(null);
          }
          setMobileTab("chat");
        }
      }
    })();
    return () => {
      isActive = false;
    };
  }, [user?.username]);

  useEffect(() => {
    if (!user?.username) return;
    void migrateLocalCacheToIdb(user.username);
  }, [user?.username]);

  useEffect(() => {
    if (!user?.username) return;
    pruneMessagesCacheMemory(messagesCacheRef.current, activeChatIdRef.current);
  }, [user?.username]);

  useEffect(() => {
    pruneMessagesCacheMemory(messagesCacheRef.current, activeChatId);
  }, [activeChatId, chats.length]);

  useEffect(() => {
    if (!user?.username) return;
    const pruneIndex = (items) => {
      if (!items.length) return;
      const now: any = Date.now();
      const filtered: any = items.filter((entry) => {
        const chatId: any = String(entry?.chatId || "");
        const updatedAt: any = Number(entry?.updatedAt);
        if (!chatId || !Number.isFinite(updatedAt)) return false;
        if (now - updatedAt > CHAT_PAGE_CONFIG.cacheTtlMs) {
          void deleteIdbCache(CACHE_STORES.messages, buildMessagesCacheKey(user.username, chatId));
          return false;
        }
        return true;
      });
      const trimmed: any = pruneMessagesIndex(user.username, filtered);
      if (trimmed.length !== items.length) {
        writeMessagesIndex(user.username, trimmed);
      }
    };
    if (!canUseIdb()) return;
    let isActive = true;
    void (async () => {
      const idbIndex: any = await readMessagesIndexAsync(user.username);
      if (!isActive || !idbIndex.length) return;
      pruneIndex(idbIndex);
    })();
    return () => {
      isActive = false;
    };
  }, [user?.username]);

  useEffect(() => {
    if (user) {
      void loadChats({ showUpdating: true });
    }
  }, [user]);

  useEffect(() => {
    return () => {
      messagesCacheRef.current.clear();
      if (mediaLoadSnapTimerRef.current) {
        window.clearTimeout(mediaLoadSnapTimerRef.current);
      }
      if (messageRefreshTimerRef.current) {
        window.clearTimeout(messageRefreshTimerRef.current);
      }
      if (channelSeenTimerRef.current) {
        window.clearTimeout(channelSeenTimerRef.current);
      }
      if (loadChatsAbortRef.current) {
        loadChatsAbortRef.current.abort();
        loadChatsAbortRef.current = null;
      }
      loadChatsInFlightRef.current = false;
      queuedLoadChatsOptionsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const totalUnreadCount: any = chats.reduce(
      (sum, chat) =>
        sum + (chat?._muted ? 0 : Number(chat?.unread_count || 0)),
      0,
    );
    const totalUnread = totalUnreadCount > 0 ? formatCompactCount(totalUnreadCount) : 0;

    document.title =
      totalUnreadCount > 0
        ? t(
            totalUnreadCount === 1
              ? "chat.documentTitle.unreadOne"
              : "chat.documentTitle.unreadOther",
            { count: totalUnread },
          )
        : "NextDesk";
    if (navigator?.setAppBadge) {
      if (totalUnreadCount > 0) {
        navigator.setAppBadge(totalUnreadCount).catch(() => null);
      } else if (navigator.clearAppBadge) {
        navigator.clearAppBadge().catch(() => null);
      }
    }
  }, [chats]);

  const getNetworkBackoffMultiplier = () => {
    if (typeof navigator === "undefined") return 1;
    const connection =
      navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return 1;
    let factor = 1;
    if (connection.saveData) {
      factor = Math.max(factor, 2.2);
    }
    const effectiveType: any = String(connection.effectiveType || "").toLowerCase();
    if (effectiveType === "slow-2g" || effectiveType === "2g") {
      factor = Math.max(factor, 2.5);
    } else if (effectiveType === "3g") {
      factor = Math.max(factor, 1.6);
    }
    return factor;
  };

  useEffect(() => {
    if (!user || sseConnected || !isAppActive) return;
    const backoff: any = getNetworkBackoffMultiplier();
    const intervalMs: any = Math.max(
      3000,
      Math.round(CHAT_PAGE_CONFIG.chatsRefreshIntervalMs * backoff),
    );
    const interval: any = setInterval(() => {
      void loadChats({ silent: true });
    }, intervalMs);
    return () => clearInterval(interval);
  }, [user, sseConnected, isAppActive]);

  useEffect(() => {
    if (user && activeChatId) {
      const openedChatId = activeChatId;
      const openedChat: any = chats.find((chat) => chat.id === openedChatId);
      let cached = readMessagesCacheMemory(messagesCacheRef.current, openedChatId) || null;
      // IDB async load below will hydrate if needed.
      const hasCachedMessages = Array.isArray(cached?.messages) && cached.messages.length > 0;
      openingHadUnreadRef.current = Boolean((openedChat?.unread_count || 0) > 0);
      openingUnreadCountRef.current = Number(openedChat?.unread_count || 0);
      isAtBottomRef.current = true;
      setIsAtBottom(true);
      setLoadingMessages(!hasCachedMessages);
      setMessages(hasCachedMessages ? normalizeMessagesForRender(cached.messages) : []);
      setHasOlderMessages(Boolean(cached?.hasOlderMessages));
      setLoadingOlderMessages(false);
      lastMessageIdRef.current = cached?.lastMessageId || null;
      setUnreadInChat(0);
      userScrolledUpRef.current = false;
      setUserScrolledUp(false);
      setUnreadMarkerId(null);
      unreadMarkerIdRef.current = null;
      pendingScrollToUnreadRef.current = null;
      allowStartReachedRef.current = false;
      unreadAnchorLockUntilRef.current = 0;
      shouldAutoMarkReadRef.current = true;
      openingChatRef.current = true;
      pendingScrollToBottomRef.current = false;
      suppressScrolledUpRef.current = true;
      const unreadCount: any = Number(openedChat?.unread_count || 0);
      // MOBILE FIX: Always respect messageFetchLimit, even on mobile.
      // Loading 10,000 messages causes severe performance issues on mobile devices.
      // Messages will be paginated as user scrolls - no need to load everything at once.
      const initialLimit: any = Math.min(
        CHAT_PAGE_CONFIG.messageFetchLimit,
        Math.max(
          CHAT_PAGE_CONFIG.messageFetchLimit,
          unreadCount > 0 ? Math.min(unreadCount + 120, CHAT_PAGE_CONFIG.messageFetchLimit) : 0,
        ),
      );
      const canMarkReadNow = !isMobileViewport || mobileTab === "chat";
      const isAppActiveNow =
        typeof document !== "undefined" &&
        document.visibilityState === "visible" &&
        document.hasFocus();
      if (user?.username && canUseIdb()) {
        const activeId = openedChatId;
        void (async () => {
          const idbCached: any = await readMessagesCacheAsync(user.username, activeId);
          if (!idbCached || !Array.isArray(idbCached.messages)) return;
          if (activeChatIdRef.current !== activeId) return;
          writeMessagesCacheMemory(
            messagesCacheRef.current,
            activeId,
            idbCached,
            activeChatIdRef.current,
          );
          setMessages((prev) =>
            prev.length ? prev : normalizeMessagesForRender(idbCached.messages),
          );
          setHasOlderMessages(Boolean(idbCached?.hasOlderMessages));
          lastMessageIdRef.current =
            Number(idbCached?.lastMessageId || 0) || lastMessageIdRef.current;
          setLoadingMessages(false);
        })();
      }
        void (async () => {
          // If we have cached messages, always show them immediately
          const shouldFetchSilently = hasCachedMessages && sseConnected;
          const shouldFetchInitial =
            !shouldFetchSilently &&
            (openingUnreadCountRef.current > 0 || !cached || !sseConnected || !hasCachedMessages);
          if (shouldFetchInitial) {
            await loadMessages(openedChatId, { initialLoad: true, limit: initialLimit });
          } else {
            const hasOpeningUnread = openingUnreadCountRef.current > 0;
            if (!hasOpeningUnread) {
              pendingScrollToBottomRef.current = true;
              scrollChatToBottom("auto");
            }
            // Refresh to reconcile cached messages and resolve unread anchor.
            void loadMessages(openedChatId, {
              initialLoad: true,
              silent: true,
              preserveHistory: true,
              limit: initialLimit,
            });
          }
        if (
          canMarkReadNow &&
          isAppActiveNow &&
          isAtBottomRef.current &&
          !userScrolledUpRef.current &&
          unreadMarkerIdRef.current === null &&
          openingUnreadCountRef.current === 0
        ) {
          await markMessagesRead({ chatId: openedChatId, username: user.username }).catch(
            () => null,
          );
        }
        if (!sseConnected) {
          await loadChats({ silent: true });
        }
      })();
    }
  }, [user, activeChatId, isMobileViewport, mobileTab]);

  useEffect(() => {
    if (!activeChatId) {
      setUnreadInChat(0);
    }
  }, [activeChatId]);

  useEffect(() => {
    clearPendingUploads();
    clearPendingVoiceMessage();
    if (activeUploadProgressHideTimerRef.current) {
      window.clearTimeout(activeUploadProgressHideTimerRef.current);
      activeUploadProgressHideTimerRef.current = null;
    }
    setActiveUploadProgress(null);
    setReplyTarget(null);
  }, [activeChatId]);

  useEffect(() => {
    return () => {
      if (activeUploadProgressHideTimerRef.current) {
        window.clearTimeout(activeUploadProgressHideTimerRef.current);
        activeUploadProgressHideTimerRef.current = null;
      }
      const current = typingStateRef.current;
      if (current.isTyping && current.chatId) {
        sendTypingSignal(current.chatId, false);
      }
      clearLocalTypingStopTimer();
      typingExpiryTimersRef.current.forEach((timer) => {
        window.clearTimeout(timer);
      });
      typingExpiryTimersRef.current.clear();
    };
  }, [clearLocalTypingStopTimer, sendTypingSignal]);

  useEffect(() => {
    const status: any = String(user?.status || "").toLowerCase();
    if (status !== "online") {
      stopTypingIndicator(activeChatIdRef.current);
    }
  }, [stopTypingIndicator, user?.status]);

  useEffect(() => {
    const currentState = typingStateRef.current;
    const currentChatId = activeChatId || null;
    if (!currentState.isTyping) return;
    if (!currentState.chatId || currentState.chatId === currentChatId) return;
    sendTypingSignal(currentState.chatId, false);
    clearLocalTypingStopTimer();
    typingStateRef.current = {
      chatId: currentState.chatId,
      isTyping: false,
      lastSentAt: Date.now(),
    };
  }, [activeChatId, clearLocalTypingStopTimer, sendTypingSignal]);

  useEffect(() => {
    const prev = prevUploadProgressRef.current;
    const now = activeUploadProgress;
    // When upload bar closes, force a final snap to bottom.
    if (activeChatId && prev !== null && now === null) {
      scrollToBottomIfSafe("auto");
    }
    prevUploadProgressRef.current = now;
  }, [activeUploadProgress, activeChatId]);

  const {
    activeId,
    visibleChats,
    activeChat,
    activeMembers,
    isActiveGroupChat,
    isActiveChannelChat,
    isActiveSavedChat,
    canSendInActiveChat,
    activeGroupMemberUsernames,
    activeGroupMemberUsernamesKey,
    activeHeaderPeer,
    activeFallbackTitle,
    activeHeaderAvatar,
    activeGroupAvatarColor,
    activeGroupAvatarUrl,
    headerAvatarColor,
  } = useActiveChatState({
    chats,
    chatsSearchQuery,
    user,
    activeChatId,
    activeChatIdRef,
    activeChatTypeRef,
    activePeer,
  });
  const activeHeaderAvatarIcon = isActiveSavedChat ? (
    <Bookmark size={18} className="text-white" />
  ) : null;

  const handleStartVoiceCall: any = useCallback(() => {
    if (callState !== "idle") return;
    if (!activeChatId || !activeHeaderPeer?.username || activeHeaderPeer?.isDeleted) return;
    if (!isCallSupported()) return;
    startCall({
      chatId: activeChatId,
      calleeUsername: activeHeaderPeer.username,
      calleeNickname: activeHeaderPeer.nickname,
      calleeAvatar: activeHeaderPeer.avatar_url,
      calleeColor: activeHeaderPeer.color,
      calleeVerified: Boolean(activeHeaderPeer.user_verified ?? activeHeaderPeer.verified),
      calleeRole: activeHeaderPeer.user_role || activeHeaderPeer.role,
      type: "voice",
    });
  }, [activeChatId, activeHeaderPeer, callState, startCall]);

  const handleStartVideoCall: any = useCallback(() => {
    if (callState !== "idle") return;
    if (!activeChatId || !activeHeaderPeer?.username || activeHeaderPeer?.isDeleted) return;
    if (!isCallSupported()) return;
    startCall({
      chatId: activeChatId,
      calleeUsername: activeHeaderPeer.username,
      calleeNickname: activeHeaderPeer.nickname,
      calleeAvatar: activeHeaderPeer.avatar_url,
      calleeColor: activeHeaderPeer.color,
      calleeVerified: Boolean(activeHeaderPeer.user_verified ?? activeHeaderPeer.verified),
      calleeRole: activeHeaderPeer.user_role || activeHeaderPeer.role,
      type: "video",
    });
  }, [activeChatId, activeHeaderPeer, callState, startCall]);

  useEffect(() => {
    if (canSendInActiveChat) return;
    stopTypingIndicator(activeChatIdRef.current);
  }, [canSendInActiveChat, stopTypingIndicator]);

  useEffect(() => {
    if (!userScrolledUp) return;
    setUnreadInChat((prev) => {
      if (prev > 0) return prev;
      return Number(activeChat?.unread_count || 0);
    });
  }, [userScrolledUp, activeChat?.unread_count]);

  const {
    loadMessages,
    loadingMessages,
    setLoadingMessages,
    hasOlderMessages,
    setHasOlderMessages,
  } = useMessagesLoader({
    user,
    chats,
    activeChat,
    activeChatIdRef,
    activeChatTypeRef,
    isActiveChannelChat,
    isMobileViewport,
    mobileTab,
    setMessages,
    setUnreadInChat,
    setUnreadMarkerId,
    setUserScrolledUp,
    setIsAtBottom,
    setChannelSeenCounts,
    lastMessageIdRef,
    openingChatRef,
    openingUnreadCountRef,
    openingHadUnreadRef,
    pendingScrollToUnreadRef,
    unreadMarkerIdRef,
    pendingScrollToBottomRef,
    userScrolledUpRef,
    isAtBottomRef,
    unreadAnchorLockUntilRef,
    shouldAutoMarkReadRef,
    allowStartReachedRef,
    formatDayLabel,
    formatTime,
    parseServerDate,
    resolveReplyPreview,
    normalizeMessageBody,
    CHAT_PAGE_CONFIG,
    listMessagesByQuery,
    markMessagesRead,
    fetchFirstUnreadMessage,
  });
  usePerfTelemetry({
    activeChatId,
    messagesLength: messages.length,
    loadingMessages,
  });

  // Keep messagesRef in sync so callbacks can read current messages without
  // stale closures and without adding messages to their dependency arrays.
  messagesRef.current = messages;

  const getVisibleChannelMessageIds: any = useCallback(() => {
    if (!chatScrollRef.current) return [];
    const containerRect: any = chatScrollRef.current.getBoundingClientRect();
    const ids: any = [];
    messages.forEach((msg) => {
      const messageId = normalizeUuid(msg?._serverId || msg?.id) || null;
      if (!messageId) return;
      const element: any = document.getElementById(`message-${messageId}`);
      if (!element) return;
      const rect: any = element.getBoundingClientRect();
      if (rect.bottom >= containerRect.top && rect.top <= containerRect.bottom) {
        ids.push(messageId);
      }
    });
    return ids;
  }, [messages]);

  const processChannelSeenQueue: any = useCallback(() => {
    if (!isActiveChannelChat) return;
    if (channelSeenActiveRef.current) return;
    const nextId: any = channelSeenQueueRef.current.shift();
    if (!nextId) return;
    const activeId = activeChatIdRef.current || null;
    if (!activeId) return;
    channelSeenActiveRef.current = true;
    getMessageReadCounts({
      chatId: activeId,
      username: String(usernameRef.current || ""),
      messageIds: [nextId],
    })
      .then(async (res) => {
        const data: any = await res.json();
        if (!res.ok) return;
        const count: any = Number(data?.counts?.[nextId] || 0);
        setChannelSeenCounts((prev) => ({
          ...prev,
          [nextId]: count,
        }));
      })
      .catch(() => null)
      .finally(() => {
        channelSeenLoadedRef.current.add(nextId);
        channelSeenActiveRef.current = false;
        if (channelSeenTimerRef.current) {
          window.clearTimeout(channelSeenTimerRef.current);
        }
        channelSeenTimerRef.current = window.setTimeout(() => {
          processChannelSeenQueue();
        }, 140);
      });
  }, [isActiveChannelChat]);

  const enqueueChannelSeenCounts: any = useCallback((forceLatest = false) => {
    if (!isActiveChannelChat || loadingMessages) return;
    const visible: any = Array.from(new Set(getVisibleChannelMessageIds())).sort(
      (a: any, b: any) => Number(b) - Number(a),
    );
    if (!visible.length) return;
    const latestId = visible[0];
    const now: any = Date.now();
    if (latestId) {
      const shouldForce =
        forceLatest || now - Number(channelSeenLatestRefreshRef.current || 0) > 2500;
      if (shouldForce && !channelSeenQueueRef.current.includes(latestId)) {
        channelSeenQueueRef.current.push(latestId);
        channelSeenLatestRefreshRef.current = now;
      }
    }
    visible.slice(1).forEach((id) => {
      if (channelSeenLoadedRef.current.has(id)) return;
      if (channelSeenQueueRef.current.includes(id)) return;
      channelSeenQueueRef.current.push(id);
    });
    processChannelSeenQueue();
  }, [getVisibleChannelMessageIds, isActiveChannelChat, loadingMessages, processChannelSeenQueue]);

  useEffect(() => {
    if (!isActiveChannelChat) {
      channelSeenQueueRef.current = [];
      channelSeenLoadedRef.current = new Set<any>();
      setChannelSeenCounts({});
      return;
    }
    channelSeenQueueRef.current = [];
    channelSeenLoadedRef.current = new Set<any>();
    if (canUseIdb()) {
      let isActive = true;
      void (async () => {
        const counts: any = await readChannelSeenCacheAsync(
          user?.username,
          activeChatId,
        );
        if (isActive) {
          setChannelSeenCounts(counts);
        }
      })();
      requestAnimationFrame(() => {
        enqueueChannelSeenCounts();
      });
      return () => {
        isActive = false;
      };
    }
    requestAnimationFrame(() => {
      enqueueChannelSeenCounts();
    });
  }, [isActiveChannelChat, activeChatId, enqueueChannelSeenCounts]);

  useEffect(() => {
    if (!isActiveChannelChat || loadingMessages) return;
    requestAnimationFrame(() => {
      enqueueChannelSeenCounts();
    });
  }, [messages, loadingMessages, isActiveChannelChat, enqueueChannelSeenCounts]);

  useEffect(() => {
    if (!isActiveChannelChat) return;
    const interval: any = setInterval(() => {
      enqueueChannelSeenCounts(true);
    }, 4500);
    return () => clearInterval(interval);
  }, [isActiveChannelChat, enqueueChannelSeenCounts]);

  useEffect(() => {
    if (!isActiveChannelChat || !activeChatId) return;
    if (!canUseIdb()) return;
    void writeChannelSeenCacheAsync(
      user?.username,
      activeChatId,
      channelSeenCounts,
    );
  }, [channelSeenCounts, isActiveChannelChat, activeChatId, user?.username]);

  const handleChatScrollWithSeen: any = useCallback(
    (event) => {
      handleChatScroll(event);
      enqueueChannelSeenCounts();
    },
    [handleChatScroll, enqueueChannelSeenCounts],
  );
  const canStartChat: any = Boolean(newChatSelection);
  const userColor = user?.color || "#10b981";
  const handleExitEdit = () => {
    setEditMode(false);
    setSelectedChats([]);
  };
  const handleEnterEdit = () => {
    if (!visibleChats.length) return;
    setEditMode(true);
  };
  const handleDeleteChats = () => requestDeleteChats(selectedChats);
  const handleOpenWhatsNew = () => openWhatsNew();

  const displayName = user.nickname || user.username;
  const displayInitials: any = getAvatarInitials(displayName);
  const statusValue = user.status || "online";
  const statusTextClass =
    statusValue === "online"
      ? "font-semibold text-emerald-500 dark:text-emerald-300"
      : "";

  const parsePresenceDate = (value) => {
    if (!value) return null;
    const d: any = parseServerDate(value);
    return d && !isNaN(d.getTime()) ? d : null;
  };
  const normalizeStatus = (status) =>
    String(status || "").toLowerCase() === "online" ? "online" : "offline";
  const formatLastSeenLabel = (lastSeenInput) => {
    const parsed: any = parsePresenceDate(lastSeenInput);
    const seenAt = parsed?.getTime?.() || 0;
    if (!Number.isFinite(seenAt) || seenAt <= 0) return t("chat.presence.lastSeen.recently");
    const elapsedMs: any = Math.max(0, Date.now() - seenAt);
    const minuteMs = 60 * 1000;
    const hourMs = 60 * minuteMs;
    const dayMs = 24 * hourMs;
    const weekMs = 7 * dayMs;
    if (elapsedMs < 10 * minuteMs) return t("chat.presence.lastSeen.recently");
    if (elapsedMs < 90 * minuteMs) return t("chat.presence.lastSeen.anHourAgo");
    if (elapsedMs < dayMs) {
      const hours: any = Math.max(2, Math.round(elapsedMs / hourMs));
      return t("chat.presence.lastSeen.hoursAgo", { hours: hours.toLocaleString("en-US") });
    }
    if (elapsedMs < 2 * dayMs) return t("chat.presence.lastSeen.yesterday");
    if (elapsedMs < 7 * dayMs) {
      const weekday: any = parsed
        .toLocaleDateString(lang === "fa" ? "fa-IR" : "en-US", { weekday: "long" })
        .toLowerCase();
      return t("chat.presence.lastSeen.weekday", { weekday });
    }
    if (elapsedMs < 2 * weekMs) return t("chat.presence.lastSeen.aWeekAgo");
    if (elapsedMs < 4 * weekMs) return t("chat.presence.lastSeen.twoWeeksAgo");
    if (elapsedMs < 8 * weekMs) return t("chat.presence.lastSeen.aMonthAgo");
    return t("chat.presence.lastSeen.aLongTimeAgo");
  };
  const applyPresenceUpdate = (payload: any = {}) => {
    const targetUsername: any = String(payload?.username || "").toLowerCase();
    if (!targetUsername) return;
    const status: any = String(payload?.status || "").toLowerCase();
    const rawStatus: any = String(payload?.rawStatus || status).toLowerCase();
    const rawLastSeen: any = String(payload?.lastSeen || "").trim();
    const parsedLastSeen: any = parsePresenceDate(rawLastSeen);
    const normalizedLastSeen = parsedLastSeen && !isNaN(parsedLastSeen.getTime())
      ? parsedLastSeen.toISOString()
      : new Date().toISOString();
    const onlineStatus: any = normalizeStatus(status);
    presenceStateRef.current.set(targetUsername, {
      status: onlineStatus,
      rawStatus,
      lastSeen: normalizedLastSeen,
    });
    // Evict oldest entries when the map exceeds a reasonable size to prevent
    // unbounded growth in large communities across long sessions.
    if (presenceStateRef.current.size > 500) {
      presenceStateRef.current.delete(presenceStateRef.current.keys().next().value);
    }
    setChats((prev) =>
      prev.map((chat) => {
        const members = Array.isArray(chat?.members) ? chat.members : [];
        const hasMember: any = members.some(
          (member) => String(member?.username || "").toLowerCase() === targetUsername,
        );
        const isDmMatch =
          chat?.type === "dm" &&
          (hasMember ||
            String(chat?.last_sender_username || "").toLowerCase() === targetUsername ||
            members.length === 0);

        if (!hasMember && !isDmMatch) {
          return chat;
        }

        const updatedMembers = hasMember
          ? members.map((member) => {
              if (String(member?.username || "").toLowerCase() !== targetUsername) {
                return member;
              }
              return {
                ...member,
                status: onlineStatus,
              };
            })
          : [
              ...members,
              {
                username: targetUsername,
                status: onlineStatus,
              },
            ];

        return {
          ...chat,
          members: updatedMembers,
        };
      }),
    );
    if (String(activeHeaderPeer?.username || "").toLowerCase() === targetUsername) {
      setPeerPresence({
        status: onlineStatus,
        rawStatus,
        lastSeen: normalizedLastSeen,
      });
    }
  };
  const applyProfileUpdate: any = useCallback((payload: any = {}) => {
    const rawUserId = payload?.userId;
    // Req 6.6: if userId is a legacy integer, discard
    const userId = isValidUuid(rawUserId) ? normalizeUuid(rawUserId) : null;
    const nextUsername: any = String(payload?.username || "")
      .trim()
      .toLowerCase();
    const previousUsername: any = String(payload?.previousUsername || "")
      .trim()
      .toLowerCase();
    if (!userId && !nextUsername && !previousUsername) return;

    const nextNickname =
      String(payload?.nickname || "").trim() || nextUsername || previousUsername || "";
    const nextAvatarUrl: any = String(payload?.avatarUrl || "").trim();
    const nextColor = String(payload?.color || "#10b981").trim() || "#10b981";
    const nextStatus = String(payload?.status || "online").trim().toLowerCase() || "online";
    const usernames: any = new Set([nextUsername, previousUsername].filter(Boolean));
    const matchesUser = (candidateId, candidateUsername) => {
      const normalizedCandidateId = isValidUuid(candidateId) ? normalizeUuid(candidateId) : null;
      const normalizedCandidateUsername: any = String(candidateUsername || "")
        .trim()
        .toLowerCase();
      return (
        (userId && normalizedCandidateId === userId) ||
        (normalizedCandidateUsername && usernames.has(normalizedCandidateUsername))
      );
    };

    presenceStateRef.current.delete(previousUsername);
    const previousPresence = nextUsername
      ? presenceStateRef.current.get(nextUsername) || presenceStateRef.current.get(previousUsername)
      : null;
    const effectivePresenceStatus =
      previousPresence?.status ||
      (nextStatus === "online" || nextStatus === "offline" ? nextStatus : "offline");

    if (nextUsername) {
      presenceStateRef.current.set(nextUsername, {
        status: effectivePresenceStatus,
        lastSeen:
          previousPresence?.lastSeen ||
          new Date().toISOString(),
      });
    }

    setChats((prev) =>
      prev.map((chat) => {
        let changed = false;
        const members = Array.isArray(chat?.members) ? chat.members : [];
        const nextMembers: any = members.map((member) => {
          if (!matchesUser(member?.id, member?.username)) {
            return member;
          }
          changed = true;
          return {
            ...member,
            username: nextUsername || member?.username || "",
            nickname: nextNickname || member?.nickname || member?.username || "",
            avatar_url: nextAvatarUrl,
            color: nextColor,
            status: member?.status || effectivePresenceStatus,
          };
        });
        const shouldPatchLastSender: any =
          matchesUser(chat?.last_sender_id, chat?.last_sender_username);
        if (!changed && !shouldPatchLastSender) {
          return chat;
        }
        return {
          ...chat,
          members: nextMembers,
          last_sender_username: shouldPatchLastSender
            ? nextUsername || chat?.last_sender_username || ""
            : chat?.last_sender_username,
          last_sender_nickname: shouldPatchLastSender
            ? nextNickname || chat?.last_sender_nickname || chat?.last_sender_username || ""
            : chat?.last_sender_nickname,
          last_sender_avatar_url: shouldPatchLastSender
            ? nextAvatarUrl
            : chat?.last_sender_avatar_url,
        };
      }),
    );

    setMessages((prev) =>
      prev.map((msg) => {
        const senderMatch: any = matchesUser(msg?.user_id, msg?.username);
        const replyMatch: any = matchesUser(msg?.replyTo?.user_id, msg?.replyTo?.username);
        const forwardedMatch: any = matchesUser(
          msg?.forwarded_from_user_id,
          msg?.forwarded_from_username,
        );
        if (!senderMatch && !replyMatch && !forwardedMatch) {
          return msg;
        }
        return {
          ...msg,
          ...(senderMatch
            ? {
                username: nextUsername || msg?.username || "",
                nickname: nextNickname || msg?.nickname || msg?.username || "",
                avatar_url: nextAvatarUrl,
                color: nextColor,
              }
            : {}),
          ...(replyMatch
            ? {
                replyTo: {
                  ...msg.replyTo,
                  username: nextUsername || msg?.replyTo?.username || "",
                  nickname:
                    nextNickname ||
                    msg?.replyTo?.nickname ||
                    msg?.replyTo?.username ||
                    "",
                  avatar_url: nextAvatarUrl,
                  color: nextColor,
                },
              }
            : {}),
          ...(forwardedMatch
            ? {
                forwarded_from_username:
                  nextUsername || msg?.forwarded_from_username || "",
                forwarded_from_label:
                  nextNickname || msg?.forwarded_from_label || nextUsername || "",
                forwarded_from_avatar_url: nextAvatarUrl,
                forwarded_from_color: nextColor,
              }
            : {}),
        };
      }),
    );

    setProfileModalMember((prev) => {
      if (!prev || !matchesUser(prev?.id, prev?.username)) return prev;
      return {
        ...prev,
        username: nextUsername || prev?.username || "",
        nickname: nextNickname || prev?.nickname || prev?.username || "",
        avatar_url: nextAvatarUrl,
        color: nextColor,
        status: nextStatus,
      };
    });

    setMentionProfile((prev) => {
      if (!prev || prev.kind !== "user" || !matchesUser(prev?.id, prev?.username)) {
        return prev;
      }
      return {
        ...prev,
        username: nextUsername || prev?.username || "",
        nickname: nextNickname || prev?.nickname || prev?.username || "",
        avatarUrl: nextAvatarUrl,
        color: nextColor,
      };
    });

    setActivePeer((prev) => {
      if (!prev || !matchesUser(prev?.id, prev?.username)) return prev;
      return {
        ...prev,
        username: nextUsername || prev?.username || "",
        nickname: nextNickname || prev?.nickname || prev?.username || "",
        avatar_url: nextAvatarUrl,
        color: nextColor,
        status: nextStatus,
      };
    });

    setUser((prev) => {
      if (!prev || !matchesUser(prev?.id, prev?.username)) return prev;
      return {
        ...prev,
        username: nextUsername || prev?.username || "",
        nickname: nextNickname || prev?.nickname || prev?.username || "",
        avatarUrl: nextAvatarUrl,
        color: nextColor,
        status: nextStatus,
      };
    });

    if (matchesUser(null, activeHeaderPeer?.username)) {
      const existingPresence: any = presenceStateRef.current.get(nextUsername || previousUsername);
      setPeerPresence((prev) => ({
        status: normalizeStatus(nextStatus),
        rawStatus: nextStatus || prev?.rawStatus || prev?.status || "online",
        lastSeen: existingPresence?.lastSeen || prev?.lastSeen || null,
      }));
    }
  }, [activeHeaderPeer?.username, setUser]);
  const peerStatusLabel = !activeHeaderPeer || activeHeaderPeer?.isDeleted
    ? t("chat.presence.lastSeen.recently")
    : String(peerPresence.rawStatus || peerPresence.status || "").toLowerCase() === "invisible"
      ? t("chat.presence.lastSeen.recently")
      : peerPresence.status === "online"
        ? t("common.states.online")
        : formatLastSeenLabel(peerPresence.lastSeen);
  const activeTypingUsers: any = useMemo(() => {
    const chatId: any = String(activeChatId || "");
    if (!chatId) return [];
    const typingMap = typingByChat?.[chatId];
    if (!typingMap || typeof typingMap !== "object") return [];
    const selfUsername: any = String(user?.username || "").toLowerCase();
    const membersByUsername: any = new Map(
      (Array.isArray(activeMembers) ? activeMembers : []).map((member) => [
        String(member?.username || "").toLowerCase(),
        member,
      ]),
    );
    return Object.values(typingMap)
      .map((entry: any) => ({
        username: String(entry?.username || "").toLowerCase(),
        nickname: String(entry?.nickname || "").trim(),
      }))
      .filter((entry) => entry.username && entry.username !== selfUsername)
      .filter((entry) => {
        if (isActiveGroupChat || isActiveChannelChat) return true;
        const peerUsername: any = String(activeHeaderPeer?.username || "").toLowerCase();
        return peerUsername && entry.username === peerUsername;
      })
      .map((entry) => {
        const member: any = membersByUsername.get(entry.username);
        const displayName =
          String(member?.nickname || "").trim() ||
          String(entry.nickname || "").trim() ||
          String(member?.username || "").trim() ||
          entry.username;
        return {
          username: entry.username,
          displayName,
        };
      });
  }, [
    activeChatId,
    activeHeaderPeer?.username,
    activeMembers,
    isActiveChannelChat,
    isActiveGroupChat,
    typingByChat,
    user?.username,
  ]);
  const buildTypingDisplayName: any = useCallback((value, maxChars = 22) => {
    const text: any = String(value || "").trim();
    if (!text) return "";
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
  }, []);
  const typingIndicator: any = useMemo(() => {
    if (!activeTypingUsers.length) return null;
    if (isActiveChannelChat) return null;
    if (isActiveGroupChat) {
      if (activeTypingUsers.length === 1) {
        const name: any = buildTypingDisplayName(activeTypingUsers[0].displayName, 28);
        return {
          type: "group_single",
          name,
          label: t("chat.typing.one", { name }),
          fullLabel: activeTypingUsers[0].displayName,
        };
      }
      if (activeTypingUsers.length === 2) {
        const first: any = buildTypingDisplayName(activeTypingUsers[0].displayName, 16);
        const second: any = buildTypingDisplayName(activeTypingUsers[1].displayName, 16);
        return {
          type: "group_pair",
          firstName: first,
          secondName: second,
          label: t("chat.typing.pair", { first, second }),
          fullLabel: t("chat.typing.pairFull", {
            first: activeTypingUsers[0].displayName,
            second: activeTypingUsers[1].displayName,
          }),
        };
      }
      const first: any = buildTypingDisplayName(activeTypingUsers[0].displayName, 18);
      const othersCount = activeTypingUsers.length - 1;
      const othersCountLabel: any = othersCount.toLocaleString("en-US");
      return {
        type: "group_multi",
        label: t("chat.typing.multi", { first, count: othersCountLabel }),
        fullLabel: t("chat.typing.multiFull", {
          first: activeTypingUsers[0].displayName,
          count: othersCountLabel,
        }),
      };
    }
    return {
      type: "dm",
      label: t("chat.typing.dm"),
    };
  }, [activeTypingUsers, buildTypingDisplayName, isActiveChannelChat, isActiveGroupChat, t]);
  const activeMembersLabel: any = Number(activeMembers.length || 0)
    .toLocaleString("en-US");
  const activeHeaderSubtitle = isActiveGroupChat || isActiveChannelChat
    ? t(
        activeMembers.length === 1
          ? "chat.header.membersOne"
          : "chat.header.membersOther",
        { count: activeMembersLabel },
      )
    : isActiveSavedChat
      ? ""
      : peerStatusLabel;
  const resolvedHeaderSubtitle =
    !isActiveSavedChat && typingIndicator?.label
      ? typingIndicator.label
      : activeHeaderSubtitle;
  const activeChatMuted: any = Boolean(activeChat?._muted);
  const forwardedChatIds: any = useMemo(
    () =>
      Array.from(
        new Set(
          messages
            .map((msg) => String(msg?.forwarded_from_chat_id || "").trim())
            .filter(Boolean),
        ),
      ),
    [messages],
  );
  const forwardedUserRefs: any = useMemo(
    () =>
      Array.from(
        new Map(
          messages
            .map((msg) => {
              const userId = String(msg?.forwarded_from_user_id || "").trim() || null;
              const username: any = String(msg?.forwarded_from_username || "")
                .trim()
                .toLowerCase();
              if (!userId && !username) return null;
              return [
                userId ? `id:${userId}` : `username:${username}`,
                { userId, username },
              ];
            })
            .filter(Boolean),
        ).values(),
      ),
    [messages],
  );
  const forwardedChatsById: any = useMemo(() => {
    const next: any = {};
    chats.forEach((chat) => {
      const chatId: any = String(chat?.id || "").trim();
      const chatType: any = String(chat?.type || "").toLowerCase();
      if (!chatId || (chatType !== "group" && chatType !== "channel")) return;
      next[chatId] = chat;
    });
    Object.entries(forwardedChatPreviewById).forEach(([rawId, entry]: any) => {
      const chatId: any = String(rawId || "").trim();
      if (!chatId || next[chatId] || !entry || entry.status !== "ready" || !entry.chat) {
        return;
      }
      next[chatId] = entry.chat;
    });
    return next;
  }, [chats, forwardedChatPreviewById]);
  const forwardedChatStatusById: any = useMemo(() => {
    const next: any = {};
    chats.forEach((chat) => {
      const chatId: any = String(chat?.id || "").trim();
      const chatType: any = String(chat?.type || "").toLowerCase();
      if (!chatId || (chatType !== "group" && chatType !== "channel")) return;
      next[chatId] = "ready";
    });
    Object.entries(forwardedChatPreviewById).forEach(([rawId, entry]: any) => {
      const chatId: any = String(rawId || "").trim();
      if (!chatId || !entry?.status) return;
      next[chatId] = entry.status;
    });
    return next;
  }, [chats, forwardedChatPreviewById]);
  const forwardedUsersById: any = useMemo(() => {
    const next: any = {};
    if (user?.id) {
      next[user.id] = {
        id: user.id,
        username: user.username || "",
        nickname: user.nickname || user.username || "",
        avatar_url: user.avatarUrl || "",
        color: user.color || "#10b981",
        status: user.status || "online",
      };
    }
    chats.forEach((chat) => {
      (Array.isArray(chat?.members) ? chat.members : []).forEach((member) => {
        const memberId = member?.id;
        if (!memberId) return;
        next[memberId] = {
          id: memberId,
          username: member?.username || "",
          nickname: member?.nickname || member?.username || "",
          avatar_url: member?.avatar_url || "",
          color: member?.color || "#10b981",
          status: member?.status || "online",
        };
      });
    });
    Object.values(forwardedUserPreviewByKey).forEach((entry: any) => {
      const memberId = entry?.profile?.id;
      if (!memberId || !entry?.profile || entry.status !== "ready") return;
      next[memberId] = entry.profile;
    });
    return next;
  }, [chats, forwardedUserPreviewByKey, user]);
  const forwardedUserStatusByKey: any = useMemo(() => {
    const next: any = {};
    Object.entries(forwardedUserPreviewByKey).forEach(([username, entry]: any) => {
      if (!username || !entry?.status) return;
      next[username] = entry.status;
    });
    return next;
  }, [forwardedUserPreviewByKey]);
  useEffect(() => {
    if (!forwardedChatIds.length) return undefined;
    const timerId: any = window.setInterval(() => {
      setForwardedChatPreviewTick(Date.now());
    }, 2 * 60 * 1000);
    return () => {
      window.clearInterval(timerId);
    };
  }, [forwardedChatIds.length]);
  useEffect(() => {
    forwardedUserRefs.forEach(({ userId, username }: any) => {
      const cacheKey = userId ? `id:${userId}` : `username:${username}`;
      const cached = forwardedUserPreviewByKey[cacheKey];
      if (cached?.status === "ready" || cached?.status === "missing") return;
      if (!username) return;
      if (forwardedUserPreviewInFlightRef.current.has(cacheKey)) return;
      forwardedUserPreviewInFlightRef.current.add(cacheKey);
      void (async () => {
        try {
          const res: any = await getProfileByUsername(username);
          const data: any = await res.json().catch(() => ({}));
          const resolvedUserId = Number(data?.id || 0) || null;
          if (res.ok && (!userId || resolvedUserId === userId)) {
            setForwardedUserPreviewByKey((prev) => ({
              ...prev,
              [cacheKey]: {
                status: "ready",
                profile: {
                  id: resolvedUserId,
                  username: data?.username || username,
                  nickname: data?.nickname || data?.username || username,
                  avatar_url: data?.avatarUrl || "",
                  color: data?.color || "#10b981",
                  status: data?.status || "online",
                  verified: Boolean(data?.verified),
                  role: data?.role || "user",
                },
              },
            }));
            return;
          }
          if (res.status === 404 || (res.ok && userId && resolvedUserId !== userId)) {
            setForwardedUserPreviewByKey((prev) => ({
              ...prev,
              [cacheKey]: { status: "missing" },
            }));
          }
        } catch {
          // ignore live forwarded user lookup errors
        } finally {
          forwardedUserPreviewInFlightRef.current.delete(cacheKey);
        }
      })();
    });
  }, [forwardedUserPreviewByKey, forwardedUserRefs]);
  useEffect(() => {
    const liveIds: any = new Set(Object.keys(forwardedChatsById).map((id) => String(id)));
    const now: any = Date.now();
    forwardedChatIds.forEach((chatId) => {
      if (liveIds.has(chatId)) return;
      const cached = forwardedChatPreviewById[chatId];
      const isFreshReady =
        cached?.status === "ready" &&
        now - Number(cached?.fetchedAt || 0) < 2 * 60 * 1000;
      if (cached?.status === "missing" || isFreshReady) return;
      if (forwardedChatPreviewInFlightRef.current.has(chatId)) return;
      forwardedChatPreviewInFlightRef.current.add(chatId);
      void (async () => {
        try {
          const res: any = await getChatPreview({
            chatId,
            username: user.username,
            allowMissing: true,
          });
          const data: any = await res.json().catch(() => ({}));
          if (data?.missing) {
            setForwardedChatPreviewById((prev) => ({
              ...prev,
              [chatId]: { status: "missing" },
            }));
            return;
          }
          if (res.ok) {
            const nextChat: any = {
              id: data?.id || chatId,
              type: data?.type || "group",
              name: data?.name || t("chat.chat.fallbackName"),
              group_username: data?.username || "",
              group_visibility: data?.visibility || "public",
              group_color: data?.color || "#10b981",
              group_avatar_url: data?.avatarUrl || "",
              invite_token: data?.inviteToken || "",
              membersCount: Number(data?.membersCount || 0),
              members: [],
              _previewOnly: true,
              _isMember: Boolean(data?.isMember),
            };
            setForwardedChatPreviewById((prev) => ({
              ...prev,
              [chatId]: { status: "ready", chat: nextChat, fetchedAt: Date.now() },
            }));
            return;
          }
          if (res.status === 404) {
            setForwardedChatPreviewById((prev) => ({
              ...prev,
              [chatId]: { status: "missing" },
            }));
          }
        } catch {
          // ignore live forwarded chat preview errors
        } finally {
          forwardedChatPreviewInFlightRef.current.delete(chatId);
        }
      })();
    });
  }, [
    forwardedChatIds,
    forwardedChatPreviewById,
    forwardedChatPreviewTick,
    forwardedChatsById,
    user.username,
  ]);
  const mentionProfileUser =
    mentionProfile?.kind === "user"
      ? {
          username: mentionProfile.username,
          nickname: mentionProfile.nickname || mentionProfile.username,
          avatar_url: mentionProfile.avatarUrl || "",
          color: mentionProfile.color || "#10b981",
          status: "online",
          role: mentionProfile.role || "user",
          verified: Boolean(mentionProfile.verified),
        }
      : null;
  const liveMentionProfileChat = mentionProfile
    ? chats.find((chat) => {
        const mentionChatId: any = String(mentionProfile.chatId || "");
        const chatId: any = String(chat?.id || "");
        if (mentionChatId && chatId === mentionChatId) return true;
        const mentionUsername: any = String(mentionProfile.username || "")
          .trim()
          .toLowerCase();
        const chatUsername: any = String(chat?.group_username || "")
          .trim()
          .toLowerCase();
        return Boolean(mentionUsername && chatUsername && mentionUsername === chatUsername);
      }) || null
    : null;
  const mentionProfileChat =
    mentionProfile && mentionProfile.kind !== "user"
      ? {
          ...(liveMentionProfileChat || {}),
          type:
            liveMentionProfileChat?.type ||
            mentionProfile.kind,
          id:
            liveMentionProfileChat?.id || mentionProfile.chatId || null,
          name:
            liveMentionProfileChat?.name ||
            mentionProfile.name ||
            mentionProfile.username ||
            t("chat.chat.fallbackName"),
          group_username:
            liveMentionProfileChat?.group_username ||
            mentionProfile.username ||
            "",
          group_visibility:
            liveMentionProfileChat?.group_visibility ||
            mentionProfile.visibility ||
            "public",
          group_color:
            liveMentionProfileChat?.group_color ||
            mentionProfile.color ||
            "#10b981",
          group_avatar_url:
            liveMentionProfileChat?.group_avatar_url ??
            mentionProfile.avatarUrl ??
            null,
          inviteToken:
            liveMentionProfileChat?.inviteToken ||
            liveMentionProfileChat?.invite_token ||
            mentionProfile.inviteToken ||
            "",
          members: Array.isArray(liveMentionProfileChat?.members)
            ? liveMentionProfileChat.members
            : [],
          membersCount:
            Array.isArray(liveMentionProfileChat?.members) &&
            liveMentionProfileChat.members.length
              ? liveMentionProfileChat.members.length
              : Number(
                  liveMentionProfileChat?.membersCount ||
                    mentionProfile.membersCount ||
                    0,
                ),
          isMember: Boolean(
            liveMentionProfileChat ||
              mentionProfile.isMember,
          ),
        }
      : null;
  const mentionProfileActionState =
    mentionProfile && mentionProfile.kind !== "user"
      ? mentionProfile._actionState ||
        (mentionProfileChat?.isMember
          ? "member"
          : String(mentionProfileChat?.group_visibility || "public").toLowerCase() ===
                "public"
            ? "join"
            : "none")
      : "none";
  const profileTargetUser = mentionProfileUser || profileModalMember || activeHeaderPeer || null;
  const canJoinMentionChat: any = Boolean(
    mentionProfileChat && mentionProfileActionState === "join",
  );
  const isMentionProfileReadOnly: any = Boolean(
    mentionProfile &&
      mentionProfile.kind !== "user" &&
      mentionProfileActionState === "none",
  );
  const shouldShowMembersList = !mentionProfile;
  const canCurrentUserEditGroup: any = Boolean(
    (isActiveGroupChat || isActiveChannelChat) &&
      activeMembers.some(
        (member) =>
          String(member.id || "") === String(user?.id || "") &&
          String(member.role || "").toLowerCase() === "owner",
      ),
  );
  const canSwipeReply = !isActiveChannelChat || canCurrentUserEditGroup;
  const canCurrentUserViewInvite: any = Boolean(
    !mentionProfile &&
    (isActiveGroupChat || isActiveChannelChat) &&
      (canCurrentUserEditGroup || Boolean(Number(activeChat?.allow_member_invites || 0))),
  );

  const handleProfileStartVoiceCall: any = useCallback((peer) => {
    if (callState !== "idle") return;
    const target = peer || profileTargetUser || activeHeaderPeer;
    if (!target?.username || target?.isDeleted) return;
    if (!isCallSupported()) return;
    const dmChat =
      (activeChat?.type === "dm" ? activeChat : null) ||
      chats.find(
        (c) =>
          c.type === "dm" &&
          (c.members || []).some(
            (m) =>
              String(m.username).toLowerCase() ===
              String(target.username).toLowerCase(),
          ),
      );
    const targetChatId = dmChat?.id || activeChatId;
    if (!targetChatId) return;
    startCall({
      chatId: targetChatId,
      calleeUsername: target.username,
      calleeNickname: target.nickname,
      calleeAvatar: target.avatar_url,
      calleeColor: target.color,
      calleeVerified: Boolean(target.user_verified ?? target.verified),
      calleeRole: target.user_role || target.role,
      type: "voice",
    });
  }, [activeChat, activeChatId, activeHeaderPeer, callState, chats, profileTargetUser, startCall]);

  const handleProfileStartVideoCall: any = useCallback((peer) => {
    if (callState !== "idle") return;
    const target = peer || profileTargetUser || activeHeaderPeer;
    if (!target?.username || target?.isDeleted) return;
    if (!isCallSupported()) return;
    const dmChat =
      (activeChat?.type === "dm" ? activeChat : null) ||
      chats.find(
        (c) =>
          c.type === "dm" &&
          (c.members || []).some(
            (m) =>
              String(m.username).toLowerCase() ===
              String(target.username).toLowerCase(),
          ),
      );
    const targetChatId = dmChat?.id || activeChatId;
    if (!targetChatId) return;
    startCall({
      chatId: targetChatId,
      calleeUsername: target.username,
      calleeNickname: target.nickname,
      calleeAvatar: target.avatar_url,
      calleeColor: target.color,
      calleeVerified: Boolean(target.user_verified ?? target.verified),
      calleeRole: target.user_role || target.role,
      type: "video",
    });
  }, [activeChat, activeChatId, activeHeaderPeer, callState, chats, profileTargetUser, startCall]);

  const loadCalls: any = useCallback(async () => {
    if (!user?.username) return;
    setLoadingCalls(true);
    try {
      const rows: any = await listCalls();
      setCalls(Array.isArray(rows) ? rows : []);
    } catch {
      // keep previously loaded calls on failure
    } finally {
      setLoadingCalls(false);
    }
  }, [user?.username]);

  useEffect(() => {
    if (mobileTab !== "calls") {
      setCallsEditMode(false);
      setSelectedCalls([]);
      return;
    }
    // Refresh on entering the tab and again when an ongoing/rejected call
    // settles back to idle while the tab stays open.
    if (callState !== "idle") return;
    void loadCalls();
  }, [mobileTab, callState, loadCalls]);

  const handleStartCallFromRow: any = useCallback((call) => {
    if (callState !== "idle") return;
    const peer = call?.peer;
    if (!call?.chatId || !peer?.username) return;
    if (!isCallSupported()) return;
    startCall({
      chatId: call.chatId,
      calleeUsername: peer.username,
      calleeNickname: peer.nickname,
      calleeAvatar: peer.avatarUrl,
      calleeColor: peer.color,
      calleeVerified: Boolean(peer.verified),
      calleeRole: peer.role,
      type: "voice",
    });
  }, [callState, startCall]);

  const handleNewCallSubmit: any = useCallback((chatId, peer) => {
    if (callState !== "idle") return;
    if (!chatId || !peer?.username || !isCallSupported()) return;
    setNewCallOpen(false);
    startCall({
      chatId,
      calleeUsername: peer.username,
      calleeNickname: peer.nickname,
      calleeAvatar: peer.avatar_url,
      calleeColor: peer.color,
      calleeVerified: Boolean(peer.user_verified ?? peer.verified),
      calleeRole: peer.user_role || peer.role,
      type: "voice",
    });
  }, [callState, startCall]);

  const handleOpenNewCall: any = useCallback(() => {
    if (callState !== "idle") return;
    setNewCallOpen(true);
  }, [callState]);

  const toggleSelectCall = (callId) => {
    setSelectedCalls((prev) =>
      prev.includes(callId)
        ? prev.filter((id) => id !== callId)
        : [...prev, callId],
    );
  };

  const requestDeleteCall = (call) => {
    const messageId = call?.messageId || call?.id;
    if (!messageId) return;
    setPendingDeleteCallIds([messageId]);
    setConfirmDeleteCallOpen(true);
  };

  const handleDeleteCalls = () => {
    if (!selectedCalls.length) return;
    setPendingDeleteCallIds(selectedCalls);
    setConfirmDeleteCallOpen(true);
  };

  const confirmDeleteCall = async () => {
    const ids = pendingDeleteCallIds;
    setConfirmDeleteCallOpen(false);
    setPendingDeleteCallIds([]);
    if (!ids.length) return;
    try {
      const results: any = await Promise.allSettled(
        ids.map((messageId) =>
          deleteCall({ username: user?.username, messageId }),
        ),
      );
      const deleted: any = new Set<any>();
      results.forEach((res, i) => {
        if (res.status === "fulfilled" && res.value?.ok) {
          deleted.add(String(ids[i]));
        }
      });
      if (!deleted.size) return;
      setCalls((prev) =>
        prev.filter((row) => !deleted.has(String(row.id))),
      );
    } catch {
      // row stays until refetch; benign
    }
    setSelectedCalls([]);
    setCallsEditMode(false);
    void loadCalls();
  };

  const handleMarkChatSeen: any = useCallback(
    async (chat) => {
      const chatId: any = String(chat?.id || "");
      if (!chatId) return;
      setChats((prev) =>
        prev.map((item) =>
          String(item.id) === chatId ? { ...item, unread_count: 0 } : item,
        ),
      );
      if (String(activeChatId || "") === chatId) {
        setUnreadInChat(0);
      }
      try {
        await markMessagesRead({ chatId, username: user.username });
      } catch {
        // Keep the UI quiet for now; this menu is intentionally lightweight.
      }
    },
    [activeChatId, user.username],
  );

  const toggleSelectChat = (chatId) => {
    setSelectedChats((prev) =>
      prev.includes(chatId)
        ? prev.filter((id) => id !== chatId)
        : [...prev, chatId],
    );
  };

  const requestDeleteChats = (ids) => {
    if (!ids.length) return;
    setPendingDeleteIds(ids);
    setConfirmDeleteOpen(true);
  };

  const isModeratorUser = ["owner", "admin", "operator"].includes(
    String(user?.role || "").toLowerCase(),
  );

  const canDeleteMessageForEveryone: any = useCallback(
    (message) => {
      if (!isModeratorUser) return false;
      if (String(activeChat?.type || "").toLowerCase() === "saved") return false;
      if (isActiveChannelChat && !canCurrentUserEditGroup) return false;
      const messageAuthor: any = String(message?.username || "").toLowerCase();
      if (!messageAuthor) return false;
      return true;
    },
    [activeChat?.type, canCurrentUserEditGroup, isActiveChannelChat, isModeratorUser],
  );

  const canEditMessageFromContext: any = useCallback(
    (message) =>
      isModeratorUser &&
      (!isActiveChannelChat || canCurrentUserEditGroup) &&
      isMessageAuthoredByUser(message, { username: user?.username }),
    [canCurrentUserEditGroup, isActiveChannelChat, isModeratorUser, user?.username],
  );

  const canDeleteChatFromContext: any = useCallback(
    (chat) => {
      if (isModeratorUser) return true;
      return String(chat?.type || "").toLowerCase() !== "dm";
    },
    [isModeratorUser],
  );

  function handleDeleteMessageRequest(message, _options: any = {}) {
    if (!message) return;
    setPendingDeleteMessage(message);
    setMessageDeleteScopeOpen(true);
  }

  async function handleForwardMessageSubmit(targetChatIds: any = []) {
    const sourceMessageId = normalizeUuid(
      forwardMessageTarget?._serverId || forwardMessageTarget?.id,
    ) || null;
    if (!sourceMessageId || !user?.username || !activeChatId) return;

    const originalAuthorLabel: any = String(
      forwardMessageTarget?.nickname ||
        forwardMessageTarget?.username ||
        user?.nickname ||
        user?.username ||
        t("chat.chat.yourself"),
    ).trim();
    const originalForwardLabel = isActiveChannelChat
      ? String(activeChat?.name || activeFallbackTitle || t("chat.chat.channel")).trim()
      : originalAuthorLabel;

    const body: any = String(forwardMessageTarget?.body || "");

    // Capture state before clearing it
    const capturedTarget = forwardMessageTarget;

    // Close the modal immediately for instant feedback
    setForwardMessageTarget(null);
    setForwardSavedChat(null);

    try {
      const res: any = await forwardMessage({
        username: user.username,
        sourceMessageId,
        targetChatIds,
        body,
        forwardedFromChatId: isActiveChannelChat ? activeChatId : null,
        forwardedFromLabel: originalForwardLabel,
        forwardedFromUserId: isActiveChannelChat
          ? null
          : normalizeUuid(capturedTarget?.user_id) || normalizeUuid(user?.id) || null,
        forwardedFromUsername: isActiveChannelChat
          ? ""
          : String(
              capturedTarget?.username || user?.username || "",
            ).trim(),
        forwardedFromAvatarUrl: isActiveChannelChat
          ? ""
          : String(
              capturedTarget?.avatar_url || user?.avatarUrl || "",
            ).trim(),
        forwardedFromColor: isActiveChannelChat
          ? ""
          : String(
              capturedTarget?.color || user?.color || "#10b981",
            ).trim(),
      });
      const data: any = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || t("chat.errors.forwardFailed"));
      }
      await loadChats({ silent: true });
    } catch (error) {
      setUploadError(String(error?.message || t("chat.errors.forwardFailed")));
    }
  }

  const requestLeaveGroupById = (chatId) => {
    const id: any = String(chatId || "");
    if (!id) return;
    setPendingLeaveChatId(id);
    setConfirmLeaveOpen(true);
  };

  const confirmLeaveGroupById = async () => {
    const id: any = String(pendingLeaveChatId || "");
    if (!id) return;
    setConfirmLeaveOpen(false);
    setPendingLeaveChatId(null);
    await handleLeaveGroupById(id);
  };

  const confirmDeleteChats = async () => {
    const idsToHide = pendingDeleteIds.length
      ? pendingDeleteIds
      : selectedChats;
    if (!idsToHide.length) return;
    try {
      const groupsToLeave: any = chats.filter(
        (chat) =>
          idsToHide.includes(chat.id) &&
          (chat.type === "group" || chat.type === "channel"),
      );
      await Promise.all(
        groupsToLeave.map(async (groupChat) => {
          try {
            await leaveGroupChat(groupChat.id, { username: user.username });
          } catch {
            // ignore leave failures and still proceed with hide
          }
        }),
      );
      await hideChats({ username: user.username, chatIds: idsToHide });
    } catch {
      // ignore
    }
    if (idsToHide.includes(activeId)) {
      // close with animation on mobile, then clear active
      setMobileTab("chats");
      setTimeout(() => {
        setActiveChatId(null);
        setActivePeer(null);
      }, MOBILE_CLOSE_ANIMATION_MS);
    }
    setSelectedChats([]);
    setPendingDeleteIds([]);
    setEditMode(false);
    setConfirmDeleteOpen(false);
    await loadChats();
  };

  // Messages are updated via SSE events and explicit send/read actions.
  // Avoid periodic full message fetches to reduce unnecessary reflows/fetches.

  // Helper to close conversation after mobile slide animation completes
  const closeChat = () => {
    // Clear any pending deferred-open key so the chat doesn't reopen
    // when the user navigates away (e.g. to the admin panel) and comes back.
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(OPEN_CHAT_ID_KEY);
    }
    setMobileTab("chats");
    setTimeout(() => {
      setActiveChatId(null);
      setActivePeer(null);
    }, MOBILE_CLOSE_ANIMATION_MS);
  };

  // System back closes the open chat instead of exiting the app.
  useOverlayBack(Boolean(activeChatId), closeChat, "sbChatOpen");

  // Deselect active chat on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && activeChatId) {
        closeChat();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeChatId]);

  useEffect(() => {
    if (!activeHeaderPeer?.username) return;
    let isMounted = true;
    setPeerPresence({ status: "offline", rawStatus: "offline", lastSeen: null });
    const fetchPeerPresence = async () => {
      try {
        const res: any = await fetchPresence(activeHeaderPeer.username);
        const data: any = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || "Unable to fetch presence.");
        }
        if (isMounted) {
          const normalizedUsername: any = String(data?.username || activeHeaderPeer.username || "")
            .toLowerCase();
          const normalizedLastSeen = String(data?.lastSeen || "").trim() || new Date().toISOString();
          const rawStatus: any = String(data?.rawStatus || data?.status || "online").toLowerCase();
          presenceStateRef.current.set(normalizedUsername, {
            status: normalizeStatus(data?.status),
            rawStatus,
            lastSeen: normalizedLastSeen,
          });
          setPeerPresence({
            status: normalizeStatus(data?.status),
            rawStatus,
            lastSeen: normalizedLastSeen,
          });
        }
      } catch {
        if (isMounted) {
          setPeerPresence({ status: "offline", rawStatus: "offline", lastSeen: null });
        }
      }
    };
    void fetchPeerPresence();
    return () => {
      isMounted = false;
    };
  }, [activeHeaderPeer?.username]);

  useEffect(() => {
    if (
      !profileModalOpen ||
      profileModalMember ||
      !["group", "channel"].includes(activeChat?.type)
    ) {
      return;
    }
    const memberUsernames = activeGroupMemberUsernames;
    if (!memberUsernames.length) return;
    let cancelled = false;

    setChats((prev) =>
      prev.map((chat) => {
        if (String(chat?.id || "") !== String(activeChat?.id || "")) return chat;
        return {
          ...chat,
          members: (chat.members || []).map((member) => {
            const username: any = String(member?.username || "").toLowerCase();
            const snapshot: any = presenceStateRef.current.get(username);
            const nextStatus = snapshot
              ? normalizeStatus(snapshot.status)
              : "offline";
            return { ...member, status: nextStatus };
          }),
        };
      }),
    );

    const bootstrapMembersPresence = async () => {
      await Promise.all(
        memberUsernames.map(async (username) => {
          try {
            const res: any = await fetchPresence(username);
            const data: any = await res.json();
            if (!res.ok || cancelled) return;
            applyPresenceUpdate({
              type: "presence_update",
              username: data?.username || username,
              status: data?.status || "offline",
              lastSeen: data?.lastSeen || null,
            });
          } catch {
            // ignore bootstrap failures for individual users
          }
        }),
      );
    };

    void bootstrapMembersPresence();
    return () => {
      cancelled = true;
    };
  }, [
    profileModalOpen,
    profileModalMember,
    activeChat?.id,
    activeChat?.type,
    activeGroupMemberUsernamesKey,
  ]);

  useEffect(() => {
    if (!activeChatId) return;
    pendingScrollToUnreadRef.current = null;
    clearUnreadAlignTimers();
  }, [activeChatId]);

  useLayoutEffect(() => {
    if (!activeChatId) return;
    const pendingUnread = pendingScrollToUnreadRef.current;
    if (pendingUnread === null || pendingUnread === undefined) return;
    if (loadingMessages || messages.length === 0) return;

    requestAnimationFrame(() => {
      const unreadId: any = Number(pendingUnread);
      const scroller = chatScrollRef.current;
      // Set the lock BEFORE scrolling so handleChatScroll sees it when the
      // programmatic scroll event fires synchronously inside scrollTo().
      pendingScrollToUnreadRef.current = null;
      pendingScrollToBottomRef.current = false;
      isAtBottomRef.current = false;
      setIsAtBottom(false);
      userScrolledUpRef.current = true;
      setUserScrolledUp(true);
      unreadAnchorLockUntilRef.current = Date.now() + 4000;
      shouldAutoMarkReadRef.current = true;
      if (scroller) {
        scheduleUnreadAnchorAlignment(unreadId);
      }
        if (scroller) {
          window.setTimeout(() => {
            // If an unread anchor is active, don't reset scroll state.
            if (unreadMarkerIdRef.current !== null) {
              return;
            }
            if (Date.now() < Number(unreadAnchorLockUntilRef.current || 0)) {
              return;
            }
            const distance =
              scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
            if (distance <= 120) {
              isAtBottomRef.current = true;
              setIsAtBottom(true);
              userScrolledUpRef.current = false;
              setUserScrolledUp(false);
              unreadAnchorLockUntilRef.current = 0;
            }
          }, 90);
      }
    });
  }, [activeChatId, messages, loadingMessages]);

  useLayoutEffect(() => {
    if (!activeChatId) return;
    // Only re-align on initial open (pendingScrollToUnreadRef is set by the
    // loader). Do NOT re-fire when unreadMarkerId changes mid-session — that
    // would scroll the user back to the chip every time a new message arrives.
    if (!pendingScrollToUnreadRef.current) return;
    if (!unreadMarkerIdRef.current) return;
    if (loadingMessages || messages.length === 0) return;
    const unreadId: any = String(unreadMarkerIdRef.current || "").trim();
    if (!unreadId) return;
    requestAnimationFrame(() => {
      // Set lock BEFORE scrolling so handleChatScroll sees it immediately.
      pendingScrollToBottomRef.current = false;
      isAtBottomRef.current = false;
      setIsAtBottom(false);
      userScrolledUpRef.current = true;
      setUserScrolledUp(true);
      unreadAnchorLockUntilRef.current = Date.now() + 5000;
      scheduleUnreadAnchorAlignment(unreadId);
    });
  }, [activeChatId, unreadMarkerId, messages.length, loadingMessages]);

  useLayoutEffect(() => {
    if (!activeChatId) return;
    if (!pendingScrollToBottomRef.current) return;
    if (pendingScrollToUnreadRef.current !== null) {
      pendingScrollToBottomRef.current = false;
      return;
    }
    if (unreadMarkerIdRef.current !== null) {
      if (isAtBottomRef.current && !userScrolledUpRef.current) {
        setUnreadMarkerId(null);
        unreadMarkerIdRef.current = null;
        unreadAnchorLockUntilRef.current = 0;
        clearUnreadAlignTimers();
      } else {
        pendingScrollToBottomRef.current = false;
        return;
      }
    }
    if (Date.now() < Number(unreadAnchorLockUntilRef.current || 0)) {
      pendingScrollToBottomRef.current = false;
      return;
    }
    if (loadingMessages && messages.length === 0) return;
    requestAnimationFrame(() => {
      scrollChatToBottom("auto");
      requestAnimationFrame(() => {
        scrollChatToBottom("auto");
      });
      window.setTimeout(() => {
        scrollChatToBottom("auto");
      }, 120);
      pendingScrollToBottomRef.current = false;
    });
  }, [activeChatId, messages, loadingMessages]);

  useEffect(() => {
    if (!activeChatId) return;
    const chatId = activeChatId;
    return () => {
      if (!chatId || !user || !canMarkReadInCurrentView) return;
      shouldAutoMarkReadRef.current = true;
      setUnreadMarkerId(null);
      unreadMarkerIdRef.current = null;
      pendingScrollToUnreadRef.current = null;
    };
  }, [activeChatId, user, canMarkReadInCurrentView]);

  useEffect(() => {
    if (!isAppActive) return;
    const activeId = activeChatIdRef.current;
    if (
      !activeId ||
      !user?.username ||
      isMarkingReadRef.current ||
      !canMarkReadInCurrentView ||
      !isAtBottomRef.current ||
      userScrolledUpRef.current
    ) {
      return;
    }
    const hasUnreadFromOthers: any = messagesRef.current.some(
      (msg) =>
        isMessageFromOtherUser(msg, { username: user?.username }) &&
        !msg._readByMe,
    );
    if (!hasUnreadFromOthers) return;

    setChats((prev) =>
      prev.map((chat) =>
        chat?.id && activeId && String(chat.id).toLowerCase() === String(activeId).toLowerCase()
          ? { ...chat, unread_count: 0 }
          : chat,
      ),
    );

    isMarkingReadRef.current = true;
    markMessagesRead({ chatId: activeId, username: user.username })
      .catch(() => null)
      .finally(() => {
        isMarkingReadRef.current = false;
      });
  }, [isAppActive, user?.username, canMarkReadInCurrentView]);

  useResumeRefresh({
    isAppActive,
    user,
    loadChatsRef,
    scheduleMessageRefreshRef,
    activeChatIdRef,
  });

  // Per-message visibility tracking: mark each unread message as seen as it
  // scrolls into view and decrement the sidebar badge.
  // The chip (unreadMarkerId) is intentionally NOT moved — it stays fixed at
  // the original first-unread position for the duration of this chat session.
  // It only repositions on the next open of the chat.
  const handleMessageSeen: any = useCallback(
    (messageId) => {
      const id = normalizeUuid(messageId) || null;
      if (!id || !activeChatIdRef.current || !user?.username) return;
      if (!canMarkReadInCurrentView) return;

      // Mark the message as read in local state immediately
      setMessages((prev) =>
        prev.map((msg) => {
          const serverId = normalizeUuid(msg?._serverId || msg?.id) || null;
          if (!serverId || serverId !== id) return msg;
          if (msg._readByMe) return msg;
          return { ...msg, _readByMe: true };
        }),
      );

      // Decrement the sidebar unread badge by 1 (floor at 0)
      setChats((prev) =>
        prev.map((chat) => {
          if (!chat?.id || chat.id !== activeChatIdRef.current) return chat;
          const next: any = Math.max(0, Number(chat?.unread_count || 0) - 1);
          return { ...chat, unread_count: next };
        }),
      );

      // Keep the jump-to-bottom button badge in sync with the sidebar badge.
      setUnreadInChat((prev) => Math.max(0, prev - 1));

      // Fire the API call (best-effort)
      markMessageRead({
        chatId: activeChatIdRef.current,
        username: user.username,
        messageId: id,
      }).catch(() => null);
    },
    [
      activeChatIdRef,
      canMarkReadInCurrentView,
      markMessageRead,
      setChats,
      setMessages,
      setUnreadInChat,
      user,
    ],
  );

  const { registerMessageRef } = useMessageVisibility({
    activeChatId,
    user,
    canMarkReadInCurrentView,
    isAppActive,
    chatScrollRef,
    onMessageSeen: handleMessageSeen,
  });

  const pruneDeletedMessagesFromCache: any = useCallback(
    (chatId, messageIds: any = []) => {
      const normalizedChatId = normalizeUuid(chatId) || null;
      const deletedIds: any = Array.from(
        new Set(
          (Array.isArray(messageIds) ? messageIds : [])
            .map((id) => normalizeUuid(id))
            .filter(Boolean),
        ),
      );
      if (!normalizedChatId || !deletedIds.length) return;
      const deletedSet: any = new Set(deletedIds);

      const pruneCachePayload = (cached) => {
        if (!cached || !Array.isArray(cached.messages)) {
          return { changed: false, value: cached };
        }
        const nextMessages: any = cached.messages.filter((msg) => {
          const serverId = normalizeUuid(msg?._serverId || msg?.id) || null;
          return !serverId || !deletedSet.has(serverId);
        });
        if (nextMessages.length === cached.messages.length) {
          return { changed: false, value: cached };
        }
        return {
          changed: true,
          value: {
            ...cached,
            messages: nextMessages,
            lastMessageId: nextMessages.length
              ? (normalizeUuid(nextMessages[nextMessages.length - 1]?.id) || null)
              : null,
            updatedAt: Date.now(),
          },
        };
      };

      const memoryCached: any = readMessagesCacheMemory(
        messagesCacheRef.current,
        normalizedChatId,
      );
      const nextMemory: any = pruneCachePayload(memoryCached);
      if (nextMemory.changed) {
        writeMessagesCacheMemory(
          messagesCacheRef.current,
          normalizedChatId,
          nextMemory.value,
          activeChatIdRef.current,
        );
      }

      if (!user?.username || !canUseIdb()) return;
      const key: any = buildMessagesCacheKey(user.username, normalizedChatId);
      void (async () => {
        const idbCached: any = await readMessagesCacheAsync(user.username, normalizedChatId);
        const nextIdb: any = pruneCachePayload(idbCached);
        if (!nextIdb.changed) return;
        await writeIdbCache(CACHE_STORES.messages, key, nextIdb.value);
        await updateMessagesIndex(
          user.username,
          normalizedChatId,
          Number(nextIdb.value?.updatedAt || Date.now()),
        );
      })();
    },
    [user?.username],
  );

  async function performDeleteMessage(message, scope = "self") {
    const messageId = normalizeUuid(message?.id || message?._serverId) || null;
    if (!activeChatId || !messageId || !user?.username) return;
    setMessageDeleteScopeOpen(false);
    setPendingDeleteMessage(null);

    // Snapshot current messages so we can roll back on failure
    let snapshotMessages;
    setMessages((prev) => {
      snapshotMessages = prev;
      return prev
        .filter((msg) => (normalizeUuid(msg?._serverId || msg?.id) || null) !== messageId)
        .map((msg) => {
          const replyId = normalizeUuid(msg?.replyTo?.id) || null;
          if (!replyId || replyId !== messageId) return msg;
          return { ...msg, replyTo: null };
        });
    });
    if (activeChatId) {
      pruneDeletedMessagesFromCache(activeChatId, [messageId]);
    }

    try {
      const res: any = await deleteMessage({
        chatId: activeChatId,
        username: user.username,
        messageId,
        scope,
      });
      const data: any = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || t("chat.errors.deleteFailed"));
      }
      await loadChats({ silent: true });
    } catch (error) {
      // Restore the optimistically removed message on failure
      if (snapshotMessages) {
        setMessages(snapshotMessages);
      }
      setUploadError(String(error?.message || t("chat.errors.deleteFailed")));
    }
  }

  useChatEvents({
    username: user?.username,
    getSseStreamUrl,
    sseReconnectDelayMs: CHAT_PAGE_CONFIG.sseReconnectDelayMs,
    setSseConnected,
    loadChatsRef,
    scheduleMessageRefreshRef,
    activeChatIdRef,
    usernameRef,
    userScrolledUpRef,
    isAtBottomRef,
    pendingScrollToBottomRef,
    unreadMarkerIdRef,
    unreadAnchorLockUntilRef,
    pendingScrollToUnreadRef,
    setUnreadInChat,
    setMessages,
    setChats,
    sseReconnectRef,
    canMarkReadInCurrentView,
    markMessageRead,
    markMessagesRead,
    isMarkingReadRef,
    onIncomingMessage: (payload, meta: any = {}) => {
      const payloadChatId: any = String(payload?.chatId || "");
      const sender: any = String(payload?.username || "").trim().toLowerCase();
      if (payloadChatId && sender) {
        clearTypingExpiryTimer(payloadChatId, sender);
        removeTypingUser(payloadChatId, sender);
      }
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (!notificationsActive) return;
      const rawBody: any = normalizeMessageBody(meta?.body ?? payload?.body).trim();
      if (/^\[\[(?:system|call):/i.test(rawBody)) return;
      const senderName: any = String(payload?.username || "").trim();
      const isOwnEvent =
        senderName.toLowerCase() === String(user?.username || "").toLowerCase() &&
        !isRemoteChannelMessage(payload);
      if (isOwnEvent) return;
      const pageFocused =
        document.visibilityState === "visible" && document.hasFocus();
      if (pageFocused) return;
      const chat: any = chats.find((conv) => String(conv.id) === payloadChatId);
      if (chat?._muted) return;
      let title: any = t("chat.notification.newMessageTitle");
      if (chat) {
        if (chat.type === "dm") {
          const other: any = (chat.members || []).find(
            (member) =>
              String(member?.username || "").toLowerCase() !==
              String(user?.username || "").toLowerCase(),
          );
          title = other?.nickname || other?.username || t("chat.chat.deletedAccount");
        } else if (chat.type === "group") {
          const groupName = chat.name || t("chat.chat.group");
          const senderLabel = senderName
            ? (() => {
                const senderMember: any = (chat.members || []).find(
                  (member) =>
                    String(member?.username || "").toLowerCase() ===
                    String(senderName || "").toLowerCase(),
                );
                return (
                  senderMember?.nickname ||
                  senderMember?.username ||
                  String(payload?.nickname || "").trim() ||
                  senderName
                );
              })()
            : "";
          title = senderLabel
            ? t("chat.notification.groupTitle", { name: groupName, sender: senderLabel })
            : groupName;
        } else {
          title = chat.name || t("chat.chat.fallbackName");
        }
      } else if (senderName) {
        title = senderName;
      }
      const messageBody: any = normalizeMessageBody(meta?.body ?? payload?.body).trim();
      const summaryText: any = String(payload?.summaryText || "").trim();
      const derivedSummary = chat ? summarizeFiles(chat.last_message_files) : "";
      const isGenericBody =
        !messageBody || /^Sent (a media file|a document|\d+ files)$/i.test(messageBody);
      const baseBody =
        summaryText && isGenericBody
          ? summaryText
          : derivedSummary && isGenericBody
            ? derivedSummary
            : messageBody;
      const body = messagePreviewEnabled
        ? baseBody
          ? truncateText(baseBody, NOTIFICATION_PREVIEW_MAX_CHARS)
          : senderName
            ? t("chat.notification.newMessageFrom", { name: senderName })
            : t("chat.notification.newMessageTitle")
        : t("chat.notification.newMessageBody");
      try {
        const notification: any = new Notification(title, {
          body,
          tag: payloadChatId ? `chat-${payloadChatId}` : undefined,
          renotify: true,
        });
        notification.onclick = () => {
          window.focus();
        };
      } catch {
        // ignore notification errors
      }
    },
    onMessageDeleted: (payload) => {
      const payloadChatId: any = String(payload?.chatId || "");
      const messageIds = Array.isArray(payload?.messageIds)
        ? payload.messageIds
        : [];
      pruneDeletedMessagesFromCache(payloadChatId, messageIds);
    },
    onChatRead: (payload) => {
      const payloadChatId: any = String(payload?.chatId || "");
      const currentActiveId: any = String(activeChatIdRef.current || "");
      if (!payloadChatId || payloadChatId !== currentActiveId) return;
      if (!isActiveChannelChat) return;
      const visible: any = getVisibleChannelMessageIds();
      if (visible.length) {
        visible.forEach((id) => {
          channelSeenLoadedRef.current.delete(id);
        });
      }
      enqueueChannelSeenCounts(true);
    },
    onPresenceUpdate: (payload) => {
      applyPresenceUpdate(payload);
    },
    onProfileUpdated: (payload) => {
      applyProfileUpdate(payload);
    },
    onTypingUpdate: (payload) => {
      const payloadChatId: any = String(payload?.chatId || "");
      const sender: any = String(payload?.username || "").toLowerCase();
      if (!payloadChatId || !sender) return;
      if (sender === String(user?.username || "").toLowerCase()) return;
      const chat: any = chats.find((item) => String(item?.id) === payloadChatId);
      if (String(chat?.type || "").toLowerCase() === "channel") {
        clearTypingExpiryTimer(payloadChatId, sender);
        removeTypingUser(payloadChatId, sender);
        return;
      }
      const isTyping: any = Boolean(payload?.isTyping);
      if (!isTyping) {
        clearTypingExpiryTimer(payloadChatId, sender);
        removeTypingUser(payloadChatId, sender);
        return;
      }
      setTypingUser(payloadChatId, sender, payload?.nickname || payload?.username || sender);
      scheduleTypingExpiry(payloadChatId, sender);
    },
    onChatListChanged: (payload) => {
      const deletedChatId: any = String(payload?.chatId || "");
      if (deletedChatId) {
        setTypingByChat((prev) => {
          if (!prev?.[deletedChatId]) return prev;
          const next: any = { ...prev };
          delete next[deletedChatId];
          return next;
        });
      }
    },
    onSessionRevoked: () => {
      handleLogout();
    },
    onCallSignal: handleCallSignal,
    realtimeSenderRef,
  });

  useEffect(() => {
    loadChatsRef.current = loadChats;
    scheduleMessageRefreshRef.current = scheduleMessageRefresh;
  });

  useEffect(() => {
    if (!profileModalOpen || !mentionProfile || mentionProfile.kind === "user") return;
    const chatId: any = String(mentionProfile.chatId || "");
    if (!chatId) return;
    if (liveMentionProfileChat) {
      setMentionProfile((prev) => {
        if (!prev || prev.kind === "user" || String(prev.chatId || "") !== chatId) {
          return prev;
        }
        const nextKind: any = String(
          liveMentionProfileChat.type || prev.kind || "group",
        ).toLowerCase();
        const nextName =
          liveMentionProfileChat.name || prev.name || prev.username || t("chat.chat.fallbackName");
        const nextUsername = liveMentionProfileChat.group_username || prev.username || "";
        const nextVisibility =
          liveMentionProfileChat.group_visibility || prev.visibility || "public";
        const nextColor = liveMentionProfileChat.group_color || prev.color || "#10b981";
        const nextAvatarUrl =
          liveMentionProfileChat.group_avatar_url ?? prev.avatarUrl ?? null;
        const nextInviteToken =
          liveMentionProfileChat.inviteToken ||
          liveMentionProfileChat.invite_token ||
          prev.inviteToken ||
          "";
        const nextMembersCount = Array.isArray(liveMentionProfileChat.members)
          ? liveMentionProfileChat.members.length
          : Number(
              liveMentionProfileChat.membersCount ||
                prev.membersCount ||
                0,
            );
        if (
          prev.kind === nextKind &&
          prev.name === nextName &&
          prev.username === nextUsername &&
          prev.visibility === nextVisibility &&
          prev.color === nextColor &&
          (prev.avatarUrl ?? null) === nextAvatarUrl &&
          (prev.inviteToken || "") === nextInviteToken &&
          Number(prev.membersCount || 0) === nextMembersCount &&
          prev.isMember === true &&
          prev._actionState === "member"
        ) {
          return prev;
        }
        return {
          ...prev,
          kind: nextKind,
          name: nextName,
          username: nextUsername,
          visibility: nextVisibility,
          color: nextColor,
          avatarUrl: nextAvatarUrl,
          inviteToken: nextInviteToken,
          membersCount: nextMembersCount,
          isMember: true,
          _actionState: "member",
        };
      });
      return;
    }
    let isActive = true;
    void (async () => {
      try {
        const res: any = await getChatPreview({
          chatId,
          username: user.username,
          allowMissing: true,
        });
        const data: any = await res.json().catch(() => ({}));
        if (!isActive) return;
        if (data?.missing) {
          setMentionProfile((prev) => {
            if (!prev || prev.kind === "user" || String(prev.chatId || "") !== chatId) {
              return prev;
            }
            const visibility: any = String(prev.visibility || "private").toLowerCase();
            const nextActionState = visibility === "public" ? "join" : "none";
            return {
              ...prev,
              isMember: false,
              _actionState: nextActionState,
            };
          });
          return;
        }
        if (res.ok) {
          setMentionProfile((prev) => {
            if (!prev || prev.kind === "user" || String(prev.chatId || "") !== chatId) {
              return prev;
            }
            const visibility: any = String(
              data?.visibility || prev.visibility || "public",
            ).toLowerCase();
            const isMember: any = Boolean(data?.isMember);
            const nextKind: any = String(data?.type || prev.kind || "group").toLowerCase();
            const nextName = data?.name || prev.name || prev.username || t("chat.chat.fallbackName");
            const nextUsername = data?.username || prev.username || "";
            const nextColor = data?.color || prev.color || "#10b981";
            const nextAvatarUrl = data?.avatarUrl ?? prev.avatarUrl ?? null;
            const nextInviteToken = data?.inviteToken || prev.inviteToken || "";
            const nextMembersCount: any = Number(data?.membersCount || prev.membersCount || 0);
            const nextActionState = isMember
              ? "member"
              : visibility === "public"
                ? "join"
                : "none";
            if (
              prev.kind === nextKind &&
              prev.name === nextName &&
              prev.username === nextUsername &&
              prev.visibility === visibility &&
              prev.color === nextColor &&
              (prev.avatarUrl ?? null) === nextAvatarUrl &&
              (prev.inviteToken || "") === nextInviteToken &&
              Number(prev.membersCount || 0) === nextMembersCount &&
              prev.isMember === isMember &&
              prev._actionState === nextActionState
            ) {
              return prev;
            }
            return {
              ...prev,
              kind: nextKind,
              name: nextName,
              username: nextUsername,
              visibility,
              color: nextColor,
              avatarUrl: nextAvatarUrl,
              inviteToken: nextInviteToken,
              membersCount: nextMembersCount,
              isMember,
              _actionState: nextActionState,
            };
          });
          return;
        }
        if (res.status === 404) {
          setMentionProfile((prev) => {
            if (!prev || prev.kind === "user" || String(prev.chatId || "") !== chatId) {
              return prev;
            }
            const visibility: any = String(prev.visibility || "private").toLowerCase();
            const nextActionState = visibility === "public" ? "join" : "none";
            if (prev.isMember === false && prev._actionState === nextActionState) {
              return prev;
            }
            return {
              ...prev,
              isMember: false,
              _actionState: nextActionState,
            };
          });
        }
      } catch {
        // ignore live preview refresh errors
      }
    })();
    return () => {
      isActive = false;
    };
  }, [
    chats,
    liveMentionProfileChat,
    mentionProfile?.chatId,
    mentionProfile?.kind,
    mentionProfile?.visibility,
    profileModalOpen,
    user.username,
  ]);

  const uploadPendingMessageWithProgress = (pendingMessage, targetChatId) =>
    new Promise<any>((resolve, reject) => {
      (async () => {
        const form: any = new FormData();
        form.append("username", user.username);
        form.append("chatId", String(targetChatId));
        form.append("body", pendingMessage.body || "");
        form.append("uploadType", pendingMessage._uploadType || "document");
        form.append("clientRequestId", String(pendingMessage._clientId || ""));
        if (pendingMessage.replyTo?.id) {
          form.append("replyToMessageId", String(pendingMessage.replyTo.id));
        }
        if (pendingMessage._editMessageId) {
          form.append("editMessageId", String(pendingMessage._editMessageId));
        }

        const fileItems: any = (pendingMessage._files || []).filter(
          (item) => item?.file instanceof Blob,
        );

        let prepResult: any = { presignedFiles: [], localFiles: [], fileMeta: [] };
        try {
          prepResult = await prepareFilesForMessage(fileItems, {
            onProgress: (_idx, pct) => {
              if (typeof setPendingUploadProgress === "function") {
                setPendingUploadProgress(pendingMessage._clientId, pct, targetChatId);
              }
            },
          });
        } catch (err) {
          console.warn("[uploadPendingMessageWithProgress] prepareFilesForMessage failed:", err);
        }

        const { presignedFiles = [] } = prepResult;
        const usedRemote = presignedFiles.length > 0;

        if (usedRemote) {
          form.append("storageKeys", JSON.stringify(presignedFiles));
        } else {
          const fileMeta: any = [];
          fileItems.forEach((item) => {
            const filename = item.name || item.file.name || "upload.bin";
            form.append("files", item.file, filename);
            fileMeta.push({
              width: Number.isFinite(Number(item.width)) ? Number(item.width) : null,
              height: Number.isFinite(Number(item.height)) ? Number(item.height) : null,
              durationSeconds: Number.isFinite(Number(item.durationSeconds))
                ? Number(item.durationSeconds)
                : null,
            });
          });
          form.append("fileMeta", JSON.stringify(fileMeta));
        }

      const xhr: any = new XMLHttpRequest();
      let settled = false;
      const finalize = (callback) => {
        if (settled) return;
        settled = true;
        callback();
      };
      xhr.open("POST", getMessagesUploadUrl());
      xhr.timeout = CHAT_PAGE_CONFIG.pendingFileTimeoutMs;

      xhr.upload.onprogress = (event) => {
        if (settled) return;
        if (!event.lengthComputable) return;
        const percent: any = Math.max(
          0,
          Math.min(100, Math.round((event.loaded / event.total) * 100)),
        );
        setPendingUploadProgress(pendingMessage._clientId, percent, targetChatId);
      };

      xhr.onerror = () =>
        finalize(() => reject(new Error(t("chat.errors.uploadNetwork"))));
      xhr.ontimeout = () => finalize(() => reject(new Error(t("chat.errors.uploadTimeout"))));
      xhr.onload = async () => {
        const data: any = (() => {
          try {
            return JSON.parse(xhr.responseText || "{}");
          } catch {
            return {};
          }
        })();
        if (xhr.status >= 200 && xhr.status < 300) {
          const activeId: any = String(activeChatIdRef.current || "");
          const resolvedTargetId: any = String(targetChatId || "");
          if (!resolvedTargetId || activeId === resolvedTargetId) {
            setActiveUploadProgress(100);
            scheduleActiveUploadProgressHide();
          }
          finalize(() => resolve(data));
          return;
        }
        if (data?.error) {
          finalize(() => reject(new Error(String(data.error))));
          return;
        }
        if (isAmbiguousSendStatus(xhr.status)) {
          finalize(() =>
            reject(
              createAmbiguousSendError(
                xhr.status,
                t("chat.errors.unconfirmedDelivery", { code: xhr.status }),
              ),
            ),
          );
          return;
        }
        if (xhr.status === 413) {
          finalize(() => reject(
            new Error(t("chat.errors.uploadTooLarge", { code: 413 })),
          ));
          return;
        }
        finalize(() =>
          reject(
            new Error(
              t("chat.errors.sendFailedHttp", { code: xhr.status || "unknown" }),
            ),
          ),
        );
      };

        xhr.send(form);
      })().catch(reject);
    });

  const sendPendingMessage = async (pendingMessage) => {
    if (!pendingMessage || pendingMessage._delivery !== "sending") return;
    if (pendingMessage._awaitingServerEcho) return;

    const clientId = pendingMessage._clientId;
    const hasFiles = Array.isArray(pendingMessage._files) && pendingMessage._files.length > 0;
    const isEditingExistingMessage: any = Boolean(pendingMessage?._editMessageId);
    if (!clientId || sendingClientIdsRef.current.has(clientId)) return;

    const maxMessageChars = messageMaxChars;
    const messageTooLongError: any = t("chat.errors.messageTooLong", { limit: maxMessageChars });
    if (!hasFiles && String(pendingMessage.body || "").length > maxMessageChars) {
      setUploadError(messageTooLongError);
      setMessages((prev) =>
        prev.map((msg) =>
          msg?._clientId === clientId ? { ...msg, _delivery: "failed" } : msg,
        ),
      );
      return;
    }

    sendingClientIdsRef.current.add(clientId);
    const targetChatId: any = String(pendingMessage._chatId || activeChatId || "");
    let isTargetActive = false;
    try {
      if (!targetChatId) return;
      isTargetActive = String(activeChatIdRef.current || "") === targetChatId;
      const chatType =
        chats.find((chat) => String(chat.id) === targetChatId)?.type ||
        activeChatTypeRef.current ||
        null;
      const isSavedChat = String(chatType || "").toLowerCase() === "saved";
      let data: any = null;
      if (hasFiles) {
        if (isTargetActive) {
          setActiveUploadProgress(0);
        }
        data = await uploadPendingMessageWithProgress(pendingMessage, targetChatId);
      } else {
        const res = isEditingExistingMessage
          ? await editMessage({
              username: user.username,
              body: pendingMessage.body,
              chatId: targetChatId,
              messageId: pendingMessage._editMessageId,
            })
          : await sendMessage({
              username: user.username,
              body: pendingMessage.body,
              chatId: targetChatId,
              replyToMessageId: pendingMessage.replyTo?.id || null,
              clientRequestId: String(clientId),
            });
        data = await res.json();
        if (!res.ok) {
          if (isAmbiguousSendStatus(res.status) && !isEditingExistingMessage) {
            throw createAmbiguousSendError(
              res.status,
              t("chat.errors.unconfirmedDelivery", { code: res.status }),
            );
          }
          throw new Error(data?.error || t("chat.errors.sendFailed"));
        }
      }

      if (isEditingExistingMessage) {
        if (hasFiles && isTargetActive) {
          setActiveUploadProgress(100);
          scheduleActiveUploadProgressHide();
        }
        if (isTargetActive) {
          scheduleMessageRefreshRef.current?.(targetChatId, {
            preserveHistory: true,
            pruneMissing: true,
          });
        }
        await loadChats({ silent: true });
        setEditTarget(null);
        return;
      }

      updateOwnLatestChatPreview({
        chatId: targetChatId,
        body: pendingMessage.body,
        files: pendingMessage._files,
        createdAt:
          pendingMessage?._createdAt ||
          data?.created_at ||
          data?.createdAt ||
          new Date().toISOString(),
        messageId: data?.id || null,
      });

      const serverId = data?.id || data?._serverId || null;

      if (isTargetActive) {
        setMessages((prev) => {
          const uploadType: any = String(pendingMessage?._uploadType || "").toLowerCase();
          const files = Array.isArray(pendingMessage?._files) ? pendingMessage._files : [];
          const hasMediaVideo: any = files.some((file) =>
            String(file?.mimeType || "").toLowerCase().startsWith("video/"),
          );
          const responseFiles = Array.isArray(data?.files) && data.files.length > 0 ? data.files : null;
          const isProcessingOnServer = responseFiles
            ? responseFiles.some((f) => f.processing === true)
            : true;
          const keepPendingUntilServerEcho =
            hasFiles && uploadType === "media" && hasMediaVideo && isProcessingOnServer;
          const awaitingServerEcho: any = Boolean(keepPendingUntilServerEcho);
          const calculatedExpiresAt = data?.expiresAt || null;
          const index: any = prev.findIndex(
            (msg) =>
              (msg?._clientId && String(msg._clientId) === String(clientId)) ||
              (msg?.client_request_id && String(msg.client_request_id) === String(clientId)) ||
              (msg?.id && String(msg.id) === String(clientId)) ||
              (serverId && String(msg?._serverId || msg?.id) === String(serverId)),
          );
          if (index >= 0) {
            return prev.map((msg, msgIndex) =>
              msgIndex === index
                ? {
                    ...msg,
                    _clientId: clientId,
                    client_request_id: clientId,
                    _serverId: serverId || msg._serverId || null,
                    _delivery: keepPendingUntilServerEcho ? "sending" : "sent",
                    _processingPending:
                      keepPendingUntilServerEcho || Boolean(msg?._processingPending),
                    _awaitingServerEcho: awaitingServerEcho,
                    _uploadProgress: keepPendingUntilServerEcho ? 100 : null,
                    expiresAt: calculatedExpiresAt || msg.expiresAt || null,
                    files: responseFiles
                      ? responseFiles
                      : (msg.files || []).map((file) => ({
                          ...file,
                          expiresAt: calculatedExpiresAt || file?.expiresAt || file?.expires_at || null,
                          expires_at: calculatedExpiresAt || file?.expiresAt || file?.expires_at || null,
                        })),
                    read_at:
                      isSavedChat && !msg.read_at
                        ? msg.created_at || new Date().toISOString()
                        : msg.read_at,
                    read_by_user_id:
                      isSavedChat && !msg.read_by_user_id
                        ? user?.id || null
                        : msg.read_by_user_id,
                  }
                : msg,
            );
          }
          const createdAt = pendingMessage?._createdAt || new Date().toISOString();
          const pendingDate: any = parseServerDate(createdAt);
          const pendingDayKey = `${pendingDate.getFullYear()}-${pendingDate.getMonth()}-${pendingDate.getDate()}`;
          const pendingBody: any = String(pendingMessage?.body || "").trim();
          const messageFiles: any = (responseFiles || files).map((file) => ({
            id: file.id,
            _localId: file._localId || file.id,
            kind: file.kind,
            name: file.name || file.original_name || file.originalName || "",
            mimeType: file.mimeType || file.mime_type || "",
            sizeBytes: file.sizeBytes || file.size_bytes || 0,
            width: Number.isFinite(Number(file.width ?? file.width_px)) ? Number(file.width ?? file.width_px) : null,
            height: Number.isFinite(Number(file.height ?? file.height_px)) ? Number(file.height ?? file.height_px) : null,
            durationSeconds: Number.isFinite(Number(file.durationSeconds ?? file.duration_seconds))
              ? Number(file.durationSeconds ?? file.duration_seconds)
              : null,
            expiresAt: file.expiresAt || file.expires_at || calculatedExpiresAt || null,
            expires_at: file.expiresAt || file.expires_at || calculatedExpiresAt || null,
            url: file.url || null,
            processing:
              keepPendingUntilServerEcho &&
              String(file?.mimeType || file?.mime_type || "").toLowerCase().startsWith("video/"),
          }));
          return [
            ...prev,
            {
              id: clientId,
              username: user.username,
              body: pendingBody,
              created_at: createdAt,
              read_at: isSavedChat ? createdAt : null,
              read_by_user_id: isSavedChat ? user?.id || null : null,
              _clientId: clientId,
              client_request_id: clientId,
              _chatId: targetChatId,
              _queuedAt: Number(pendingMessage?._queuedAt || Date.now()),
              _delivery: keepPendingUntilServerEcho ? "sending" : "sent",
              _dayKey: pendingDayKey,
              _dayLabel: formatDayLabel(createdAt),
              _timeLabel: formatTime(createdAt),
              _uploadType: uploadType || "document",
              _files: files,
              _uploadProgress: keepPendingUntilServerEcho ? 100 : null,
              _awaitingServerEcho: awaitingServerEcho,
              _processingPending: keepPendingUntilServerEcho,
              _serverId: serverId,
              expiresAt: calculatedExpiresAt || null,
              replyTo: pendingMessage.replyTo || null,
              files: messageFiles,
            },
          ];
        });
      }
      if (hasFiles) {
        if (isTargetActive) {
          const uploadType: any = String(pendingMessage?._uploadType || "").toLowerCase();
          const files = Array.isArray(pendingMessage?._files) ? pendingMessage._files : [];
          const hasMediaVideo: any = files.some((file) =>
            String(file?.mimeType || "").toLowerCase().startsWith("video/"),
          );
          const responseFiles = Array.isArray(data?.files) && data.files.length > 0 ? data.files : null;
          const isProcessingOnServer = responseFiles
            ? responseFiles.some((f) => f.processing === true)
            : true;
          const keepPendingUntilServerEcho =
            uploadType === "media" && hasMediaVideo && isProcessingOnServer;
          if (!keepPendingUntilServerEcho) {
            if (activeUploadProgressHideTimerRef.current) {
              window.clearTimeout(activeUploadProgressHideTimerRef.current);
              activeUploadProgressHideTimerRef.current = null;
            }
            setActiveUploadProgress(null);
          }
        }
      }
      pendingScrollToBottomRef.current = false;
      // Keep optimistic row stable and let SSE/polling reconcile the final server row.
      // Avoid forcing a full sidebar refresh on every successful send.
    } catch (error) {
      const isNetworkError =
        (typeof navigator !== "undefined" && !navigator.onLine) ||
        error instanceof TypeError ||
        error?.name === "TypeError" ||
        String(error?.message || "").includes("Failed to fetch") ||
        String(error?.message || "").includes("NetworkError");

      if (isNetworkError && !isEditingExistingMessage) {
        // Keep message in _delivery: "sending" state so it flushes when online
        return;
      }

      if (
        !isEditingExistingMessage &&
        isAmbiguousSendStatus(error?._ambiguousSendStatus)
      ) {
        const retryQueuedAt: any = Date.now();
        if (isTargetActive) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg._clientId === clientId
                ? {
                    ...msg,
                    _delivery: "sending",
                    _queuedAt: retryQueuedAt,
                  }
                : msg,
            ),
          );
        }
        scheduleMessageRefreshRef.current?.(targetChatId, {
          preserveHistory: true,
        });
        void loadChats({ silent: true });
        return;
      }
      if (hasFiles) {
        if (isTargetActive) {
          if (activeUploadProgressHideTimerRef.current) {
            window.clearTimeout(activeUploadProgressHideTimerRef.current);
            activeUploadProgressHideTimerRef.current = null;
          }
          setActiveUploadProgress(null);
          setUploadError(String(error?.message || t("chat.errors.uploadFailed")));
          setMessages((prev) =>
            prev.map((msg) =>
              msg._clientId === clientId
                ? {
                    ...msg,
                    _delivery: "failed",
                    _uploadProgress: null,
                  }
                : msg,
            ),
          );
        }
      } else {
        if (isTargetActive) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg._clientId === clientId ? { ...msg, _delivery: "failed" } : msg,
            ),
          );
        }
      }
    } finally {
      sendingClientIdsRef.current.delete(clientId);
    }
  };

  useEffect(() => {
    if (!activeChatId) return;
    const pending: any = messages.filter((msg) => msg._delivery === "sending");
    if (!pending.length) return;
    pending.forEach((msg) => {
      void sendPendingMessage(msg);
    });
  }, [activeChatId, messages]);

  useEffect(() => {
    if (!activeChatId) return;
    // Only start the timeout-checker interval when there are actually pending
    // messages. This avoids a 1-second setMessages call when the queue is idle.
    const hasPending: any = messages.some(
      (msg) =>
        msg._delivery === "sending" &&
        !msg._awaitingServerEcho &&
        !msg?._serverId,
    );
    if (!hasPending) return;
    const interval: any = setInterval(() => {
      const isOnline =
        (typeof navigator === "undefined" || navigator.onLine !== false) &&
        sseConnected;
      if (!isOnline) return;

      setMessages((prev) => {
        const now: any = Date.now();
        let changed = false;
        const next: any = prev.map((msg) => {
          if (msg._delivery !== "sending") return msg;
          if (msg._awaitingServerEcho || msg?._serverId) {
            return msg;
          }
          const queuedAt: any = Number(msg._queuedAt || 0);
          const isFileMessage =
            Array.isArray(msg._files) && msg._files.length > 0;
          const timeoutMs = isFileMessage
            ? CHAT_PAGE_CONFIG.pendingFileTimeoutMs
            : CHAT_PAGE_CONFIG.pendingTextTimeoutMs;
          if (!queuedAt || now - queuedAt < timeoutMs) {
            return msg;
          }
          changed = true;
          return { ...msg, _delivery: "failed" };
        });
        return changed ? next : prev;
      });
    }, CHAT_PAGE_CONFIG.pendingStatusCheckIntervalMs);
    return () => clearInterval(interval);
  }, [activeChatId, messages, sseConnected]);

  useEffect(() => {
    if (!activeChatId || !isAppActive) return;
    const flushPending = () => {
      const isOnline =
        typeof navigator === "undefined" || navigator.onLine !== false;
      if (!isOnline && !sseConnected) return;
      const pending: any = messages.filter(
        (msg) => msg._delivery === "sending" && !msg._awaitingServerEcho,
      );
      if (!pending.length) return;
      pending.forEach((msg) => {
        void sendPendingMessage(msg);
      });
    };

    if (sseConnected) {
      flushPending();
    }

    const handleOnline = () => {
      flushPending();
    };

    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [activeChatId, messages, sseConnected, isAppActive]);

  useEffect(() => {
    if (!activeChatId || !isAppActive) return;
    const interval: any = setInterval(() => {
      const pending: any = messages.filter(
        (msg) => msg._delivery === "sending" && !msg._awaitingServerEcho,
      );
      if (!pending.length) return;
      pending.forEach((msg) => {
        void sendPendingMessage(msg);
      });
    }, CHAT_PAGE_CONFIG.pendingRetryIntervalMs);
    return () => clearInterval(interval);
  }, [activeChatId, messages, isAppActive]);

  useEffect(() => {
    if (!activeChatId || !isAppActive) return;
    const needsMediaSync: any = messages.some((msg) => {
      const isOwn: any = isMessageAuthoredByUser(msg, { username: user.username });
      if (!isOwn) return false;
      const hasFiles = Array.isArray(msg.files) ? msg.files.length > 0 : false;
      if (!hasFiles) return false;
      if (msg._processingPending) return true;
      if (msg._awaitingServerEcho) return true;
      if (msg._delivery === "sending") return true;
      return false;
    });
    if (!needsMediaSync) return;
    const backoff: any = getNetworkBackoffMultiplier();
    const mediaSyncIntervalMs: any = Math.max(2000, Math.round(2500 * backoff));
    const interval: any = setInterval(() => {
      void loadMessages(activeChatId, { silent: true, preserveHistory: true });
    }, mediaSyncIntervalMs);
    return () => clearInterval(interval);
  }, [activeChatId, messages, user.username, isMobileViewport, sseConnected, isAppActive]);

  useEffect(() => {
    if (!activeChatId) return;
    const cachePayload: any = {
      chatId: activeChatId,
      version: CHAT_CACHE_VERSION,
      messages,
      hasOlderMessages,
      lastMessageId: messages.length ? String(messages[messages.length - 1]?.id || "") : "",
      updatedAt: Date.now(),
    };
    writeMessagesCacheMemory(
      messagesCacheRef.current,
      activeChatId,
      cachePayload,
      activeChatIdRef.current,
    );
    if (user?.username) {
      const storagePayload: any = {
        ...cachePayload,
        messages: sanitizeMessagesForCache(messages),
      };
      if (messagesCacheWriteTimerRef.current) {
        clearTimeout(messagesCacheWriteTimerRef.current);
      }
      messagesCacheWriteTimerRef.current = setTimeout(() => {
        const key: any = buildMessagesCacheKey(user.username, activeChatId);
        void writeIdbCache(CACHE_STORES.messages, key, storagePayload);
        void updateMessagesIndex(user.username, activeChatId, cachePayload.updatedAt);
      }, 600);
    }
    return () => {
      if (messagesCacheWriteTimerRef.current) {
        clearTimeout(messagesCacheWriteTimerRef.current);
      }
    };
  }, [activeChatId, messages, hasOlderMessages, user?.username]);

  useEffect(() => {
    if (settingsPanel !== "profile" && profileError) {
      setProfileError("");
    }
    if (settingsPanel !== "security" && passwordError) {
      setPasswordError("");
    }
  }, [settingsPanel, profileError, passwordError]);

  async function loadChats(options: any = {}) {
    if (loadChatsInFlightRef.current) {
      const queued: any = {
        silent: Boolean(options.silent),
        showUpdating: Boolean(options.showUpdating),
        preserveActiveUnread: Boolean(options.preserveActiveUnread),
      };
      if (queuedLoadChatsOptionsRef.current) {
        queuedLoadChatsOptionsRef.current = {
          silent:
            queuedLoadChatsOptionsRef.current.silent && queued.silent,
          showUpdating:
            queuedLoadChatsOptionsRef.current.showUpdating || queued.showUpdating,
          preserveActiveUnread:
            queuedLoadChatsOptionsRef.current.preserveActiveUnread ||
            queued.preserveActiveUnread,
        };
      } else {
        queuedLoadChatsOptionsRef.current = queued;
      }
      return;
    }
    loadChatsInFlightRef.current = true;
    if (loadChatsAbortRef.current) {
      loadChatsAbortRef.current.abort();
    }
    const controller: any = new AbortController();
    loadChatsAbortRef.current = controller;
    const showUpdating: any = Boolean(options.showUpdating);
    if (!options.silent) {
      setLoadingChats(true);
    }
    if (showUpdating) {
      setIsUpdatingChats(true);
    }
    try {
      const res: any = await listChatsForUser(user.username, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data: any = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load chats.");
      }
      const list: any = (data.chats || []).flatMap((conv) => {
        const chatId: any = normalizeUuid(conv.id);
        // Req 6.6: discard responses with non-UUID (legacy integer) IDs
        if (!chatId) return [];
        return [{
          ...conv,
          id: chatId,
          last_message: normalizeMessageBody(conv.last_message),
          members: (conv.members || []).flatMap((member) => {
            const memberId: any = normalizeUuid(member.id);
            if (!memberId) return [];
            return [{ ...member, id: memberId }];
          }),
        }];
      });
      list.sort((a, b) => {
        const aTime = a.last_time ? parseServerDate(a.last_time).getTime() : 0;
        const bTime = b.last_time ? parseServerDate(b.last_time).getTime() : 0;
        return bTime - aTime;
      });
      const deduped: any = [];
      const dmByPeer: any = new Map<any, any>();
      list.forEach((chat) => {
        if (chat.type !== "dm") {
          deduped.push(chat);
          return;
        }
        const peer: any = (chat.members || []).find(
          (member) =>
            String(member?.username || "").toLowerCase() !==
            String(user?.username || "").toLowerCase(),
        );
        const peerKey: any = (peer?.username || "").toLowerCase();
        if (!peerKey) {
          deduped.push(chat);
          return;
        }
        const existing: any = dmByPeer.get(peerKey);
        if (!existing) {
          dmByPeer.set(peerKey, chat);
          return;
        }
        const existingLastMessageId = existing.last_message_id || null;
        const nextLastMessageId = chat.last_message_id || null;
        if (nextLastMessageId !== existingLastMessageId) {
          // With UUIDs we can't compare magnitudes; prefer the chat with the
          // more recent last_time instead, falling back to keeping existing.
          const existingTime2 = existing.last_time
            ? parseServerDate(existing.last_time).getTime()
            : 0;
          const nextTime2 = chat.last_time
            ? parseServerDate(chat.last_time).getTime()
            : 0;
          if (nextTime2 > existingTime2) {
            dmByPeer.set(peerKey, chat);
          }
          return;
        }
        const existingTime = existing.last_time
          ? parseServerDate(existing.last_time).getTime()
          : 0;
        const nextTime = chat.last_time
          ? parseServerDate(chat.last_time).getTime()
          : 0;
        if (nextTime > existingTime) {
          dmByPeer.set(peerKey, chat);
        }
      });
      const dmList: any = Array.from(dmByPeer.values());
      const merged = [...deduped, ...dmList];
      merged.sort((a, b) => {
        const aTime = a.last_time ? parseServerDate(a.last_time).getTime() : 0;
        const bTime = b.last_time ? parseServerDate(b.last_time).getTime() : 0;
        return bTime - aTime;
      });
      const normalizeFetchedChats = (prevChats: any = []) =>
        merged
          .map((chat) => {
            const isActiveChat =
              activeChatIdRef.current && chat?.id &&
              String(activeChatIdRef.current).toLowerCase() === String(chat.id).toLowerCase();
            const isReadableNow =
              canMarkReadInCurrentView &&
              typeof document !== "undefined" &&
              document.visibilityState === "visible" &&
              document.hasFocus();
            // Only zero the badge for the active chat if the user has actually
            // scrolled to the bottom and seen everything (no unread marker).
            // Without this guard, any loadChats call (SSE, polling, etc.) would
            // instantly clear the badge even while the user is reading.
            // Also never clear while the chat is still opening (openingChatRef).
            const userIsAtBottom =
              isAtBottomRef.current &&
              !userScrolledUpRef.current &&
              unreadMarkerIdRef.current === null &&
              !openingChatRef.current;
            const canClearActiveUnread =
              isActiveChat &&
              !options.preserveActiveUnread &&
              isReadableNow &&
              userIsAtBottom;
            const resolveUnread = (serverCount, prevChat) => {
              if (canClearActiveUnread) return 0;
              const server: any = Number(serverCount || 0);
              if (isActiveChat && isReadableNow) {
                const local: any = Number(prevChat?.unread_count ?? server);
                if (openingChatRef.current || unreadMarkerIdRef.current !== null) {
                  return local;
                }
                if (options.preserveActiveUnread) {
                  return Math.min(server, local);
                }
              }
              return server;
            };
            const muted: any = Boolean(Number(chat?.muted || 0));
            const files = Array.isArray(chat?.last_message_files)
              ? chat.last_message_files
              : [];
            const hasProcessingVideo: any = files.some(
              (file) =>
                String(file?.mimeType || "").toLowerCase().startsWith("video/") &&
                file?.processing === true &&
                !String(file?.url || "").includes("-h264-"),
            );
            const lastMessageIdentity: any = {
              username: chat?.last_sender_username,
              client_request_id: chat?.last_message_client_request_id,
            };
            const userIdentity: any = { username: user.username };
            const isFromSelf: any = isMessageAuthoredByUser(
              lastMessageIdentity,
              userIdentity,
            );
            const isFromOther: any = isMessageFromOtherUser(
              lastMessageIdentity,
              userIdentity,
            );
            if (hasProcessingVideo && isFromSelf) {
              return {
                ...chat,
                _lastMessagePending: true,
                last_message_read_at: null,
                unread_count: resolveUnread(chat?.unread_count, prevChats.find((p) => p.id === chat.id)),
                _muted: muted,
              };
            }
            if (!hasProcessingVideo || !isFromOther) {
              return {
                ...chat,
                unread_count: resolveUnread(chat?.unread_count, prevChats.find((p) => p.id === chat.id)),
                _muted: muted,
              };
            }
            const previous: any = prevChats.find(
              (existing) => existing.id === chat.id,
            );
            if (!previous) {
              return {
                ...chat,
                unread_count: resolveUnread(chat?.unread_count, null),
                _muted: muted,
              };
            }
            return {
              ...chat,
              last_message_id: previous.last_message_id,
              last_message: previous.last_message,
              last_time: previous.last_time,
              last_sender_id: previous.last_sender_id,
              last_sender_username: previous.last_sender_username,
              last_sender_nickname: previous.last_sender_nickname,
              last_sender_avatar_url: previous.last_sender_avatar_url,
              last_message_read_at:
                previous.last_message_read_at ?? chat.last_message_read_at ?? null,
              last_message_files: previous.last_message_files || [],
              unread_count: resolveUnread(chat?.unread_count, previous),
              _muted: muted,
            };
          })
          .map((chat) => ({
            ...chat,
            last_message: normalizeMessageBody(chat.last_message),
          }));
      const normalizedPatched: any = normalizeFetchedChats(chats);
      setChats((prev) => normalizeFetchedChats(prev));
      const chatListPayload: any = {
        version: CHAT_CACHE_VERSION,
        updatedAt: Date.now(),
        chats: normalizedPatched,
      };
      void writeIdbCache(
        CACHE_STORES.chatList,
        buildChatListCacheKey(user.username),
        chatListPayload,
      );

      const currentActiveChatId = activeChatIdRef.current || null;
      if (currentActiveChatId) {
        const activeChatStillExists: any = normalizedPatched.some(
          (item) => item.id === currentActiveChatId,
        );
        if (!activeChatStillExists) {
          closeChat();
        }
      }

      const pendingOpenChatIdRaw =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem(OPEN_CHAT_ID_KEY)
          : null;
      const pendingOpenChatId = normalizeUuid(pendingOpenChatIdRaw) || pendingOpenChatIdRaw;
      if (pendingOpenChatId) {
        const pendingChat: any = normalizedPatched.find(
          (item) => item.id === pendingOpenChatId,
        );
        if (pendingChat) {
          setActiveChatId(pendingOpenChatId);
          if (pendingChat.type === "dm") {
            const nextOther: any = (pendingChat.members || []).find(
              (member) =>
                String(member?.username || "").toLowerCase() !==
                String(user?.username || "").toLowerCase(),
            );
            setActivePeer(nextOther || null);
          } else {
            setActivePeer(null);
          }
          setMobileTab("chat");
          window.sessionStorage.removeItem(OPEN_CHAT_ID_KEY);
        }
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
      // Keep sidebar usable even when polling fails.
    } finally {
      if (loadChatsAbortRef.current === controller) {
        loadChatsAbortRef.current = null;
      }
      loadChatsInFlightRef.current = false;
      const queued = queuedLoadChatsOptionsRef.current;
      queuedLoadChatsOptionsRef.current = null;
      if (!options.silent) {
        setLoadingChats(false);
      }
      if (showUpdating) {
        setIsUpdatingChats(false);
      }
      if (queued) {
        void loadChats(queued);
      }
    }
  }


  function clearPendingUploads() {
    setPendingUploadFiles((prev) => {
      prev.forEach((file) => {
        if (file.previewUrl) {
          URL.revokeObjectURL(file.previewUrl);
        }
      });
      return [];
    });
    setPendingUploadType("");
    setUploadError("");
    scrollToBottomIfSafe("auto");
  }

  function clearPendingVoiceMessage() {
    setPendingVoiceMessage((prev) => {
      if (prev?.previewUrl) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return null;
    });
  }

  function handleVoiceRecorded(payload) {
    if (!payload?.file) return;
    if (!CHAT_PAGE_CONFIG.fileUploadEnabled) {
      setUploadError(t("chat.errors.uploadsDisabled"));
      return;
    }
    if (fileUploadInProgress || activeUploadProgress !== null) {
      setUploadError(t("chat.errors.uploadInProgress"));
      return;
    }
    if (pendingVoiceMessage) {
      setUploadError(t("chat.errors.removeVoiceFirst"));
      return;
    }
    if (pendingUploadFiles.length) {
      setUploadError(t("chat.errors.removeAttachmentsFirst"));
      return;
    }
    const file = payload.file;
    const sizeBytes: any = Number(file.size || 0);
    if (sizeBytes > CHAT_PAGE_CONFIG.maxFileSizeBytes) {
      setUploadError(
        t("chat.errors.fileTooLarge", {
          size: formatBytesAsMb(CHAT_PAGE_CONFIG.maxFileSizeBytes),
        }),
      );
      return;
    }
    if (sizeBytes > CHAT_PAGE_CONFIG.maxTotalUploadBytes) {
      setUploadError(
        t("chat.errors.totalTooLarge", {
          size: formatBytesAsMb(CHAT_PAGE_CONFIG.maxTotalUploadBytes),
        }),
      );
      return;
    }
    setUploadError("");
    clearPendingVoiceMessage();
    const previewUrl: any = URL.createObjectURL(file);
    setPendingVoiceMessage({
      id: `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      name: file.name || "voice-message",
      mimeType: payload.mimeType || file.type || "audio/webm",
      sizeBytes,
      durationSeconds: Number(payload.durationSeconds || 0) || null,
      previewUrl,
      kind: "voice",
    });
    if (activeChatId && !userScrolledUpRef.current) {
      scrollToBottomIfSafe("auto");
    }
  }

  function removePendingUpload(id) {
    setPendingUploadFiles((prev) => {
      const next: any = prev.filter((file) => {
        if (file.id === id) {
          if (file.previewUrl) {
            URL.revokeObjectURL(file.previewUrl);
          }
          return false;
        }
        return true;
      });
      if (!next.length) {
        setPendingUploadType("");
      }
      return next;
    });
  }

  function getMediaFileMetadata(file) {
    const mimeType: any = String(file?.type || "").toLowerCase();
    if (mimeType.startsWith("image/")) {
      if (typeof window.createImageBitmap !== "function") {
        return Promise.resolve({ width: null, height: null, durationSeconds: null });
      }
      return window.createImageBitmap(file)
        .then((bitmap) => {
          const metadata = {
            width: Number.isFinite(Number(bitmap.width)) ? Number(bitmap.width) : null,
            height: Number.isFinite(Number(bitmap.height)) ? Number(bitmap.height) : null,
            durationSeconds: null,
          };
          if (typeof bitmap.close === "function") {
            bitmap.close();
          }
          return metadata;
        })
        .catch(() => ({ width: null, height: null, durationSeconds: null }));
    }
    if (mimeType.startsWith("video/")) {
      return new Promise<any>((resolve) => {
        let objectUrl: any = null;
        let resolved = false;
        try {
          objectUrl = URL.createObjectURL(file);
        } catch {
          return resolve({ width: null, height: null, durationSeconds: null });
        }

        const video: any = document.createElement("video");
        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;

        const resolveOnce = (metadata) => {
          if (resolved) return;
          resolved = true;
          cleanup();
          resolve(metadata);
        };

        const cleanup = () => {
          try {
            video.pause();
          } catch {
            // no-op
          }
          video.removeAttribute("src");
          if (objectUrl) {
            try {
              URL.revokeObjectURL(objectUrl);
            } catch {
              // no-op
            }
            objectUrl = null;
          }
        };

        video.onloadedmetadata = () => {
          resolveOnce({
            width: video.videoWidth || null,
            height: video.videoHeight || null,
            durationSeconds: Number.isFinite(Number(video.duration))
              ? Number(video.duration)
              : null,
          });
        };
        video.onerror = () => {
          resolveOnce({ width: null, height: null, durationSeconds: null });
        };

        video.src = objectUrl;
      });
    }
    if (mimeType.startsWith("audio/")) {
      return new Promise<any>((resolve) => {
        let objectUrl: any = null;
        let resolved = false;
        try {
          objectUrl = URL.createObjectURL(file);
        } catch {
          return resolve({ width: null, height: null, durationSeconds: null });
        }

        const audio: any = document.createElement("audio");
        audio.preload = "metadata";

        const resolveOnce = (metadata) => {
          if (resolved) return;
          resolved = true;
          cleanup();
          resolve(metadata);
        };

        const cleanup = () => {
          try {
            audio.pause();
          } catch {
            // no-op
          }
          audio.removeAttribute("src");
          if (objectUrl) {
            try {
              URL.revokeObjectURL(objectUrl);
            } catch {
              // no-op
            }
            objectUrl = null;
          }
        };

        audio.onloadedmetadata = () => {
          resolveOnce({
            width: null,
            height: null,
            durationSeconds: Number.isFinite(Number(audio.duration))
              ? Number(audio.duration)
              : null,
          });
        };
        audio.onerror = () => {
          resolveOnce({ width: null, height: null, durationSeconds: null });
        };

        audio.src = objectUrl;
      });
    }
    return Promise.resolve({ width: null, height: null, durationSeconds: null });
  }

  async function handleUploadFilesSelected(fileList, uploadType, append = false) {
    if (!CHAT_PAGE_CONFIG.fileUploadEnabled) {
      setUploadError(t("chat.errors.uploadsDisabled"));
      return;
    }
    if (fileUploadInProgress || activeUploadProgress !== null) {
      setUploadError(t("chat.errors.uploadInProgress"));
      return;
    }
    const incoming: any = Array.from(fileList || []);
    if (!incoming.length) return;
    setUploadError("");
    if (
      append &&
      pendingUploadType &&
      uploadType !== pendingUploadType
    ) {
      setUploadError(t("chat.errors.oneTypePerMessage"));
      return;
    }
    const existing = append ? pendingUploadFiles : [];
    const combinedCount = existing.length + incoming.length;

    if (combinedCount > CHAT_PAGE_CONFIG.maxFilesPerMessage) {
      setUploadError(
        t("chat.errors.maxFilesPerMessage", { count: CHAT_PAGE_CONFIG.maxFilesPerMessage }),
      );
      return;
    }
    const oversize: any = incoming.find(
      (file) => Number(file.size || 0) > CHAT_PAGE_CONFIG.maxFileSizeBytes,
    );
    if (oversize) {
      setUploadError(
        t("chat.errors.fileTooLarge", {
          size: formatBytesAsMb(CHAT_PAGE_CONFIG.maxFileSizeBytes),
        }),
      );
      return;
    }
    const existingBytes: any = existing.reduce(
      (sum, file) => sum + Number(file.sizeBytes || file.size || 0),
      0,
    );
    const incomingBytes: any = incoming.reduce((sum, file) => sum + Number(file.size || 0), 0);
    const totalBytes = existingBytes + incomingBytes;
    if (totalBytes > CHAT_PAGE_CONFIG.maxTotalUploadBytes) {
      setUploadError(
        t("chat.errors.totalTooLarge", {
          size: formatBytesAsMb(CHAT_PAGE_CONFIG.maxTotalUploadBytes),
        }),
      );
      return;
    }
    if (uploadType === "media") {
      const invalid: any = incoming.find(
        (file) =>
          !String(file.type || "").startsWith("image/") &&
          !String(file.type || "").startsWith("video/"),
      );
      if (invalid) {
        setUploadError(t("chat.errors.mediaOnly"));
        return;
      }
    }

    if (!append) {
      clearPendingUploads();
    }

    const metadata = await Promise.all(
      incoming.map((file) => getMediaFileMetadata(file)),
    );
    const nextItems: any = incoming.map((file, index) => ({
      id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: Number(file.size || 0),
      width: metadata[index]?.width || null,
      height: metadata[index]?.height || null,
      durationSeconds: metadata[index]?.durationSeconds ?? null,
      previewUrl:
        String(file.type || "").startsWith("image/") ||
        String(file.type || "").startsWith("video/") ||
        String(file.type || "").startsWith("audio/")
        ? URL.createObjectURL(file)
        : null,
    }));

    setPendingUploadFiles((prev) => (append ? [...prev, ...nextItems] : nextItems));
    setPendingUploadType(uploadType);
    if (activeChatId && !userScrolledUpRef.current) {
      scrollToBottomIfSafe("auto");
    }
  }

  const handleMessageInput: any = useCallback(
    (value) => {
      const trimmed: any = String(value || "").trim();
      if (
        uploadError &&
        uploadError ===
          t("chat.errors.messageTooLong", { limit: messageMaxChars }) &&
        trimmed.length <= messageMaxChars
      ) {
        setUploadError("");
      }

      const chatId = activeChatId || "";
      const activeType: any = String(activeChatTypeRef.current || "").toLowerCase();
      if (!chatId || !canSendInActiveChat || activeType === "channel") {
        stopTypingIndicator(chatId);
        return;
      }

      const shouldType: any = Boolean(trimmed.length);
      const typingState = typingStateRef.current;
      const now: any = Date.now();

      if (typingState.chatId !== chatId && typingState.isTyping) {
        stopTypingIndicator(typingState.chatId);
      }

      if (!shouldType) {
        stopTypingIndicator(chatId);
        return;
      }

      clearLocalTypingStopTimer();
      typingStopTimerRef.current = window.setTimeout(() => {
        stopTypingIndicator(chatId);
      }, TYPING_IDLE_TIMEOUT_MS);

      const shouldSendTypingSignal =
        !typingState.isTyping ||
        typingState.chatId !== chatId ||
        now - Number(typingState.lastSentAt || 0) >= TYPING_SIGNAL_THROTTLE_MS;

      if (shouldSendTypingSignal) {
        sendTypingSignal(chatId, true);
        typingStateRef.current = {
          chatId,
          isTyping: true,
          lastSentAt: now,
        };
      }
    },
    [
      activeChatId,
      canSendInActiveChat,
      clearLocalTypingStopTimer,
      messageMaxChars,
      sendTypingSignal,
      stopTypingIndicator,
      t,
      uploadError,
      TYPING_IDLE_TIMEOUT_MS,
      TYPING_SIGNAL_THROTTLE_MS,
    ],
  );

  async function handleSend(event) {
    event.preventDefault();
    if (!activeChatId) return;
    stopTypingIndicator(activeChatId);
    const isEditingMessage: any = Boolean(editTarget?.id);
    const shouldSnapToBottom = !(isEditingMessage && userScrolledUpRef.current);
    if (shouldSnapToBottom) {
      userScrolledUpRef.current = false;
      setUserScrolledUp(false);
      isAtBottomRef.current = true;
      setIsAtBottom(true);
    }
    shouldAutoMarkReadRef.current = true;
    setUnreadMarkerId(null);
    unreadMarkerIdRef.current = null;
    const form = event.currentTarget;
    const formData: any = new FormData(form);
    const body = formData.get("message")?.toString() || "";
    if (body === "[object Object]") {
      setUploadError(t("chat.errors.invalidBody"));
      return;
    }
    const trimmedBody: any = body.trim();
    const hasPendingFiles = pendingUploadFiles.length > 0;
    const hasPendingVoice: any = Boolean(pendingVoiceMessage);
    const hasAnyPendingFiles = hasPendingFiles || hasPendingVoice;
    if (!trimmedBody && !hasAnyPendingFiles) return;
    const maxMessageChars = messageMaxChars;
    if (String(body).length > maxMessageChars) {
      setUploadError(t("chat.errors.messageTooLong", { limit: maxMessageChars }));
      return;
    }
    if (uploadError) {
      setUploadError("");
    }

    const isSavedChat = isActiveSavedChat;

    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt: any = new Date().toISOString();
    const queuedAt: any = Date.now();
    const pendingDate: any = parseServerDate(createdAt);
    const pendingDayKey = `${pendingDate.getFullYear()}-${pendingDate.getMonth()}-${pendingDate.getDate()}`;
    const pendingFiles = hasAnyPendingFiles
      ? [
          ...pendingUploadFiles.map((item) => {
            const localUrl =
              item.file instanceof Blob &&
              (String(item.mimeType || "").startsWith("image/") ||
                String(item.mimeType || "").startsWith("video/") ||
                String(item.mimeType || "").startsWith("audio/"))
                ? URL.createObjectURL(item.file)
                : item.previewUrl || null;
            return {
              id: item.id,
              _localId: item.id,
              kind: pendingUploadType === "document" ? "document" : "media",
              name: item.name,
              mimeType: item.mimeType,
              sizeBytes: item.sizeBytes,
              width: Number.isFinite(Number(item.width)) ? Number(item.width) : null,
              height: Number.isFinite(Number(item.height)) ? Number(item.height) : null,
              durationSeconds: Number.isFinite(Number(item.durationSeconds))
                ? Number(item.durationSeconds)
                : null,
              url: localUrl,
              _localUrl: localUrl,
              file: item.file,
            };
          }),
          ...(hasPendingVoice && pendingVoiceMessage
            ? [
                (() => {
                  const localUrl = pendingVoiceMessage.file instanceof Blob
                    ? URL.createObjectURL(pendingVoiceMessage.file)
                    : pendingVoiceMessage.previewUrl || null;
                  return {
                    id: pendingVoiceMessage.id,
                    _localId: pendingVoiceMessage.id,
                    kind: "voice",
                    name: pendingVoiceMessage.name,
                    mimeType: pendingVoiceMessage.mimeType,
                    sizeBytes: pendingVoiceMessage.sizeBytes,
                    width: null,
                    height: null,
                    durationSeconds: Number.isFinite(Number(pendingVoiceMessage.durationSeconds))
                      ? Number(pendingVoiceMessage.durationSeconds)
                      : null,
                    url: localUrl,
                    _localUrl: localUrl,
                    file: pendingVoiceMessage.file,
                  };
                })(),
              ]
            : []),
        ]
      : [];
    const replyPayload = !isEditingMessage && replyTarget
      ? {
          id: replyTarget.id,
          username: replyTarget.username,
          nickname: replyTarget.nickname,
          body: replyTarget.body,
          icon: replyTarget.icon || null,
          displayName: replyTarget.displayName,
          color: replyTarget.color || null,
        }
      : null;

    const effectiveUploadType = hasPendingFiles
      ? pendingUploadType
      : hasPendingVoice
        ? "media"
        : pendingUploadType;

    if (hasAnyPendingFiles) {
      form.reset();
      clearPendingUploads();
      clearPendingVoiceMessage();
      pendingScrollToBottomRef.current = shouldSnapToBottom;

      const pendingMessage: any = {
        _clientId: tempId,
        client_request_id: tempId,
        _chatId: activeChatId,
        _queuedAt: queuedAt,
        _delivery: "sending",
        _editMessageId: isEditingMessage ? String(editTarget.id) : null,
        _uploadType: effectiveUploadType,
        _files: pendingFiles,
        _createdAt: createdAt,
        _dayKey: pendingDayKey,
        body: trimmedBody || (isEditingMessage ? String(editTarget?.body || "") : ""),
        replyTo: replyPayload,
        read_at: isSavedChat ? createdAt : null,
        read_by_user_id: isSavedChat ? user?.id || null : null,
      };
      updateOwnLatestChatPreview({
        chatId: activeChatId,
        body: pendingMessage.body,
        files: pendingFiles,
        createdAt,
      });
      await sendPendingMessage(pendingMessage);
      setReplyTarget(null);
      setEditTarget(null);
      return;
    }

    if (isEditingMessage) {
      form.reset();
      clearPendingUploads();
      clearPendingVoiceMessage();
      pendingScrollToBottomRef.current = shouldSnapToBottom;
      const pendingMessage: any = {
        _clientId: tempId,
        client_request_id: tempId,
        _chatId: activeChatId,
        _queuedAt: queuedAt,
        _delivery: "sending",
        _editMessageId: String(editTarget.id),
        _uploadType: effectiveUploadType,
        _files: pendingFiles,
        body: trimmedBody,
      };
      await sendPendingMessage(pendingMessage);
      setReplyTarget(null);
      setEditTarget(null);
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        username: user.username,
        body: trimmedBody,
        created_at: createdAt,
        read_at: isSavedChat ? createdAt : null,
        read_by_user_id: isSavedChat ? user?.id || null : null,
        _clientId: tempId,
        client_request_id: tempId,
        _chatId: activeChatId,
        _queuedAt: queuedAt,
        _delivery: "sending",
        _dayKey: pendingDayKey,
        _dayLabel: formatDayLabel(createdAt),
        _timeLabel: formatTime(createdAt),
        _uploadType: effectiveUploadType,
        _files: pendingFiles,
        _uploadProgress: hasAnyPendingFiles ? 0 : null,
        _awaitingServerEcho: false,
        replyTo: replyPayload,
        files: pendingFiles.map((file) => ({
          id: file.id,
          _localId: file._localId || file.id,
          kind: file.kind,
          name: file.name,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          width: file.width,
          height: file.height,
          durationSeconds: file.durationSeconds,
          url: file.url,
        })),
      },
    ]);
    form.reset();
    clearPendingUploads();
    clearPendingVoiceMessage();
    pendingScrollToBottomRef.current = shouldSnapToBottom;
    setReplyTarget(null);

    updateOwnLatestChatPreview({
      chatId: activeChatId,
      body: trimmedBody,
      files: pendingFiles,
      createdAt,
    });

    if (!isConnected) {
      return;
    }

    const pendingMessage: any = {
      _clientId: tempId,
      client_request_id: tempId,
      _chatId: activeChatId,
      _queuedAt: queuedAt,
      _delivery: "sending",
      _uploadType: effectiveUploadType,
      _files: pendingFiles,
      body: trimmedBody,
      replyTo: replyPayload,
    };
    await sendPendingMessage(pendingMessage);
  }

  async function startDirectMessage() {
    if (!newChatUsername.trim()) return;
    setNewChatError("");
    try {
      if (!isConnected) {
        setNewChatError(t("chat.errors.serverUnreachable"));
        return;
      }
      const matched = newChatSelection;
      if (!matched) {
        setNewChatError(t("chat.errors.pickUserFromResults"));
        return;
      }
      const target = matched.username;
      const res: any = await createDmChat({ from: user.username, to: target });
      const data: any = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error || t("chat.errors.startChatFailed", { code: res.status }),
        );
      }
      if (!data?.id) {
        throw new Error(t("chat.errors.noChatId"));
      }
      setActiveChatId(data.id);
      setActivePeer(matched);
      setNewChatUsername("");
      setNewChatOpen(false);
      setMobileTab("chat");
      await loadChats();
    } catch (err) {
      setNewChatError(err.message);
    }
  }

  async function handleStatusUpdate(nextStatus) {
    if (!user || user.status === nextStatus) return;
    try {
      const res: any = await updateStatusRequest({
        username: user.username,
        status: nextStatus,
      });
      const data: any = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Unable to update status.");
      }
      const nextUser: any = { ...user, status: data.status };
      setUser(nextUser);
    } catch {}
  }

  async function handleAvatarChange(event) {
    if (!CHAT_PAGE_CONFIG.fileUploadEnabled) {
      setProfileError(t("chat.errors.uploadsDisabled"));
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (!String(file.type || "").toLowerCase().startsWith("image/")) {
      setProfileError(t("chat.profileErrors.photoMustBeImage"));
      event.target.value = "";
      return;
    }
    if (Number(file.size || 0) > CHAT_PAGE_CONFIG.maxFileSizeBytes) {
      setProfileError(
        t("chat.profileErrors.photoTooLarge", {
          size: formatBytesAsMb(CHAT_PAGE_CONFIG.maxFileSizeBytes),
        }),
      );
      event.target.value = "";
      return;
    }

    const previewUrl: any = URL.createObjectURL(file);
    setProfileError("");
    if (pendingAvatarFile?.previewUrl) {
      URL.revokeObjectURL(pendingAvatarFile.previewUrl);
    }
    setPendingAvatarFile({ file, previewUrl });
    setAvatarPreview(previewUrl);
    event.target.value = "";
  }

  function handleAvatarRemove() {
    setProfileError("");
    if (pendingAvatarFile?.previewUrl) {
      URL.revokeObjectURL(pendingAvatarFile.previewUrl);
    }
    setPendingAvatarFile(null);
    setAvatarPreview("");
    setProfileForm((prev) => ({ ...prev, avatarUrl: "" }));
  }

  async function handleProfileSave(event) {
    event.preventDefault();
    setProfileError("");
    const trimmedNickname: any = profileForm.nickname.trim();
    const trimmedUsername: any = profileForm.username.trim().toLowerCase();
    if (trimmedNickname.length > NICKNAME_MAX) {
      setProfileError(
        t("chat.profileErrors.nicknameTooLong", { limit: NICKNAME_MAX }),
      );
      return;
    }
    if (trimmedUsername.length > USERNAME_MAX) {
      setProfileError(
        t("chat.profileErrors.usernameTooLong", { limit: USERNAME_MAX }),
      );
      return;
    }
    if (trimmedUsername.length < 3) {
      setProfileError(t("chat.profileErrors.usernameTooShort"));
      return;
    }
    if (!USERNAME_REGEX.test(trimmedUsername)) {
      setProfileError(t("chat.profileErrors.usernameInvalidChars"));
      return;
    }
    try {
      let avatarUrlToSave = profileForm.avatarUrl;
      if (pendingAvatarFile?.file) {
        if (!CHAT_PAGE_CONFIG.fileUploadEnabled) {
          throw new Error(t("chat.errors.uploadsDisabled"));
        }
        const s3Upload: any = await uploadAvatarFile(pendingAvatarFile.file);
        if (s3Upload.directS3 && s3Upload.avatarUrl) {
          const uploadRes: any = await uploadAvatar({
            currentUsername: user.username,
            avatarUrl: s3Upload.avatarUrl,
          });
          const uploadData: any = await uploadRes.json();
          if (!uploadRes.ok) {
            throw new Error(uploadData?.error || t("chat.profileErrors.photoUploadFailed"));
          }
          avatarUrlToSave = uploadData.avatarUrl || s3Upload.avatarUrl;
        } else {
          const payload: any = new FormData();
          payload.append("avatar", pendingAvatarFile.file);
          payload.append("currentUsername", user.username);
          const uploadRes: any = await uploadAvatar(payload);
          const uploadData: any = await uploadRes.json();
          if (!uploadRes.ok) {
            throw new Error(uploadData?.error || t("chat.profileErrors.photoUploadFailed"));
          }
          avatarUrlToSave = uploadData.avatarUrl || "";
        }
      }
      const res: any = await updateProfile({
        currentUsername: user.username,
        username: trimmedUsername,
        nickname: trimmedNickname,
        avatarUrl: avatarUrlToSave,
      });
      const data: any = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || t("chat.profileErrors.updateFailed"));
      }
      const nextUser: any = {
        ...user,
        username: data.username,
        nickname: data.nickname,
        avatarUrl: data.avatarUrl,
        color: data.color || user.color || null,
        status: data.status,
      };
      let updatedUser = nextUser;

      if (statusSelection && statusSelection !== (user.status || "online")) {
        await handleStatusUpdate(statusSelection);
        updatedUser = { ...updatedUser, status: statusSelection };
      }

      setUser(updatedUser);
      if (pendingAvatarFile?.previewUrl) {
        URL.revokeObjectURL(pendingAvatarFile.previewUrl);
      }
      setPendingAvatarFile(null);
      setSettingsPanel(null);
    } catch (err) {
      setProfileError(err.message);
    }
  }

  async function handlePasswordSave(event) {
    event.preventDefault();
    setPasswordError("");
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      const message: any = t("chat.securityErrors.passwordMismatch");
      setPasswordError(message);
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      const message: any = t("chat.securityErrors.passwordTooShort");
      setPasswordError(message);
      return;
    }
    try {
      const res: any = await updatePassword({
        username: user.username,
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      const data: any = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || t("chat.securityErrors.updateFailed"));
      }
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setSettingsPanel(null);
    } catch (err) {
      setPasswordError(err.message);
    }
  }

  function handleLogout() {
    logout().catch(() => null);
    setUser(null);
    setMobileTab("chats");
  }

  const [supportOpen, setSupportOpen] = useState(false);
  const closeSupportModal = () => setSupportOpen(false);

  // Opens the fairly-routed support conversation created by the helpdesk.
  async function handleSupportCreated(result) {
    setSupportOpen(false);
    if (!result?.chatId) return;
    setActiveChatId(result.chatId);
    if (result.operator) {
      setActivePeer({
        username: result.operator.username,
        nickname: result.operator.nickname,
        color: result.operator.color,
        avatar_url: null,
        status: "offline",
      });
    }
    setMobileTab("chat");
    await loadChats();
  }

  const closeNewChatModal = () => {
    setNewChatOpen(false);
    setNewChatUsername("");
    setNewChatResults([]);
    setNewChatSelection(null);
    setNewChatError("");
  };
  const toggleMuteChat = async (chatId) => {
    const id = normalizeUuid(chatId) || null;
    if (!id) return;
    const existing: any = chats.find((chat) => chat.id === id);
    const previousMuted: any = Boolean(existing?._muted);
    const nextMuted = !previousMuted;

    setChats((prev) =>
      prev.map((chat) =>
        chat.id === id ? { ...chat, _muted: nextMuted } : chat,
      ),
    );

    try {
      const res: any = await setChatMute(id, {
        username: user.username,
        muted: nextMuted,
      });
      const data: any = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Unable to update mute state.");
      }
      const serverMuted: any = Boolean(data?.muted);
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === id ? { ...chat, _muted: serverMuted } : chat,
        ),
      );
    } catch {
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === id ? { ...chat, _muted: previousMuted } : chat,
        ),
      );
    }
  };

  const openNewGroupModal = () => {
    const groupColor: any = getRandomAvatarColor();
    setEditingGroup(false);
    setGroupModalType("group");
    setNewGroupForm((prev) => ({
      ...prev,
      groupColor,
    }));
    setNewGroupOpen(true);
    setNewGroupError("");
  };

  const openNewChannelModal = () => {
    const groupColor: any = getRandomAvatarColor();
    setEditingGroup(false);
    setGroupModalType("channel");
    setNewGroupForm((prev) => ({
      ...prev,
      groupColor,
    }));
    setNewGroupOpen(true);
    setNewGroupError("");
  };

  const closeNewGroupModal = () => {
    setNewGroupOpen(false);
    setCreatingGroup(false);
    setEditingGroup(false);
    setGroupModalType("group");
    setNewGroupForm({
      nickname: "",
      username: "",
      groupColor: "#10b981",
      visibility: "public",
      allowMemberInvites: true,
      remoteChannelEnabled: false,
      remoteChannelProvider: appInfo?.remoteChannels?.telegramConfigured ? "telegram" : "nextdesk",
      remoteChannelSource: "",
      remoteChannelSyncMetadata: false,
      remoteChannelStreamMedia: false,
      remoteChannelStatus: null,
      remoteChannelLoading: false,
    });
    setNewGroupSearch("");
    setNewGroupSearchResults([]);
    setNewGroupMembers([]);
    if (pendingGroupAvatarFile?.previewUrl) {
      URL.revokeObjectURL(pendingGroupAvatarFile.previewUrl);
    }
    setPendingGroupAvatarFile(null);
    setGroupAvatarPreview("");
    setGroupAvatarMarkedForRemoval(false);
    setEditGroupInviteToken("");
    setRegeneratingGroupInviteLink(false);
    setNewGroupError("");
  };

  const openOwnProfileModal = () => {
    setProfileModalMember({
      id: normalizeUuid(user?.id) || user?.id || null,
      username: user?.username || "",
      nickname: user?.nickname || "",
      avatar_url: user?.avatarUrl || "",
      color: user?.color || "#10b981",
      status: user?.status || "online",
      role: user?.role || "user",
      verified: Boolean(user?.verified),
    });
    setProfileInviteLink("");
    setProfileModalOpen(true);
  };

  const openActiveChatProfile = async () => {
    if (!activeChat) return;
    setProfileModalMember(null);
    setProfileInviteLinkLoading(false);
    // Clear cached remote channel status when switching to a different chat
    setProfileRemoteChannelStatus((prev) => {
      const prevChatId = prev?._chatId;
      return prevChatId && prevChatId !== activeChat.id ? null : prev;
    });
    setProfileModalOpen(true);
    if (activeChat.type === "group" || activeChat.type === "channel") {
      // Build invite link from already-available chat data — no round-trip needed
      const localLink: any = buildInviteLinkForChat(activeChat);
      if (localLink) {
        setProfileInviteLink(localLink);
      } else {
        // Fallback: fetch from server if token is somehow missing locally
        setProfileInviteLinkLoading(true);
        try {
          const res: any = await getGroupInviteLink(activeChat.id);
          const data: any = await res.json();
          setProfileInviteLink(res.ok ? String(data?.inviteLink || "") : "");
        } catch {
          setProfileInviteLink("");
        } finally {
          setProfileInviteLinkLoading(false);
        }
      }
    } else {
      setProfileInviteLink("");
    }
  };

  const openMemberProfileFromMessage = (msg) => {
    if (!msg) return;
    const selected: any = {
      id: msg.user_id || null,
      username: msg.username || "",
      nickname: msg.nickname || "",
      avatar_url: msg.avatar_url || "",
      color: msg.color || "#10b981",
      status: "online",
      role: msg.user_role || "user",
      verified: Boolean(msg.user_verified),
    };
    setProfileModalMember(selected);
    setProfileModalOpen(true);
  };

  const openMemberProfileFromList = (member) => {
    if (!member) return;
    // Member objects from the chat list use `user_verified` (DB alias).
    // Normalize to `verified` so ChatProfileModal reads it correctly.
    const normalized = Object.prototype.hasOwnProperty.call(member, "user_verified")
      ? { ...member, verified: Boolean(member.user_verified) }
      : member;
    setProfileModalMember(normalized);
    setProfileModalOpen(true);
  };

  const openMentionProfile = (mention) => {
    if (!mention) return;
    setMentionProfile(mention);
    setProfileModalOpen(true);
  };

  const handleJoinMentionChat = async () => {
    if (!mentionProfileChat?.id) return;
    const invitePath: any = buildInvitePathForChat(mentionProfileChat);
    if (!invitePath) return;
    if (typeof window !== "undefined") {
      window.location.href = invitePath;
    }
  };

  const handleOpenProfileChat = () => {
    if (mentionProfileChat?.id) {
      setActiveChatId(mentionProfileChat.id);
      setActivePeer(null);
      setMobileTab("chat");
      closeProfileModal();
      return;
    }
    const targetForChat = profileModalMember || profileTargetUser;
    if (targetForChat?.username) {
      if (
        String(targetForChat.username).toLowerCase() ===
        String(user.username).toLowerCase()
      ) {
        closeProfileModal();
        return;
      }
      void openOrCreateDmFromMember(targetForChat);
      return;
    }
    if (!profileModalMember && activeChat?.type === "group") {
      setMobileTab("chat");
      closeProfileModal();
      return;
    }
    closeProfileModal();
  };

  const handleLeaveGroupById = async (chatId) => {
    const id = normalizeUuid(chatId) || null;
    if (!id) return;
    try {
      const res: any = await leaveGroupChat(id, { username: user.username });
      const data: any = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Unable to leave group.");
      }
      closeProfileModal();
      if (String(activeChat?.id || "") === String(id || "")) {
        closeChat();
      }
      await loadChats();
    } catch {
      // ignore
    }
  };

  const closeProfileModal = () => {
    setProfileModalOpen(false);
    setProfileModalMember(null);
    setProfileInviteLink("");
    setProfileInviteLinkLoading(false);
    setMentionProfile(null);
  };

  const handleProfileRemoteChannelStatusChange: any = useCallback((status) => {
    setProfileRemoteChannelStatus(status ? { ...status, _chatId: activeChat?.id } : null);
  }, [activeChat?.id]);

  const openSelfProfileEditor = () => {
    closeProfileModal();
    setSettingsPanel("profile");
    setMobileTab("settings");
  };

  const openSavedMessages = async () => {
    try {
      setSettingsPanel(null);
      let savedChat: any = chats.find((chat) => chat.type === "saved");
      let chatId = normalizeUuid(savedChat?.id) || null;
      if (!chatId) {
        const res: any = await getSavedMessagesChat(user.username);
        const data: any = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || "Unable to open saved messages.");
        }
        chatId = normalizeUuid(data?.id) || null;
        await loadChats({ silent: true });
      }
      if (!chatId) return;
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(OPEN_CHAT_ID_KEY, String(chatId));
      }
      setActiveChatId(chatId);
      setActivePeer(null);
      setMobileTab("chat");
      setSidebarScrollEpoch((prev) => prev + 1);
    } catch {
      // ignore
    }
  };

  const openEditGroupFromProfile = async () => {
    if (!activeChat || !["group", "channel"].includes(activeChat.type)) return;
    if (!canCurrentUserEditGroup) return;
    setEditingGroup(true);
    setGroupModalType(activeChat.type === "channel" ? "channel" : "group");
    setProfileModalOpen(false);
    setNewGroupForm({
      nickname: activeChat.name || "",
      username: activeChat.group_username || "",
      groupColor: activeChat.group_color || "#10b981",
      visibility: activeChat.group_visibility || "public",
      allowMemberInvites: Boolean(Number(activeChat.allow_member_invites || 0)),
      remoteChannelEnabled: false,
      remoteChannelProvider: appInfo?.remoteChannels?.telegramConfigured ? "telegram" : "nextdesk",
      remoteChannelSource: "",
      remoteChannelSyncMetadata: false,
      remoteChannelStreamMedia: false,
      remoteChannelStatus: null,
      remoteChannelLoading: activeChat.type === "channel" && Boolean(appInfo?.remoteChannels?.enabled && appInfo?.remoteChannels?.uiEnabled),
    });
    setNewGroupMembers([]);
    setNewGroupSearch("");
    setGroupAvatarPreview(activeChat.group_avatar_url || "");
    setGroupAvatarMarkedForRemoval(false);
    if (pendingGroupAvatarFile?.previewUrl) {
      URL.revokeObjectURL(pendingGroupAvatarFile.previewUrl);
    }
    setPendingGroupAvatarFile(null);
    setEditGroupInviteToken(
      String(activeChat.inviteToken || activeChat.invite_token || ""),
    );
    setNewGroupOpen(true);
    try {
      const res: any = await getGroupInviteLink(activeChat.id);
      const data: any = await res.json();
      if (res.ok) {
        setEditGroupInviteToken(String(data?.inviteToken || ""));
      }
    } catch {
      // ignore invite fetch errors in edit modal
    }
    if (activeChat.type === "channel" && appInfo?.remoteChannels?.enabled && appInfo?.remoteChannels?.uiEnabled) {
      try {
        const res: any = await getRemoteChannelSettings({
          chatId: activeChat.id,
          username: user.username,
        });
        const data: any = await res.json();
        if (res.ok) {
          const source = data?.source || null;
          setNewGroupForm((prev) => ({
            ...prev,
            remoteChannelEnabled: Boolean(source?.enabled),
            remoteChannelProvider: source?.provider || "nextdesk",
            remoteChannelSource:
              source?.sourceRaw ||
              (source?.sourceUsername ? `@${source.sourceUsername}` : "") ||
              source?.sourceChatId ||
              "",
            remoteChannelSyncMetadata: Boolean(source?.syncMetadata),
            remoteChannelStreamMedia:
              CHAT_PAGE_CONFIG.fileUploadEnabled &&
              Boolean(source?.streamMedia),
            remoteChannelStatus: data,
            remoteChannelLoading: false,
          }));
        } else {
          setNewGroupForm((prev) => ({
            ...prev,
            remoteChannelStatus: {
              available: false,
              source: null,
              error: data?.error || t("chat.groupErrors.remoteSettingsLoadFailed"),
            },
            remoteChannelLoading: false,
          }));
        }
      } catch {
        setNewGroupForm((prev) => ({
          ...prev,
          remoteChannelStatus: {
            available: false,
            source: null,
            error: t("chat.groupErrors.remoteSettingsLoadFailed"),
          },
          remoteChannelLoading: false,
        }));
      }
    }
  };

  const handleGroupAvatarChange = (event) => {
    const label = groupModalType === "channel"
      ? t("chat.chat.channel")
      : t("chat.chat.group");
    if (!CHAT_PAGE_CONFIG.fileUploadEnabled) {
      setNewGroupError(t("chat.errors.uploadsDisabled"));
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;
    if (!String(file.type || "").toLowerCase().startsWith("image/")) {
      setNewGroupError(t("chat.groupErrors.avatarNotImage", { label }));
      event.target.value = "";
      return;
    }
    if (Number(file.size || 0) > CHAT_PAGE_CONFIG.maxFileSizeBytes) {
      setNewGroupError(
        t("chat.groupErrors.avatarTooLarge", {
          label,
          size: formatBytesAsMb(CHAT_PAGE_CONFIG.maxFileSizeBytes),
        }),
      );
      event.target.value = "";
      return;
    }
    const previewUrl: any = URL.createObjectURL(file);
    if (pendingGroupAvatarFile?.previewUrl) {
      URL.revokeObjectURL(pendingGroupAvatarFile.previewUrl);
    }
    setPendingGroupAvatarFile({ file, previewUrl });
    setGroupAvatarPreview(previewUrl);
    setGroupAvatarMarkedForRemoval(false);
    setNewGroupError("");
    event.target.value = "";
  };

  const handleGroupAvatarRemove = () => {
    if (pendingGroupAvatarFile?.previewUrl) {
      URL.revokeObjectURL(pendingGroupAvatarFile.previewUrl);
    }
    const hadExistingAvatar: any = Boolean(
      editingGroup && String(activeChat?.group_avatar_url || "").trim(),
    );
    setPendingGroupAvatarFile(null);
    setGroupAvatarPreview("");
    setGroupAvatarMarkedForRemoval(hadExistingAvatar);
  };

  const handleRegenerateGroupInvite = async () => {
    if (!editingGroup || !activeChat?.id) return;
    try {
      setRegeneratingGroupInviteLink(true);
      const res: any = await regenerateGroupInviteLink(activeChat.id, {
        username: user.username,
      });
      const data: any = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || t("chat.groupErrors.inviteRegenerateFailed"));
      }
      const nextLink: any = String(data?.inviteLink || "");
      setEditGroupInviteToken(String(data?.inviteToken || ""));
      setProfileInviteLink(nextLink);
    } catch (err) {
      setNewGroupError(err.message || t("chat.groupErrors.inviteRegenerateFailed"));
    } finally {
      setRegeneratingGroupInviteLink(false);
    }
  };

  async function handleCreateGroup() {
    const isChannel = groupModalType === "channel";
    const label = isChannel ? t("chat.chat.channel") : t("chat.chat.group");
    const nickname: any = newGroupForm.nickname.trim();
    const username: any = newGroupForm.username.trim().toLowerCase();
    if (!nickname) {
      setNewGroupError(t("chat.groupErrors.nameRequired", { label }));
      return;
    }
    if (nickname.length > NICKNAME_MAX) {
      setNewGroupError(
        t("chat.groupErrors.nameTooLong", { label, limit: NICKNAME_MAX }),
      );
      return;
    }
    if (username.length > USERNAME_MAX) {
      setNewGroupError(
        t("chat.groupErrors.usernameTooLong", { label, limit: USERNAME_MAX }),
      );
      return;
    }
    if (username.length < 3) {
      setNewGroupError(t("chat.groupErrors.usernameTooShort", { label }));
      return;
    }
    if (!USERNAME_REGEX.test(username)) {
      setNewGroupError(t("chat.groupErrors.usernameInvalidChars", { label }));
      return;
    }
    const remoteChannelSource: any = String(
      newGroupForm.remoteChannelSource || "",
    ).trim();
    const remoteChannelEnabled =
      newGroupForm.visibility !== "private" &&
      Boolean(newGroupForm.remoteChannelEnabled);
    const remoteChannelProvider: any = String(
      newGroupForm.remoteChannelProvider || "nextdesk",
    ).toLowerCase();
    const remoteChannelSyncMetadata =
      remoteChannelEnabled && Boolean(newGroupForm.remoteChannelSyncMetadata);
    const remoteChannelMediaStreamAllowed: any = Boolean(
      appInfo?.remoteChannels?.mediaStreamEnabled,
    );
    const remoteChannelStreamMedia =
      remoteChannelEnabled &&
      CHAT_PAGE_CONFIG.fileUploadEnabled &&
      remoteChannelMediaStreamAllowed &&
      Boolean(newGroupForm.remoteChannelStreamMedia);
    // When editing, only call the remote channel API if something actually changed.
    // Compare current form values against what was loaded from the server.
    const originalRemoteChannel = editingGroup
      ? newGroupForm.remoteChannelStatus?.source || null
      : null;
    const originalEnabled: any =
      Boolean(originalRemoteChannel?.enabled);
    const originalProvider: any = String(originalRemoteChannel?.provider || "telegram").toLowerCase();
    const originalSource =
      originalRemoteChannel?.sourceRaw ||
      (originalRemoteChannel?.sourceUsername
        ? `@${originalRemoteChannel.sourceUsername}`
        : "") ||
      originalRemoteChannel?.sourceChatId ||
      "";
    const originalSyncMetadata: any = Boolean(originalRemoteChannel?.syncMetadata);
    const originalStreamMedia =
      CHAT_PAGE_CONFIG.fileUploadEnabled &&
      Boolean(originalRemoteChannel?.streamMedia);
    const remoteChannelChanged =
      remoteChannelEnabled !== originalEnabled ||
      remoteChannelProvider !== originalProvider ||
      remoteChannelSource !== originalSource ||
      remoteChannelSyncMetadata !== originalSyncMetadata ||
      remoteChannelStreamMedia !== originalStreamMedia;

    const shouldSaveRemoteChannel: any = Boolean(
      isChannel &&
        appInfo?.remoteChannels?.enabled &&
        appInfo?.remoteChannels?.uiEnabled &&
        (editingGroup
          ? remoteChannelChanged
          : remoteChannelEnabled ||
            remoteChannelSource ||
            remoteChannelSyncMetadata ||
            remoteChannelStreamMedia),
    );
    if (shouldSaveRemoteChannel && remoteChannelEnabled && !remoteChannelSource) {
      setNewGroupError(t("chat.groupErrors.remoteSourceRequired"));
      return;
    }
    try {
      setCreatingGroup(true);
      setNewGroupError("");
      const payload: any = {
        creator: user.username,
        nickname,
        username,
        groupColor: newGroupForm.groupColor || "#10b981",
        visibility: newGroupForm.visibility,
        allowMemberInvites:
          newGroupForm.visibility !== "private" ||
          newGroupForm.allowMemberInvites !== false,
        members: editingGroup
          ? Array.from(
              new Set([
                ...((activeChat?.members || [])
                  .map((member) => String(member?.username || "").toLowerCase())
                  .filter(
                    (memberUsername) =>
                      memberUsername &&
                      memberUsername !== String(user.username || "").toLowerCase(),
                  )),
                ...newGroupMembers
                  .map((member) => String(member?.username || "").toLowerCase())
                  .filter(Boolean),
              ]),
            )
          : newGroupMembers.map((member) => member.username),
      };
      if (!editingGroup && shouldSaveRemoteChannel) {
        payload.remoteChannel = {
          enabled: remoteChannelEnabled,
          provider: remoteChannelProvider,
          source: remoteChannelSource,
          syncMetadata: remoteChannelSyncMetadata,
          streamMedia: remoteChannelStreamMedia,
        };
      }
      const res = editingGroup && activeChat?.id
        ? await (isChannel ? updateChannelChat : updateGroupChat)(activeChat.id, {
            username: user.username,
            nickname: payload.nickname,
            groupUsername: payload.username,
            visibility: payload.visibility,
            allowMemberInvites: payload.allowMemberInvites,
            members: payload.members,
          })
        : await (isChannel ? createChannelChat : createGroupChat)(payload);
      const data: any = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || t("chat.groupErrors.createFailed"));
      }
      const nextChatId = normalizeUuid(data?.id) || normalizeUuid(activeChat?.id) || null;
      if (!nextChatId) {
        throw new Error(t("chat.groupErrors.noGroupId"));
      }
      if (pendingGroupAvatarFile?.file) {
        const s3Upload: any = await uploadAvatarFile(pendingGroupAvatarFile.file);
        let avatarRes;
        if (s3Upload.directS3 && s3Upload.avatarUrl) {
          avatarRes = await uploadGroupAvatar(nextChatId, {
            username: user.username,
            avatarUrl: s3Upload.avatarUrl,
          });
        } else {
          const form: any = new FormData();
          form.append("username", user.username);
          form.append("avatar", pendingGroupAvatarFile.file);
          avatarRes = await uploadGroupAvatar(nextChatId, form);
        }
        const avatarData: any = await avatarRes.json();
        if (!avatarRes.ok) {
          throw new Error(
            avatarData?.error ||
              t("chat.groupErrors.avatarUploadFailed", { label: label.toLowerCase() }),
          );
        }
      } else if (editingGroup && groupAvatarMarkedForRemoval) {
        const avatarRes: any = await removeGroupAvatar(nextChatId, {
          username: user.username,
        });
        const avatarData: any = await avatarRes.json();
        if (!avatarRes.ok) {
          throw new Error(avatarData?.error || t("chat.groupErrors.avatarRemoveFailed"));
        }
      }
      if (shouldSaveRemoteChannel && editingGroup) {
        const remoteRes: any = await updateRemoteChannelSettings(nextChatId, {
          username: user.username,
          enabled: remoteChannelEnabled,
          provider: remoteChannelProvider,
          source: remoteChannelSource,
          syncMetadata: remoteChannelSyncMetadata,
          streamMedia: remoteChannelStreamMedia,
        });
        const remoteData: any = await remoteRes.json();
        if (!remoteRes.ok) {
          throw new Error(remoteData?.error || t("chat.groupErrors.remoteUpdateFailed"));
        }
      }
      if (!editingGroup) {
        setCreatedGroupInviteLink(String(data?.inviteLink || ""));
        setCreatedGroupInviteType(isChannel ? "channel" : "group");
        setGroupInviteOpen(Boolean(data?.inviteLink));
      }
      closeNewGroupModal();
      setEditingGroup(false);
      await loadChats();
      if (editingGroup) {
        setSidebarScrollEpoch((prev) => prev + 1);
      }
      setActiveChatId(nextChatId);
      setActivePeer(null);
      setMobileTab("chat");
    } catch (err) {
      setNewGroupError(err.message);
    } finally {
      setCreatingGroup(false);
    }
  }

  async function openOrCreateDmFromMember(member) {
    const targetUsername: any = String(member?.username || "").toLowerCase();
    if (!targetUsername) return;
    if (targetUsername === String(user.username || "").toLowerCase()) return;
    try {
      const existingDm: any = chats.find((chat) => {
        if (chat?.type !== "dm") return false;
        return (chat.members || []).some(
          (chatMember) =>
            String(chatMember?.username || "").toLowerCase() === targetUsername,
        );
      });
      let nextChatId = normalizeUuid(existingDm?.id) || null;
      if (!nextChatId) {
        const res: any = await createDmChat({ from: user.username, to: targetUsername });
        const data: any = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || t("chat.profileErrors.dmOpenFailed"));
        }
        nextChatId = normalizeUuid(data?.id) || null;
      }

      if (!nextChatId) {
        throw new Error(t("chat.profileErrors.dmResolveFailed"));
      }

      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(OPEN_CHAT_ID_KEY, String(nextChatId));
      }
      setActiveChatId(nextChatId);
      setMobileTab("chat");
      closeProfileModal();
      await loadChats({ silent: true });

      const refreshedDm: any = chats.find((chat) => chat.id === nextChatId);
      const nextPeer: any = (refreshedDm?.members || []).find(
        (chatMember) =>
          String(chatMember?.username || "").toLowerCase() === targetUsername,
      );
      setActivePeer(nextPeer || member || null);
    } catch (err) {
      setProfileError(err.message || t("chat.profileErrors.dmOpenFailed"));
    }
  }

  async function openDiscoverUser(member) {
    if (!member) return;
    await openOrCreateDmFromMember(member);
    setSidebarScrollEpoch((prev) => prev + 1);
  }

  async function openDiscoverGroup(group) {
    const chatId = normalizeUuid(group?.id) || null;
    const invitePath: any = buildInvitePathForChat(group);
    const alreadyMember =
      group?.isMember === true ||
      group?.isMember === 1 ||
      String(group?.isMember || "").toLowerCase() === "true";
    if (alreadyMember && chatId) {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(OPEN_CHAT_ID_KEY, String(chatId));
      }
      await loadChats({ silent: true });
      setActiveChatId(chatId);
      setActivePeer(null);
      setMobileTab("chat");
      setSidebarScrollEpoch((prev) => prev + 1);
      return;
    }
    if (!invitePath) return;
    try {
      if (typeof window !== "undefined") {
        window.history.pushState({}, "", invitePath);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    } catch (err) {
      setNewChatError(err.message || t("chat.errors.openGroupFailed"));
    }
  }

  async function handleRemoveGroupMember(member) {
    if (!activeChat || !["group", "channel"].includes(activeChat.type) || !member?.username)
      return;
    try {
      const res: any = await removeGroupMember(activeChat.id, {
        username: user.username,
        targetUsername: member.username,
      });
      const data: any = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Unable to remove member.");
      }
      await loadChats({ silent: true });
    } catch {
      // ignore
    }
  }

  const isOffline =
    !sseConnected ||
    (typeof navigator !== "undefined" && navigator.onLine === false);

  const { contextMenu, closeContextMenu, openContextMenu } = useAppContextMenu({
    activeChatId,
    chats,
    currentUsername: user?.username,
    canCurrentUserEditGroup,
    canReplyToMessage: canSendInActiveChat,
    canEditMessage: canEditMessageFromContext,
    canDeleteMessage: isModeratorUser,
    canDeleteMessageForEveryone,
    canDeleteChat: canDeleteChatFromContext,
    onReplyToMessage: handleStartReply,
    onEditMessage: handleStartEdit,
    onDeleteMessage: handleDeleteMessageRequest,
    onForwardMessage: handleOpenForwardModal,
    onSaveMessageFiles: handleSaveMessageFiles,
    onOpenOrCreateDm: openOrCreateDmFromMember,
    onOpenProfile: openMemberProfileFromList,
    onRemoveGroupMember: handleRemoveGroupMember,
    onMarkChatSeen: handleMarkChatSeen,
    onToggleChatMute: toggleMuteChat,
    onDeleteChats: requestDeleteChats,
    isOffline,
    sseConnected,
  });

  useEffect(() => {
    if (!contextMenu) return;
    if (
      contextMenu.kind === "message" &&
      String(contextMenu.targetChatId || "") !== String(activeChatId || "")
    ) {
      closeContextMenu();
      return;
    }
    if (contextMenu.kind !== "message" || !contextMenu.targetMessageKey) return;
    const targetStillExists: any = messages.some(
      (message) => getMessageContextKey(message) === contextMenu.targetMessageKey,
    );
    if (!targetStillExists) {
      closeContextMenu();
    }
  }, [activeChatId, closeContextMenu, contextMenu, messages]);

  async function handleDeleteAccount(password) {
    if (!user?.username) return;
    const trimmed: any = String(password || "").trim();
    if (!trimmed) {
      throw new Error(t("chat.securityErrors.passwordRequired"));
    }
    const res: any = await deleteAccount({ username: user.username, password: trimmed });
    const data: any = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || t("chat.securityErrors.deleteAccountFailed"));
    }
    setSettingsPanel(null);
    handleLogout();
  }

  async function handleDeleteActiveGroup(password) {
    if (!activeChat || !["group", "channel"].includes(activeChat.type)) return;
    const trimmed: any = String(password || "").trim();
    if (!trimmed) {
      throw new Error(t("chat.securityErrors.passwordRequired"));
    }
    const res: any = await deleteGroupChat(activeChat.id, {
      username: user.username,
      password: trimmed,
    });
    const data: any = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || t("chat.groupErrors.deleteChatFailed"));
    }
    closeProfileModal();
    closeNewGroupModal();
    closeChat();
    await loadChats();
  }

  const handleStartReached = async () => {
    // FIXED: Pagination should work on mobile too!
    // The scroll threshold detection in ChatWindowPanel works fine on mobile.
    // This function just needed to actually execute on mobile instead of returning early.
    if (!activeChatId || loadingMessages || loadingOlderMessages || !hasOlderMessages) return;
    if (!allowStartReachedRef.current) return;
    const oldestMessage = messages[0];
    const oldestId = oldestMessage?.id || null;
    const oldestCreatedAt = oldestMessage?.created_at || "";
    if (!oldestId || !oldestCreatedAt) return;
    const scroller = chatScrollRef.current;
    let anchorId = "";
    let anchorOffset = 0;
    if (scroller) {
      const scrollerTop = scroller.getBoundingClientRect().top;
      const messageNodes: any = Array.from(
        scroller.querySelectorAll("[id^='message-']"),
      );
      const firstVisible: any = messageNodes.find(
        (node) => node.getBoundingClientRect().bottom > scrollerTop + 1,
      );
      const anchorNode = firstVisible || messageNodes[0];
      if (anchorNode) {
        anchorId = anchorNode.id;
        anchorOffset = anchorNode.getBoundingClientRect().top - scrollerTop;
      }
    }
    setLoadingOlderMessages(true);
    try {
      await loadMessages(activeChatId, {
        silent: true,
        prepend: true,
        beforeId: oldestId,
        beforeCreatedAt: oldestCreatedAt,
        limit: CHAT_PAGE_CONFIG.messagePageSize,
      });
      requestAnimationFrame(() => {
        if (!scroller || !anchorId) return;
        const sameNode: any = document.getElementById(anchorId);
        if (!sameNode) return;
        const scrollerTop = scroller.getBoundingClientRect().top;
        const nextOffset = sameNode.getBoundingClientRect().top - scrollerTop;
        scroller.scrollTop += nextOffset - anchorOffset;
      });
    } finally {
      setLoadingOlderMessages(false);
    }
  };

  const exitSearchMode = () => {
    setChatsSearchFocused(false);
    setChatsSearchQuery("");
    setSidebarScrollEpoch((prev) => prev + 1);
    if (typeof document !== "undefined") {
      const activeEl = document.activeElement;
      if (activeEl && typeof activeEl.blur === "function") {
        activeEl.blur();
      }
    }
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 0);
    }
  };
  const handleUserScrollIntent = () => {
    cancelSmoothScroll?.();
    allowStartReachedRef.current = true;
    const scroller = chatScrollRef.current;
    if (!scroller) return;
    const distanceFromBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distanceFromBottom <= 24) return;
    pendingScrollToBottomRef.current = false;
    pendingScrollToUnreadRef.current = null;
    unreadAnchorLockUntilRef.current = 0;
    if (!userScrolledUpRef.current) {
      userScrolledUpRef.current = true;
      setUserScrolledUp(true);
    }
    if (isAtBottomRef.current) {
      isAtBottomRef.current = false;
      setIsAtBottom(false);
    }
  };
  const handleFloatingDayNavigate: any = useCallback(() => {
    cancelSmoothScroll?.();
    allowStartReachedRef.current = true;
    pendingScrollToBottomRef.current = false;
    pendingScrollToUnreadRef.current = null;
    unreadAnchorLockUntilRef.current = 0;
    userScrolledUpRef.current = true;
    setUserScrolledUp(true);
    isAtBottomRef.current = false;
    setIsAtBottom(false);
  }, [
    cancelSmoothScroll,
    isAtBottomRef,
    pendingScrollToBottomRef,
    pendingScrollToUnreadRef,
    unreadAnchorLockUntilRef,
    setIsAtBottom,
    setUserScrolledUp,
    userScrolledUpRef,
  ]);
  const shouldPromptNotifications =
    notificationsSupported &&
    notificationPermission === "default" &&
    !permissionsDismissed.notification;
  const shouldPromptMicrophone =
    microphonePermissionSupported &&
    microphonePermission === "prompt" &&
    !permissionsDismissed.microphone;
  const permissionPromptDelayActive =
    permissionPromptDelayUntil > Date.now();
  const activePermissionPrompt = shouldPromptNotifications
    ? "notification"
    : shouldPromptMicrophone
      ? "microphone"
      : null;
  const showPermissionsPrompt: any = Boolean(
    activePermissionPrompt && !permissionPromptDelayActive,
  );
  const displayedGroupInviteToken =
    editingGroup
      ? editGroupInviteToken ||
        String(activeChat?.inviteToken || activeChat?.invite_token || "")
      : "";
  const displayedGroupInviteLink: any = buildInviteLinkForChat({
    group_username: newGroupForm.username,
    group_visibility: newGroupForm.visibility,
    inviteToken: displayedGroupInviteToken,
    invite_token: displayedGroupInviteToken,
  });
  const showGroupInviteManagement: any = Boolean(editingGroup);

  useEffect(() => {
    if (!permissionPromptDelayUntil) return undefined;
    const remainingMs = permissionPromptDelayUntil - Date.now();
    if (remainingMs <= 0) {
      setPermissionPromptDelayUntil(0);
      return undefined;
    }
    const timer: any = window.setTimeout(() => {
      setPermissionPromptDelayUntil(0);
    }, remainingMs);
    return () => window.clearTimeout(timer);
  }, [permissionPromptDelayUntil]);

  useEffect(() => {
    setPermissionsDismissed({
      notification: readPermissionDismissed("notification"),
      microphone: readPermissionDismissed("microphone"),
    });
  }, [isAppActive, notificationPermission, microphonePermission]);

  useOverlayBack(
    Boolean(chatsSearchFocused || String(chatsSearchQuery || "").trim()),
    exitSearchMode,
    "sbSearchMode",
  );
  useOverlayBack(Boolean(editMode), handleExitEdit, "sbEditMode");
  useOverlayBack(mobileTab === "calls", () => setMobileTab("chats"), "sbTabCalls");
  useOverlayBack(
    mobileTab === "settings",
    () => setMobileTab("chats"),
    "sbTabSettings",
  );
  useOverlayBack(
    Boolean(settingsPanel),
    () => setSettingsPanel(null),
    "sbSettingsPanel",
  );
  useOverlayBack(Boolean(newChatOpen), closeNewChatModal, "sbNewChatModal");
  useOverlayBack(Boolean(supportOpen), closeSupportModal, "sbSupportModal");
  useOverlayBack(
    Boolean(newGroupOpen),
    closeNewGroupModal,
    "sbNewGroupModal",
  );
  useOverlayBack(
    Boolean(confirmDeleteOpen),
    () => setConfirmDeleteOpen(false),
    "sbDeleteChatsModal",
  );
  useOverlayBack(
    Boolean(confirmDeleteCallOpen),
    () => setConfirmDeleteCallOpen(false),
    "sbDeleteCallsModal",
  );
  useOverlayBack(
    Boolean(newCallOpen),
    () => setNewCallOpen(false),
    "sbNewCallModal",
  );
  useOverlayBack(
    Boolean(messageDeleteScopeOpen),
    () => {
      setMessageDeleteScopeOpen(false);
      setPendingDeleteMessage(null);
    },
    "sbDeleteScopeModal",
  );
  useOverlayBack(
    Boolean(forwardMessageTarget),
    () => {
      setForwardMessageTarget(null);
      setForwardSavedChat(null);
    },
    "sbForwardModal",
  );
  useOverlayBack(
    Boolean(confirmLeaveOpen),
    () => {
      setConfirmLeaveOpen(false);
      setPendingLeaveChatId(null);
    },
    "sbLeaveGroupModal",
  );
  useOverlayBack(
    Boolean(groupInviteOpen),
    () => {
      setGroupInviteOpen(false);
      setCreatedGroupInviteType("group");
    },
    "sbGroupInviteModal",
  );
  const [chatFilesModalOpen, setChatFilesModalOpen] = useState(false);
  const [chatSearchModalOpen, setChatSearchModalOpen] = useState(false);

  const handleJumpToMessageInActiveChat = useCallback((messageId: any) => {
    if (!messageId) return;
    window.setTimeout(() => {
      const target: any = document.getElementById(`message-${messageId}`);
      if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      const bubble: any = target?.querySelector?.("[data-message-bubble]");
      if (!bubble) return;
      bubble.classList.remove("reply-flash");
      void bubble.offsetWidth;
      bubble.classList.add("reply-flash");
      window.setTimeout(() => {
        bubble.classList.remove("reply-flash");
      }, 700);
    }, 60);
  }, []);

  useOverlayBack(
    Boolean(profileModalOpen),
    closeProfileModal,
    "sbChatProfileModal",
  );
  useOverlayBack(
    Boolean(chatFilesModalOpen),
    () => setChatFilesModalOpen(false),
    "sbChatFilesModal",
  );
  useOverlayBack(
    Boolean(chatSearchModalOpen),
    () => setChatSearchModalOpen(false),
    "sbChatSearchModal",
  );
  useOverlayBack(
    Boolean(notificationsModalOpen),
    () => setNotificationsModalOpen(false),
    "sbNotificationsModal",
  );
  useOverlayBack(
    Boolean(whatsNewOpen),
    () => dismissWhatsNew(true),
    "sbWhatsNewModal",
  );

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden md:flex-row md:gap-0"
      style={{
        height: "100%",
        paddingTop: "max(0px, env(safe-area-inset-top))",
        paddingLeft: "max(0px, env(safe-area-inset-left))",
        paddingRight: "max(0px, env(safe-area-inset-right))",
      }}
    >
      <ChatSidebar
        mobileTab={mobileTab}
        isConnected={isConnected}
        isUpdating={isUpdatingChats}
        scrollEpoch={sidebarScrollEpoch}
        chatsScrollToTopEpoch={chatsScrollToTopEpoch}
        editMode={editMode}
        visibleChats={visibleChats}
        selectedChats={selectedChats}
        loadingChats={loadingChats}
        activeChatId={activeChatId}
        user={user}
        calls={calls}
        loadingCalls={loadingCalls}
        callsEditMode={callsEditMode}
        selectedCalls={selectedCalls}
        toggleSelectCall={toggleSelectCall}
        onEnterCallsEditMode={() => {
          if (!calls.length) return;
          setCallsEditMode(true);
        }}
        onExitCallsEditMode={() => {
          setCallsEditMode(false);
          setSelectedCalls([]);
        }}
        onDeleteCall={requestDeleteCall}
        onDeleteSelectedCalls={handleDeleteCalls}
        onOpenNewCall={handleOpenNewCall}
        onStartCall={handleStartCallFromRow}
        callsDisabled={!CHAT_PAGE_CONFIG.callsEnabled}
        isInCall={callState !== "idle"}
        formatChatTimestamp={formatChatCardTimestamp}
        requestDeleteChats={requestDeleteChats}
        toggleSelectChat={toggleSelectChat}
        setActiveChatId={setActiveChatId}
        setActivePeer={setActivePeer}
        setMobileTab={setMobileTab}
        setIsAtBottom={setIsAtBottom}
        setUnreadInChat={setUnreadInChat}
        lastMessageIdRef={lastMessageIdRef}
        isAtBottomRef={isAtBottomRef}
        onOpenNewChat={() => setNewChatOpen(true)}
        onOpenNewSupport={() => setSupportOpen(true)}
        onOpenNewGroup={openNewGroupModal}
        onOpenNewChannel={openNewChannelModal}
        chatsSearchQuery={chatsSearchQuery}
        onChatsSearchChange={setChatsSearchQuery}
        onChatsSearchFocus={() => {
          if (editMode) {
            handleExitEdit();
          }
          setChatsSearchFocused(true);
        }}
        onChatsSearchBlur={() => {}}
        chatsSearchFocused={chatsSearchFocused}
        onCloseSearch={exitSearchMode}
        discoverLoading={discoverLoading}
        discoverUsers={discoverUsers}
        discoverGroups={discoverGroups}
        discoverChannels={discoverChannels}
        discoverSaved={discoverSaved}
        isSavedChatActive={isActiveSavedChat}
        onOpenDiscoveredUser={openDiscoverUser}
        onOpenDiscoveredGroup={openDiscoverGroup}
        onOpenUserProfileContext={openMemberProfileFromList}
        onOpenUserContextMenu={openContextMenu}
        onOpenChatContextMenu={openContextMenu}
        setSettingsPanel={setSettingsPanel}
        toggleTheme={toggleTheme}
        setIsDark={setIsDark}
        isDark={isDark}
        handleLogout={handleLogout}
        settingsPanel={settingsPanel}
        displayName={displayName}
        statusTextClass={statusTextClass}
        statusValue={statusValue}
        handleProfileSave={handleProfileSave}
        avatarPreview={avatarPreview}
        profileForm={profileForm}
        handleAvatarChange={handleAvatarChange}
        handleAvatarRemove={handleAvatarRemove}
        setProfileForm={setProfileForm}
        statusSelection={statusSelection}
        setStatusSelection={setStatusSelection}
        handlePasswordSave={handlePasswordSave}
        passwordForm={passwordForm}
        setPasswordForm={setPasswordForm}
        userColor={userColor}
        profileError={profileError}
        passwordError={passwordError}
        fileUploadEnabled={CHAT_PAGE_CONFIG.fileUploadEnabled}
        notificationsSupported={notificationsSupported}
        notificationPermission={notificationPermission}
        notificationsEnabled={notificationsEnabled}
        notificationsDisabled={notificationsDisabled}
        notificationStatusLabel={notificationStatusLabel}
        onToggleNotifications={handleToggleNotifications}
        onOpenNotifications={() => setNotificationsModalOpen(true)}
        messagePreviewEnabled={messagePreviewEnabled}
        onToggleMessagePreview={handleToggleMessagePreview}
        notificationsDebugLine={notificationsDebugLine}
        onOpenSavedMessages={openSavedMessages}
        onClearCache={handleClearCache}
        dataCacheStats={dataCacheStats}
        onDeleteAccount={handleDeleteAccount}
        appInfo={appInfo}
        appInfoLoading={appInfoLoading}
        appInfoError={appInfoError}
        onExitEdit={handleExitEdit}
        onEnterEdit={handleEnterEdit}
        onDeleteChats={handleDeleteChats}
        onOpenOwnProfile={openOwnProfileModal}
        displayInitials={displayInitials}
        onOpenWhatsNew={handleOpenWhatsNew}
        adminPanelEnabled={adminPanelEnabled}
        permissionsPrompt={{
          show: showPermissionsPrompt,
          mode: activePermissionPrompt,
          notification: {
            show: shouldPromptNotifications,
            status: notificationPermission,
            onRequest: requestNotificationsPermission,
          },
          microphone: {
            show: shouldPromptMicrophone,
            status: microphonePermission,
            onRequest: requestMicrophonePermission,
          },
          onDismiss: (mode) =>
            dismissPermissionsPrompt(mode || activePermissionPrompt),
        }}
        insecureConnection={
          typeof window !== "undefined" && window.location.protocol !== "https:"
        }
      />

      <ChatWindowPanel
        mobileTab={mobileTab}
        isOffline={isOffline}
        sseConnected={sseConnected}
        activeChatId={activeChatId}
        activeChat={activeChat}
        closeChat={closeChat}
        activeHeaderPeer={activeHeaderAvatar}
        activeFallbackTitle={activeFallbackTitle}
        peerStatusLabel={resolvedHeaderSubtitle}
        typingIndicator={typingIndicator}
        isGroupChat={isActiveGroupChat}
        isChannelChat={isActiveChannelChat}
        isSavedChat={isActiveSavedChat}
        groupAvatarColor={activeGroupAvatarColor}
        groupAvatarUrl={activeGroupAvatarUrl}
        channelSeenCounts={channelSeenCounts}
        chatScrollRef={chatScrollRef}
        composerInputRef={composerInputRef}
        smoothScrollLockRef={smoothScrollLockRef}
        isAtBottomRef={isAtBottomRef}
        onChatScroll={handleChatScrollWithSeen}
        onStartReached={handleStartReached}
        messages={messages}
        user={user}
        formatTime={formatTime}
        unreadMarkerId={unreadMarkerId}
        loadingMessages={loadingMessages}
        loadingOlderMessages={loadingOlderMessages}
        hasOlderMessages={hasOlderMessages}
        handleSend={handleSend}
        userScrolledUp={userScrolledUp}
        isAtBottom={isAtBottom}
        unreadInChat={unreadInChat}
        onJumpToLatest={handleJumpToLatest}
        isConnected={isConnected}
        isDark={isDark}
        pendingUploadFiles={pendingUploadFiles}
        pendingUploadType={pendingUploadType}
        pendingVoiceMessage={pendingVoiceMessage}
        uploadError={uploadError}
        activeUploadProgress={activeUploadProgress}
        messageMaxChars={messageMaxChars}
        onMessageMediaLoaded={handleMessageMediaLoaded}
        onUploadFilesSelected={handleUploadFilesSelected}
        onRemovePendingUpload={removePendingUpload}
        onClearPendingUploads={clearPendingUploads}
        onVoiceRecorded={handleVoiceRecorded}
        onClearPendingVoiceMessage={clearPendingVoiceMessage}
        onMessageInput={handleMessageInput}
        replyTarget={replyTarget}
        onClearReply={handleClearReply}
        editTarget={editTarget}
        onClearEdit={handleClearEdit}
        onReplyToMessage={handleStartReply}
        onOpenHeaderProfile={openActiveChatProfile}
        onOpenMessageSenderProfile={openMemberProfileFromMessage}
        onOpenMention={openMentionProfile}
        onOpenForwardOrigin={handleOpenForwardOrigin}
        forwardedChatsById={forwardedChatsById}
        forwardedChatStatusById={forwardedChatStatusById}
        forwardedUsersById={forwardedUsersById}
        forwardedUserStatusByKey={forwardedUserStatusByKey}
        onForwardMessage={handleOpenForwardModal}
        onOpenContextMenu={openContextMenu}
        onUserScrollIntent={handleUserScrollIntent}
        onFloatingDayNavigate={handleFloatingDayNavigate}
        canSwipeReply={canSwipeReply}
        fileUploadEnabled={CHAT_PAGE_CONFIG.fileUploadEnabled}
        fileUploadInProgress={fileUploadInProgress || activeUploadProgress !== null}
        showComposer={canSendInActiveChat}
        isChannelMuted={activeChatMuted}
        onToggleChannelMute={() => toggleMuteChat(activeChat?.id)}
        headerClickable={!isActiveSavedChat}
        showStatus={!isActiveSavedChat}
        headerAvatarIcon={activeHeaderAvatarIcon}
        headerAvatarColor={headerAvatarColor}
        mentionRefreshToken={mentionRefreshToken}
        copyToastVisible={copyToastVisible}
        microphonePermissionStatus={microphonePermission}
        onRequestMicrophonePermission={requestMicrophonePermission}
        registerMessageRef={registerMessageRef}
        onStartVoiceCall={handleStartVoiceCall}
        onStartVideoCall={handleStartVideoCall}
        callsDisabled={!CHAT_PAGE_CONFIG.callsEnabled}
        videoCallsDisabled={!CHAT_PAGE_CONFIG.videoCallsEnabled}
        isInCall={callState !== "idle"}
        isDmChat={!isActiveGroupChat && !isActiveChannelChat && !isActiveSavedChat}
        permissionsPrompt={{
          show: showPermissionsPrompt,
          mode: activePermissionPrompt,
          notification: {
            show: shouldPromptNotifications,
            status: notificationPermission,
            onRequest: requestNotificationsPermission,
          },
          microphone: {
            show: shouldPromptMicrophone,
            status: microphonePermission,
            onRequest: requestMicrophonePermission,
          },
          onDismiss: (mode) =>
            dismissPermissionsPrompt(mode || activePermissionPrompt),
        }}
        showFloatingLabel={showFloatingLabel}
      />

      {callState !== "idle" ? (
        <CallScreen
          callState={callState}
          callEndReason={callEndReason}
          callFailureDetail={callFailureDetail}
          isCallClosing={isCallClosing}
          callType={callType}
          callPeer={resolvedCallPeer}
          callDuration={callDuration}
          callQuality={callQuality}
          isMuted={isMuted}
          isCameraOff={isCameraOff}
          cameraUnavailable={
            isCameraUnavailable ||
            !CHAT_PAGE_CONFIG.callsEnabled ||
            !CHAT_PAGE_CONFIG.videoCallsEnabled
          }
          isRemoteCameraOff={isRemoteCameraOff}
          isSpeakerOn={isSpeakerOn}
          isScreenSharing={isScreenSharing}
          isRemoteScreenSharing={isRemoteScreenSharing}
          isScreenAudioMuted={isScreenAudioMuted}
          screenAudioRef={screenAudioRef}
          screenAudioStreamRef={screenAudioStreamRef}
          screenShareSupported={screenShareSupported}
          canFlipCamera={canFlipCamera}
          onFlipCamera={flipCamera}
          localVideoRef={localVideoRef}
          remoteVideoRef={remoteVideoRef}
          remoteAudioRef={remoteAudioRef}
          onAccept={acceptCall}
          onReject={rejectCall}
          onEnd={endCall}
          onToggleMute={toggleMute}
          onToggleCamera={toggleCamera}
          onToggleSpeaker={toggleSpeaker}
          onToggleScreenShare={toggleScreenShare}
          onToggleScreenAudio={toggleScreenAudio}
        />
      ) : null}

      <MobileTabMenu
        hidden={
          Boolean(
            (mobileTab === "chat" && activeChatId) ||
              (mobileTab === "chats" &&
                (chatsSearchFocused || String(chatsSearchQuery || "").trim())),
          )
        }
        mobileTab={mobileTab}
        onChats={() => {
          if (mobileTab === "chats") {
            setChatsScrollToTopEpoch((prev) => prev + 1);
          } else {
            setMobileTab("chats");
            setSettingsPanel(null);
          }
        }}
        onCalls={() => {
          if (mobileTab !== "calls") {
            setMobileTab("calls");
            setSettingsPanel(null);
          }
        }}
        onSettings={() => setMobileTab("settings")}
      />

      {supportOpen ? (
        <Suspense fallback={null}>
          <SupportRequestModal
            open={supportOpen}
            username={user?.username}
            onClose={closeSupportModal}
            onCreated={handleSupportCreated}
          />
        </Suspense>
      ) : null}

      {newChatOpen ? (
        <Suspense fallback={null}>
          <NewChatModal
            open={newChatOpen}
            newChatUsername={newChatUsername}
            setNewChatUsername={setNewChatUsername}
            newChatError={newChatError}
            setNewChatError={setNewChatError}
            newChatResults={newChatResults}
            newChatSelection={newChatSelection}
            setNewChatSelection={setNewChatSelection}
            newChatLoading={newChatLoading}
            canStartChat={canStartChat}
            startDirectMessage={startDirectMessage}
            onClose={closeNewChatModal}
          />
        </Suspense>
      ) : null}

      {confirmDeleteOpen ? (
        <Suspense fallback={null}>
          <DeleteChatsModal
            open={confirmDeleteOpen}
            pendingDeleteIds={pendingDeleteIds}
            selectedChats={selectedChats}
            setConfirmDeleteOpen={setConfirmDeleteOpen}
            confirmDeleteChats={confirmDeleteChats}
          />
        </Suspense>
      ) : null}

      {confirmDeleteCallOpen ? (
        <Suspense fallback={null}>
          <DeleteChatsModal
            open={confirmDeleteCallOpen}
            title={t("chat.confirm.deleteCallsTitle")}
            pendingDeleteIds={pendingDeleteCallIds}
            selectedChats={[]}
            setConfirmDeleteOpen={setConfirmDeleteCallOpen}
            confirmDeleteChats={confirmDeleteCall}
          />
        </Suspense>
      ) : null}

      {newCallOpen ? (
        <Suspense fallback={null}>
          <NewCallModal
            open={newCallOpen}
            chats={chats}
            currentUser={user}
            onClose={() => setNewCallOpen(false)}
            onSubmit={handleNewCallSubmit}
          />
        </Suspense>
      ) : null}

      {messageDeleteScopeOpen ? (
        <Suspense fallback={null}>
          <DeleteMessageScopeModal
            open={messageDeleteScopeOpen}
            allowDeleteForEveryone={canDeleteMessageForEveryone(
              pendingDeleteMessage,
            )}
            isOffline={isOffline}
            sseConnected={sseConnected}
            onClose={() => {
              setMessageDeleteScopeOpen(false);
              setPendingDeleteMessage(null);
            }}
            onConfirm={(deleteForEveryone) =>
              performDeleteMessage(
                pendingDeleteMessage,
                deleteForEveryone ? "everyone" : "self",
              )
            }
          />
        </Suspense>
      ) : null}

      {forwardMessageTarget ? (
        <Suspense fallback={null}>
          <ForwardMessageModal
            open={Boolean(forwardMessageTarget)}
            chats={chats}
            savedChat={forwardSavedChat}
            currentUser={user}
            sourceChatId={activeChatId}
            onClose={() => {
              setForwardMessageTarget(null);
              setForwardSavedChat(null);
            }}
            onSubmit={handleForwardMessageSubmit}
          />
        </Suspense>
      ) : null}

      {confirmLeaveOpen ? (
        <Suspense fallback={null}>
          <LeaveGroupModal
            open={confirmLeaveOpen}
            onClose={() => {
              setConfirmLeaveOpen(false);
              setPendingLeaveChatId(null);
            }}
            onConfirm={confirmLeaveGroupById}
            isChannel={(() => {
              const leaveId: any = String(pendingLeaveChatId || "");
              if (!leaveId) return false;
              return chats.some(
                (chat) => String(chat.id) === leaveId && chat.type === "channel",
              );
            })()}
          />
        </Suspense>
      ) : null}

      {newGroupOpen ? (
        <Suspense fallback={null}>
          <NewGroupModal
            open={newGroupOpen}
            groupForm={newGroupForm}
            setGroupForm={setNewGroupForm}
            groupSearchQuery={newGroupSearch}
            setGroupSearchQuery={setNewGroupSearch}
            groupSearchResults={newGroupSearchResults}
            groupSearchLoading={newGroupSearchLoading}
            selectedGroupMembers={newGroupMembers}
            setSelectedGroupMembers={setNewGroupMembers}
            groupError={newGroupError}
            setGroupError={setNewGroupError}
            creatingGroup={creatingGroup}
            onCreate={handleCreateGroup}
            onClose={closeNewGroupModal}
            title={editingGroup
              ? (groupModalType === "channel"
                  ? t("chat.groupModal.editChannel")
                  : t("chat.groupModal.editGroup"))
              : (groupModalType === "channel"
                  ? t("chat.groupModal.newChannel")
                  : t("chat.groupModal.newGroup"))
            }
            submitLabel={editingGroup ? t("common.actions.save") : t("chat.groupModal.create")}
            avatarPreview={groupAvatarPreview}
            avatarColor={
              editingGroup
                ? activeChat?.group_color || "#10b981"
                : newGroupForm.groupColor || "#10b981"
            }
            avatarName={
              newGroupForm.nickname ||
              newGroupForm.username ||
              (groupModalType === "channel"
                ? t("chat.chat.channel")
                : t("chat.chat.group"))
            }
            onAvatarChange={handleGroupAvatarChange}
            onAvatarRemove={handleGroupAvatarRemove}
            showAvatarField
            hideSelectedMemberChips={false}
            fileUploadEnabled={CHAT_PAGE_CONFIG.fileUploadEnabled}
            showInviteManagement={showGroupInviteManagement}
            currentInviteLink={displayedGroupInviteLink}
            regeneratingInviteLink={regeneratingGroupInviteLink}
            onRegenerateInvite={editingGroup ? handleRegenerateGroupInvite : null}
            showRemoteChannelSettings={Boolean(
              groupModalType === "channel" && appInfo?.remoteChannels?.uiEnabled,
            )}
            remoteChannelAvailable={Boolean(
              appInfo?.remoteChannels?.enabled &&
              appInfo?.remoteChannels?.uiEnabled
            )}
            remoteChannelTelegramAvailable={Boolean(
              appInfo?.remoteChannels?.telegramConfigured
            )}
            remoteChannelNextDeskAvailable={Boolean(
              appInfo?.remoteChannels?.nextdeskConfigured
            )}
            remoteChannelMediaStreamAllowed={Boolean(
              appInfo?.remoteChannels?.mediaStreamEnabled
            )}
            entityLabel={
              groupModalType === "channel"
                ? t("chat.chat.channel")
                : t("chat.chat.group")
            }
            onDeleteChat={editingGroup ? handleDeleteActiveGroup : null}
            chatId={editingGroup ? activeChat?.id : null}
            username={user?.username || ""}
          />
        </Suspense>
      ) : null}

      {groupInviteOpen ? (
        <Suspense fallback={null}>
          <GroupInviteLinkModal
            open={groupInviteOpen}
            inviteLink={createdGroupInviteLink}
            type={createdGroupInviteType}
            onClose={() => {
              setGroupInviteOpen(false);
              setCreatedGroupInviteType("group");
            }}
          />
        </Suspense>
      ) : null}

      {profileModalOpen ? (
        <Suspense fallback={null}>
          <ChatProfileModal
            open={profileModalOpen}
            chat={
              mentionProfileChat ||
              ((mentionProfileUser || profileModalMember)
                ? { ...(activeChat || {}), type: "dm" }
                : activeChat)
            }
            targetUser={profileTargetUser}
            currentUser={user}
            muted={activeChatMuted}
            inviteLink={profileInviteLink}
            inviteLinkLoading={profileInviteLinkLoading}
            initialRemoteChannelStatus={profileRemoteChannelStatus}
            onRemoteChannelStatusChange={handleProfileRemoteChannelStatusChange}
            canViewInvite={canCurrentUserViewInvite}
            readOnly={Boolean(
              isMentionProfileReadOnly ||
                mentionProfile?._readOnly ||
                profileModalMember?._readOnly,
            )}
            showJoinAction={canJoinMentionChat}
            onJoinChat={handleJoinMentionChat}
            showMembers={shouldShowMembersList}
            membersBatchSize={CHAT_PAGE_CONFIG.newChatSearchMaxResults}
            remoteChannelAvailable={Boolean(
              appInfo?.remoteChannels?.enabled &&
                appInfo?.remoteChannels?.uiEnabled &&
                !(mentionProfileChat && String(mentionProfileChat.id || "") !== String(activeChat?.id || ""))
            )}
            onClose={closeProfileModal}
            onOpenChat={handleOpenProfileChat}
            onStartVoiceCall={handleProfileStartVoiceCall}
            onStartVideoCall={handleProfileStartVideoCall}
            callsDisabled={!CHAT_PAGE_CONFIG.callsEnabled}
            videoCallsDisabled={!CHAT_PAGE_CONFIG.videoCallsEnabled}
            isInCall={callState !== "idle"}
            onToggleMute={() =>
              toggleMuteChat(mentionProfileChat?.id || activeChat?.id)
            }
            onLeaveGroup={() =>
              requestLeaveGroupById(mentionProfileChat?.id || activeChat?.id)
            }
            onOpenMember={openMemberProfileFromList}
            onRemoveMember={handleRemoveGroupMember}
            onOpenUserContextMenu={openContextMenu}
            onEditGroup={mentionProfileChat && String(mentionProfileChat.id || "") !== String(activeChat?.id || "") ? undefined : openEditGroupFromProfile}
            onEditSelfProfile={openSelfProfileEditor}
            onOpenFiles={
              !mentionProfileChat && !mentionProfileUser && !profileModalMember && activeChat?.id
                ? () => setChatFilesModalOpen(true)
                : null
            }
            onOpenSearch={
              !mentionProfileChat && !mentionProfileUser && !profileModalMember && activeChat?.id
                ? () => setChatSearchModalOpen(true)
                : null
            }
          />
        </Suspense>
      ) : null}

      {chatFilesModalOpen && activeChat?.id ? (
        <Suspense fallback={null}>
          <ChatFilesModal
            open={chatFilesModalOpen}
            chatId={activeChat.id}
            username={user?.username}
            onClose={() => setChatFilesModalOpen(false)}
            onJumpToMessage={handleJumpToMessageInActiveChat}
          />
        </Suspense>
      ) : null}

      {chatSearchModalOpen && activeChat?.id ? (
        <Suspense fallback={null}>
          <ChatSearchModal
            open={chatSearchModalOpen}
            chatId={activeChat.id}
            username={user?.username}
            onClose={() => setChatSearchModalOpen(false)}
            onJumpToMessage={handleJumpToMessageInActiveChat}
          />
        </Suspense>
      ) : null}

      {notificationsModalOpen ? (
        <Suspense fallback={null}>
          <NotificationsSettingsModal
            open={notificationsModalOpen}
            onClose={() => setNotificationsModalOpen(false)}
            notificationsActive={notificationsActive}
            notificationsDisabled={notificationsDisabled}
            notificationStatusLabel={notificationStatusLabel}
            onToggleNotifications={handleToggleNotifications}
            messagePreviewEnabled={messagePreviewEnabled}
            onToggleMessagePreview={handleToggleMessagePreview}
            debugLine={notificationsDebugLine}
          />
        </Suspense>
      ) : null}

      {whatsNewOpen ? (
        <Suspense fallback={null}>
          <WhatsNewModal
            open={whatsNewOpen}
            version={appInfo?.version || ""}
            changelog={appInfo?.currentChangelog || appInfo?.changelog || ""}
            changelogSections={appInfo?.changelogSections || []}
            onClose={() => dismissWhatsNew(true)}
          />
        </Suspense>
      ) : null}

      <AppContextMenu menu={contextMenu} onClose={closeContextMenu} />
    </div>
  );
}

export type UserRole = "owner" | "admin" | "operator" | "user";
export type ChatType = "dm" | "group" | "channel" | "saved";
export type ChatVisibility = "public" | "private";
export type StorageDriver = "local" | "s3" | "r2" | "gcs";
export type DbClient = "postgres";

export interface UserProfile {
  id: string;
  username: string;
  nickname: string;
  role: UserRole;
  color?: string | null;
  avatarUrl?: string | null;
  status?: string | null;
  language?: string | null;
  departmentId?: string | null;
  isVerified?: boolean;
  isBanned?: boolean;
  createdAt?: string;
}

export interface Department {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  sortOrder?: number;
  createdAt?: string;
}

export interface ChatSummary {
  id: string;
  type: ChatType;
  title?: string | null;
  username?: string | null;
  visibility?: ChatVisibility;
  avatarUrl?: string | null;
  unreadCount?: number;
  isMuted?: boolean;
  departmentId?: string | null;
  updatedAt?: string;
}

export interface ChatMessageFile {
  id: string;
  messageId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey?: string;
  url?: string;
  thumbUrl?: string | null;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
  waveform?: number[] | null;
  processingStatus?: string | null;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderUsername?: string;
  body: string;
  replyToId?: string | null;
  forwardedFrom?: Record<string, unknown> | null;
  files?: ChatMessageFile[];
  createdAt: string;
  editedAt?: string | null;
  expiresAt?: string | null;
}

export interface AppMetaInfo {
  version: string;
  channel?: "dev" | "stable";
  signUpEnabled?: boolean;
  adminPanelEnabled?: boolean;
  remoteChannelsEnabled?: boolean;
}

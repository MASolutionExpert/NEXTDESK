import { isValidUuid } from "./uuidUtils.ts";

export function normalizeHexColor(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.startsWith("#") ? raw : `#${raw}`;
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(normalized)) {
    return null;
  }
  const hex = normalized.slice(1).toLowerCase();
  if (hex.length === 6) {
    return `#${hex}`;
  }
  return `#${hex
    .split("")
    .map((char) => `${char}${char}`)
    .join("")}`;
}

export function normalizeChatType(value: unknown): "channel" | "group" {
  return String(value || "")
    .trim()
    .toLowerCase() === "channel"
    ? "channel"
    : "group";
}

export function normalizeVisibility(value: unknown): "private" | "public" {
  return String(value || "")
    .trim()
    .toLowerCase() === "private"
    ? "private"
    : "public";
}

export function parseListValue(value: unknown): string[] {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeGroupUsername(value: unknown): string {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  return raw.replace(/^@+/, "");
}

export function resolveUserRow(dbApi: any, selector: unknown) {
  const raw = String(selector || "").trim();
  if (!raw) return null;
  const num = Number(raw);
  const isId = isValidUuid(raw) || (Number.isFinite(num) && num > 0);
  const sql = isId
    ? "SELECT id, username, nickname, avatar_url, color, status, banned, verified FROM users WHERE id = ? LIMIT 1"
    : "SELECT id, username, nickname, avatar_url, color, status, banned, verified FROM users WHERE username = ? LIMIT 1";
  const idParam = isValidUuid(raw) ? raw : num;
  const params = isId ? [idParam] : [raw.toLowerCase()];

  const result = dbApi.getRow(sql, params);
  if (result && typeof result.then === "function") {
    return result.then((row: any) => row || null).catch(() => null);
  }
  return result || null;
}

export function resolveChatRow(dbApi: any, selector: unknown, options: any = {}) {
  const raw = String(selector || "").trim();
  if (!raw) return null;
  const num = Number(raw);
  const isId = isValidUuid(raw) || (Number.isFinite(num) && num > 0);
  const groupOnly = options.groupOnly !== false;
  const normalizedUsername = normalizeGroupUsername(raw);

  const selectCols =
    "id, name, type, group_username, group_visibility, invite_token, group_color, allow_member_invites, group_avatar_url, created_by_user_id, verified";
  let sql: string;
  let params: unknown[];

  if (isId) {
    sql = groupOnly
      ? `SELECT ${selectCols} FROM chats WHERE id = ? AND type IN ('group', 'channel') LIMIT 1`
      : `SELECT ${selectCols} FROM chats WHERE id = ? LIMIT 1`;
    params = [isValidUuid(raw) ? raw : num];
  } else {
    sql = groupOnly
      ? `SELECT ${selectCols} FROM chats WHERE group_username IN (?, ?) AND type IN ('group', 'channel') LIMIT 1`
      : `SELECT ${selectCols} FROM chats WHERE group_username IN (?, ?) LIMIT 1`;
    params = [normalizedUsername, `@${normalizedUsername}`];
  }

  const result = dbApi.getRow(sql, params);
  if (result && typeof result.then === "function") {
    return result.then((row: any) => row || null).catch(() => null);
  }
  return result || null;
}

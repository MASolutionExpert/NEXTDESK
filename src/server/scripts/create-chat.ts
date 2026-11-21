import crypto from "node:crypto";
import { getCliArgs, getFlagValue, hasFlag } from "./_cli.ts";
import { openDatabase, runAdminActionViaServer } from "./_db-admin.ts";
import { createInviteToken } from "../lib/inviteTokens.ts";
import {
  normalizeChatType,
  normalizeVisibility,
  parseListValue,
  resolveUserRow,
  normalizeGroupUsername,
} from "../lib/dbToolHelpers.ts";

function normalizeTelegramSource(value) {
  const raw: any = String(value || "").trim();
  if (!raw) return null;

  // Numeric chat ID
  const numericSource: any = raw.match(/^-?\d{5,}$/);
  if (numericSource) {
    return { sourceChatId: raw, sourceUsername: "" };
  }

  // URL or username
  let candidate = raw;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const url: any = new URL(candidate);
      const host: any = url.hostname.toLowerCase();
      if (!["t.me", "telegram.me"].includes(host)) {
        return null;
      }
      const parts: any = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "s") parts.shift();
      candidate = parts[0] || "";
    } catch {
      return null;
    }
  }

  candidate = candidate.replace(/^@+/, "").trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(candidate)) {
    return null;
  }

  return { sourceChatId: "", sourceUsername: candidate.toLowerCase() };
}

async function main() {
  const args: any = getCliArgs();
  const type: any = normalizeChatType(getFlagValue(args, "--type"));
  const name: any = String(getFlagValue(args, "--name") || "").trim();
  const ownerSelector: any = String(getFlagValue(args, "--owner") || "").trim();
  const visibility: any = normalizeVisibility(getFlagValue(args, "--visibility"));
  const username: any = normalizeGroupUsername(getFlagValue(args, "--username"));
  const usersValue: any = getFlagValue(args, "--users");
  const memberSelectors: any = parseListValue(usersValue);
  const remoteChannelValue: any = getFlagValue(args, "--remote-channel");
  const syncMetadata: any = hasFlag(args, "--sync-metadata");
  const streamMedia: any = hasFlag(args, "--stream-media");

  if (!name || !ownerSelector || !username) {
    console.error(
      'Usage: npm run db:chat:create -- --type group --name "My Group" --owner alice --username my_group [--visibility public|private] [--users bob,charlie]',
    );
    console.error(
      'For channels with Remote Channel: [--remote-channel <telegram-source>] [--sync-metadata] [--stream-media]',
    );
    process.exit(1);
  }

  const remoteResult: any = await runAdminActionViaServer("create_chat", {
    type,
    name,
    owner: ownerSelector,
    username,
    visibility,
    memberSelectors,
    remoteChannelValue,
    syncMetadata,
    streamMedia,
  });
  if (remoteResult) {
    console.log(
      `Server mode chat created: id=${remoteResult.id} type=${remoteResult.type}`,
    );
    return;
  }

  // Validate Remote Channel configuration if provided
  if (remoteChannelValue) {
    if (type !== "channel") {
      console.error("Remote Channel can only be configured for channels.");
      process.exit(1);
    }

    const remoteChannelEnabled = String(
      process.env.REMOTE_CHANNEL || "false"
    ).toLowerCase() === "true";
    if (!remoteChannelEnabled) {
      console.error(
        "Remote Channel feature is disabled. Configure and enable remote channel first",
      );
      process.exit(1);
    }

    const normalized: any = normalizeTelegramSource(remoteChannelValue);
    if (!normalized) {
      console.error(
        "Invalid Telegram source. Use a channel username, t.me link, or numeric chat ID.",
      );
      process.exit(1);
    }
  }

  const dbApi: any = await openDatabase();
  try {
    const owner: any = await resolveUserRow(dbApi, ownerSelector);
    if (!owner?.id) {
      console.error("Owner user not found.");
      process.exit(1);
    }

    const userConflict: any = await dbApi.getRow(
      "SELECT id FROM users WHERE username = ?",
      [username],
    );
    if (userConflict?.id) {
      console.error("Chat username already exists.");
      process.exit(1);
    }
    const chatConflict: any = await dbApi.getRow(
      "SELECT id FROM chats WHERE type IN ('group', 'channel') AND group_username IN (?, ?)",
      [username, `@${username}`],
    );
    if (chatConflict?.id) {
      console.error("Chat username already exists.");
      process.exit(1);
    }

    const ownerUsername: any = String(owner.username || "").toLowerCase();
    const resolvedMembers: any = [];
    for (const selector of memberSelectors) {
      const row: any = await resolveUserRow(dbApi, selector);
      if (row?.id) resolvedMembers.push(row);
    }
    const memberRows: any = Array.from(
      new Map(resolvedMembers.map((row) => [String(row.id), row])).values(),
    ).filter(
      (row: any) => String(row.username || "").toLowerCase() !== ownerUsername,
    );

    const inviteToken: any = createInviteToken(crypto);
    const ownerColorRow: any = await dbApi.getRow("SELECT color FROM users WHERE id = ?", [owner.id]);
    const groupColor = ownerColorRow?.color || "#10b981";

    await dbApi.run("BEGIN");
    let chatId: any = null;
    try {
      const newChatId: any = crypto.randomUUID();
      await dbApi.run(
        `INSERT INTO chats (
          id, name, type, group_username, group_visibility, invite_token, created_by_user_id, group_color, allow_member_invites, group_avatar_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newChatId,
          name,
          type,
          username || null,
          visibility,
          inviteToken,
          owner.id,
          groupColor,
          1,
          null,
        ],
      );

      const chatRow: any = await dbApi.getRow(
        `SELECT id, name, type, group_username, group_visibility, created_by_user_id
         FROM chats
         WHERE invite_token = ?`,
        [inviteToken],
      );
      chatId = chatRow?.id;
      if (!chatId) {
        throw new Error("Failed to create chat.");
      }

      await dbApi.run(
        "INSERT OR IGNORE INTO chat_members (chat_id, user_id, role) VALUES (?, ?, ?)",
        [chatId, owner.id, "owner"],
      );
      for (const member of memberRows) {
        await dbApi.run(
          "INSERT OR IGNORE INTO chat_members (chat_id, user_id, role) VALUES (?, ?, ?)",
          [chatId, member.id, "member"],
        );
      }
      await dbApi.run("COMMIT");
    } catch (error) {
      await dbApi.run("ROLLBACK");
      throw error;
    }

    await dbApi.save();
    console.log(`Chat created: id=${chatId} type=${type} name=${name}`);
    console.log(`Owner: ${owner.username}`);
    console.log(`Members added: ${memberRows.length + 1}`);

    // Configure Remote Channel if provided
    if (remoteChannelValue && type === "channel") {
      const normalized: any = normalizeTelegramSource(remoteChannelValue);
      const sourceRaw = remoteChannelValue;
      const sourceChatId = normalized.sourceChatId || null;
      const sourceUsername = normalized.sourceUsername || null;
      const enabled = 1;
      const syncMeta = syncMetadata ? 1 : 0;
      const streamMed = streamMedia ? 1 : 0;
      const sourceVersion = 1;

      await dbApi.run(
        `INSERT INTO remote_channel_sources (
           chat_id, provider, source_raw, source_chat_id, source_username,
           source_version, sync_metadata, stream_media, enabled, last_error, updated_at
         )
         VALUES (?, 'telegram', ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'))`,
        [
          chatId,
          sourceRaw,
          sourceChatId,
          sourceUsername,
          sourceVersion,
          syncMeta,
          streamMed,
          enabled,
        ],
      );

      await dbApi.save();
      console.log(`Remote Channel configured: source=${sourceRaw}`);
      console.log(`Sync metadata: ${syncMetadata ? "yes" : "no"}`);
      console.log(`Stream media: ${streamMedia ? "yes" : "no"}`);
    }
  } finally {
    await dbApi.close();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

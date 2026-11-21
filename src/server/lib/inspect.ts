import { dbKnex } from "../db/knex.ts";

export function createInspector({ fs, dataDir, adminGetRow, adminGetAll }: any) {
  const getDiskUsageInfo = () => {
    try {
      if (typeof fs.statfsSync !== "function") return null;

      const stat: any = fs.statfsSync(dataDir);
      const blockSize: any = Number(stat.bsize || 0);
      const blocks: any = Number(stat.blocks || 0);
      const freeBlocks: any = Number(stat.bavail || stat.bfree || 0);
      const totalBytes = blockSize * blocks;
      const freeBytes = blockSize * freeBlocks;
      const usedBytes: any = Math.max(0, totalBytes - freeBytes);
      const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

      return {
        totalBytes,
        usedBytes,
        freeBytes,
        usedPercent,
        freePercent: Math.max(0, 100 - usedPercent),
      };
    } catch (_) {
      return null;
    }
  };

  const buildInspectSnapshot = async (kind = "all", limit = 25) => {
    const safeLimit: any = Math.max(1, Math.min(1000, Number(limit) || 25));
    const mode: any = String(kind || "all").toLowerCase();

    const [userCount, chatCount, messageCount, fileCount] = await Promise.all([
      adminGetRow(dbKnex("users").count({ n: "*" }).first()),
      adminGetRow(dbKnex("chats").count({ n: "*" }).first()),
      adminGetRow(dbKnex("chat_messages").count({ n: "*" }).first()),
      adminGetRow(dbKnex("chat_message_files").count({ n: "*" }).first()),
    ]);
    const counts: any = {
      users: Number(userCount?.n || 0),
      chats: Number(chatCount?.n || 0),
      messages: Number(messageCount?.n || 0),
      files: Number(fileCount?.n || 0),
    };

    const snapshot: any = {
      kind: mode,
      limit: safeLimit,
      counts,
      disk: getDiskUsageInfo(),
    };

    if (mode === "all" || mode === "user") {
      snapshot.users = await adminGetAll(
        dbKnex("users")
          .select("id", "username", "nickname", "status", "banned", "avatar_url", "created_at")
          .orderBy("id", "asc")
          .limit(safeLimit),
      );
    }

    if (mode === "all" || mode === "chat") {
      const chats: any = await adminGetAll(
        dbKnex("chats as c")
          .select(
            "c.id",
            "c.type",
            "c.name",
            dbKnex.raw("(SELECT COUNT(*) FROM chat_messages m WHERE m.chat_id = c.id) AS messages"),
            "c.created_at",
          )
          .orderBy("c.id", "asc")
          .limit(safeLimit),
      );
      const chatIds: any = chats.map((chat) => Number(chat.id)).filter(Number.isFinite);
      const members = chatIds.length
        ? await adminGetAll(
            dbKnex("chat_members")
              .select("chat_id", "user_id")
              .whereIn("chat_id", chatIds)
              .orderBy("chat_id", "asc")
              .orderBy("user_id", "asc"),
          )
        : [];
      const memberIdsByChat: any = new Map<any, any>();
      members.forEach((member) => {
        const chatId: any = Number(member.chat_id);
        const userId: any = Number(member.user_id);
        if (!Number.isFinite(chatId) || !Number.isFinite(userId) || userId <= 0) return;
        const memberIds = memberIdsByChat.get(chatId) || [];
        memberIds.push(userId);
        memberIdsByChat.set(chatId, memberIds);
      });
      snapshot.chats = chats.map((chat) => ({
        ...chat,
        members: memberIdsByChat.get(Number(chat.id))?.length || 0,
        member_ids: memberIdsByChat.get(Number(chat.id)) || [],
        messages: Number(chat.messages || 0),
      }));
    }

    if (mode === "all" || mode === "file") {
      snapshot.messageFiles = await adminGetAll(
        dbKnex("chat_message_files as cmf")
          .join("chat_messages as cm", "cm.id", "cmf.message_id")
          .select(
            "cmf.id",
            "cmf.message_id",
            "cm.chat_id",
            "cm.user_id",
            "cmf.kind",
            "cmf.original_name",
            "cmf.stored_name",
            "cmf.mime_type",
            "cmf.size_bytes",
            "cmf.created_at",
          )
          .orderBy("cmf.id", "asc")
          .limit(safeLimit),
      );

      snapshot.avatarFiles = await adminGetAll(
        dbKnex("users")
          .select("id AS user_id", "username", "nickname", "avatar_url")
          .whereNotNull("avatar_url")
          .where("avatar_url", "!=", "")
          .orderBy("id", "asc")
          .limit(safeLimit),
      );

      snapshot.fileStorage = {
        messageFilesBytes: Number(
          (await adminGetRow(
            dbKnex("chat_message_files")
              .select(dbKnex.raw("COALESCE(SUM(size_bytes), 0) AS n"))
              .first(),
          ))?.n || 0,
        ),
      };
    }

    return snapshot;
  };

  const hasEnoughFreeDiskSpace = (requiredBytes = 0) => {
    const required: any = Number(requiredBytes || 0);
    if (!Number.isFinite(required) || required <= 0) return true;

    const disk: any = getDiskUsageInfo();
    if (!disk || !Number.isFinite(Number(disk.freeBytes))) return true;

    const safetyBuffer = 1 * 1024 * 1024;

    return Number(disk.freeBytes) >= required + safetyBuffer;
  };

  return {
    buildInspectSnapshot,
    getDiskUsageInfo,
    hasEnoughFreeDiskSpace,
  };
}

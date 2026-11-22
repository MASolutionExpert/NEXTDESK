import crypto from "node:crypto";

export async function addChatMembers(
  dbApi: any,
  chat: any,
  rows: any[],
  { force = false }: any = {},
) {
  const members = await dbApi.getAll(
    "SELECT user_id FROM chat_members WHERE chat_id = ? AND role = 'owner'",
    [chat.id],
  );
  const existingOwnerIds = new Set(
    (Array.isArray(members) ? members : []).map((row: any) => row?.user_id),
  );

  let addedCount = 0;
  let skippedLeftCount = 0;

  for (const row of rows) {
    const existing = await dbApi.getRow(
      "SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?",
      [chat.id, row.id],
    );
    if (existing?.role) continue;

    if (!force) {
      const priorLeft = await dbApi.getRow(
        `SELECT 1 AS prior_left
         FROM chat_left_members
         WHERE chat_id = ? AND user_id = ?
         UNION
         SELECT 1 AS prior_left
         FROM chat_messages
         WHERE chat_id = ? AND user_id = ? AND body LIKE ?
         LIMIT 1`,
        [chat.id, row.id, chat.id, row.id, "[[system:left:%"],
      );
      if (priorLeft?.prior_left) {
        skippedLeftCount += 1;
        continue;
      }
    }

    const role = existingOwnerIds.has(row.id) ? "owner" : "member";
    await dbApi.run(
      "INSERT INTO chat_members (chat_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
      [chat.id, row.id, role],
    );
    if (chat.type === "group") {
      await dbApi.run(
        "INSERT INTO chat_messages (id, chat_id, user_id, body) VALUES (?, ?, ?, ?)",
        [
          crypto.randomUUID(),
          chat.id,
          row.id,
          `[[system:joined:${row.nickname || row.username}]]`,
        ],
      );
    }
    addedCount += 1;
  }

  await dbApi.save();
  return { addedCount, skippedLeftCount };
}

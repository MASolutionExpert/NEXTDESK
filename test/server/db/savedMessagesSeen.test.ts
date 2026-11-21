import { describe, test, expect, beforeEach } from "vitest";
import {
  createUser,
  createChat,
  addChatMember,
  createMessage,
  markMessageRead,
  markMessagesRead,
  getMessages,
  listChatsForUser,
} from "../../../src/server/db.ts";
import { createTestDb } from "./testDbHelper.ts";

describe("Saved messages seen status persistence", () => {
  beforeEach(async () => {
    await createTestDb();
  });

  test("markMessageRead marks message as read in a saved chat where sender is reader", async () => {
    const userId = await createUser(
      "user_saved_" + Date.now(),
      "hash",
      "Saved User",
      null,
      "#10b981",
    );
    const chatId = await createChat("Saved messages", "saved", {
      createdByUserId: userId,
    });
    await addChatMember(chatId, userId, "owner");
    const messageId = await createMessage(chatId, userId, "My saved note");

    const msgsBefore = await getMessages(chatId);
    const msgBefore = msgsBefore.messages.find((m) => m.id === messageId);
    expect(msgBefore).toBeDefined();

    await markMessageRead(messageId, userId);

    const msgsAfter = await getMessages(chatId);
    const msgAfter = msgsAfter.messages.find((m) => m.id === messageId);
    expect(msgAfter).toBeDefined();
    expect(msgAfter.read_at).toBeTruthy();
    expect(msgAfter.read_by_user_id).toBe(userId);

    const chats = await listChatsForUser(userId);
    const savedChat = chats.find((c) => c.id === chatId);
    expect(savedChat).toBeDefined();
    expect(savedChat.last_message_read_at).toBeTruthy();
    expect(savedChat.last_message_read_by_user_id).toBe(userId);
  });

  test("markMessagesRead marks all messages as read in saved chat", async () => {
    const userId = await createUser(
      "user_saved_all_" + Date.now(),
      "hash",
      "Saved User All",
      null,
      "#10b981",
    );
    const chatId = await createChat("Saved messages", "saved", {
      createdByUserId: userId,
    });
    await addChatMember(chatId, userId, "owner");
    const msgId1 = await createMessage(chatId, userId, "Note 1");
    const msgId2 = await createMessage(chatId, userId, "Note 2");

    await markMessagesRead(chatId, userId);

    const msgs = await getMessages(chatId);
    const m1 = msgs.messages.find((m) => m.id === msgId1);
    const m2 = msgs.messages.find((m) => m.id === msgId2);
    expect(m1.read_at).toBeTruthy();
    expect(m2.read_at).toBeTruthy();
  });
});

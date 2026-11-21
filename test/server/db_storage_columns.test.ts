import { describe, test, expect, beforeAll } from "vitest";
import {
  createMessageFiles,
  findMessageFileById,
  listMessageFilesByMessageIds,
  getRow,
  createMessage,
  createUser,
  createChat,
} from "../../src/server/db.ts";
import { createTestDb } from "./db/testDbHelper.ts";

describe("Database Storage and Media Columns (PostgreSQL + Prisma 7)", () => {
  let testUserId: string;
  let testChatId: string;
  let testMessageId: string;

  beforeAll(async () => {
    await createTestDb();
    testUserId = await createUser(`storage_user_${Date.now()}`, "password123");
    testChatId = await createChat("Storage Test Chat", "group");
    testMessageId = await createMessage(
      testChatId,
      testUserId,
      "Test message for files",
    );
  });

  test("users table has avatar storage columns", async () => {
    const user = await getRow("SELECT * FROM users WHERE id = ?", [testUserId]);
    expect(user).toBeDefined();
    expect(user.avatar_storage_driver).toBe("local");
    expect(user.avatar_storage_key).toBeNull();
    expect(user.avatar_encryption_type).toBe("none");
  });

  test("createMessageFiles inserts default storage and media fields", async () => {
    await createMessageFiles(testMessageId, [
      {
        kind: "image",
        originalName: "test.png",
        storedName: "test_stored.png",
        mimeType: "image/png",
        sizeBytes: 1024,
      },
    ]);
    const files = await listMessageFilesByMessageIds([testMessageId]);
    expect(files.length).toBeGreaterThan(0);
    const file = files.find((f) => f.stored_name === "test_stored.png");
    expect(file).toBeDefined();
    expect(file.storage_driver).toBe("local");
    expect(file.storage_key).toBeNull();
    expect(file.processing_status).toBe("ready");
    expect(file.blurhash).toBeNull();
    expect(file.waveform).toBeNull();
    expect(file.thumb_storage_key).toBeNull();
    expect(file.encryption_type).toBe("none");
  });

  test("createMessageFiles inserts custom storage and media fields", async () => {
    await createMessageFiles(testMessageId, [
      {
        kind: "audio",
        originalName: "voice.ogg",
        storedName: "voice_stored.ogg",
        mimeType: "audio/ogg",
        sizeBytes: 2048,
        storageDriver: "remote",
        storageKey: "audio/123/voice.ogg",
        processingStatus: "processing",
        blurhash: "L6PZf-ay.ayB",
        waveform: "[0,1,2,3,4]",
        thumbStorageKey: "audio/123/thumb.png",
        encryptionType: "aes-256-gcm",
      },
    ]);
    const files = await listMessageFilesByMessageIds([testMessageId]);
    const file = files.find((f) => f.stored_name === "voice_stored.ogg");
    expect(file).toBeDefined();
    expect(file.storage_driver).toBe("remote");
    expect(file.storage_key).toBe("audio/123/voice.ogg");
    expect(file.processing_status).toBe("processing");
    expect(file.blurhash).toBe("L6PZf-ay.ayB");
    expect(file.waveform).toBe("[0,1,2,3,4]");
    expect(file.thumb_storage_key).toBe("audio/123/thumb.png");
    expect(file.encryption_type).toBe("aes-256-gcm");

    const fetchedById = await findMessageFileById(file.id);
    expect(fetchedById).toBeDefined();
    expect(fetchedById.id).toBe(file.id);
    expect(fetchedById.storage_driver).toBe("remote");
    expect(fetchedById.storage_key).toBe("audio/123/voice.ogg");
    expect(fetchedById.encryption_type).toBe("aes-256-gcm");
  });
});

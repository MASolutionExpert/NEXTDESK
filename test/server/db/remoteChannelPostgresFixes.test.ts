import { afterEach, describe, expect, test, vi } from "vitest";
import { pgPool } from "../../../src/server/db/prisma.ts";
import {
  enqueueRemoteChannelQueueItem,
  markRemoteChannelQueueItemDone,
} from "../../../src/server/db.ts";

describe("remote channel PostgreSQL queries (NULL params, UUID done-marker)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("enqueueRemoteChannelQueueItem binds explicit parameters and returns inserted row id", async () => {
    const querySpy = vi
      .spyOn(pgPool, "query")
      .mockImplementation(async (sql: any, params?: any) => {
        const text = String(sql || "");
        if (text.includes("INSERT INTO remote_channel_queue")) {
          return { rows: [{ id: 42 }], rowCount: 1 } as any;
        }
        return { rows: [], rowCount: 0 } as any;
      });

    const id = await enqueueRemoteChannelQueueItem({
      sourceId: 7,
      chatId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      remoteMessageId: 9001,
      remoteGroupedId: null,
      payloadJson: JSON.stringify({ text: "hello" }),
      sourceVersion: 1,
    });

    expect(id).toBe(42);
    expect(querySpy).toHaveBeenCalled();
  });

  test("enqueueRemoteChannelQueueItem returns null on conflict", async () => {
    vi.spyOn(pgPool, "query").mockImplementation(async () => {
      return { rows: [], rowCount: 0 } as any;
    });

    const id = await enqueueRemoteChannelQueueItem({
      sourceId: 7,
      chatId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      remoteMessageId: 9001,
      remoteGroupedId: null,
      payloadJson: "{}",
      sourceVersion: 1,
    });

    expect(id).toBeNull();
  });

  test("markRemoteChannelQueueItemDone stores UUID chat_message_id as text", async () => {
    const msgUuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const querySpy = vi
      .spyOn(pgPool, "query")
      .mockImplementation(async () => ({ rows: [], rowCount: 1 }) as any);

    await markRemoteChannelQueueItemDone(42, msgUuid);

    expect(querySpy).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE remote_channel_queue"),
      [msgUuid, 42],
    );
  });
});

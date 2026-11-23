import { Queue, Worker } from "bullmq";
import { readEnvBool } from "../settings/env.ts";

export function createMediaQueueManager({
  redisClient,
  storageProvider,
  s3ProcessingMode = "auto",
  s3ProcessingTimeoutMs,
  adminGetRow,
  adminRun,
  emitChatEvent,
  enqueueVideoTranscodeJob,
  transcodeVideosToH264,
  getSetting,
}: any) {
  const effectiveTimeoutMs = Math.max(
    0,
    Number(
      s3ProcessingTimeoutMs !== undefined
        ? s3ProcessingTimeoutMs
        : process.env.STORAGE_PROCESSING_TIMEOUT_MS || 120000,
    ) || 120000,
  );

  const isRealRedis =
    redisClient &&
    typeof redisClient.duplicate === "function" &&
    redisClient.constructor.name !== "InProcessRedisClient";

  let bullQueue: any = null;
  let bullWorker: any = null;
  const inMemoryQueue: any = [];
  const activeTimers = new Map<any, any>();

  async function processMediaJob(jobData) {
    const { fileId, storageKey } = jobData;
    if (!fileId) return;

    // Check DB status to see if remote provider already processed it
    const row = adminGetRow
      ? await adminGetRow("SELECT * FROM chat_message_files WHERE id = $1 LIMIT 1", [fileId])
      : null;

    if (!row) return;
    if (row.processing_status === "ready") return; // Already processed by remote compute

    try {
      // Execute local fallback processing
      const isVideo = String(row.mime_type || "").toLowerCase().startsWith("video/");
      const isTranscodeEnabled = () => {
        if (typeof transcodeVideosToH264 === "boolean") return transcodeVideosToH264;
        if (typeof getSetting === "function") {
          const val = getSetting("FILE_UPLOAD_TRANSCODE_VIDEOS");
          if (val !== undefined && val !== null) return Boolean(val);
        }
        return readEnvBool("FILE_UPLOAD_TRANSCODE_VIDEOS", true);
      };

      if (isVideo && isTranscodeEnabled() && typeof enqueueVideoTranscodeJob === "function") {
        enqueueVideoTranscodeJob({
          fileId,
          storedName: row.stored_name,
          storageKey: row.storage_key || storageKey,
          storageDriver: row.storage_driver,
          messageId: row.message_id,
        });
      } else {
        // Update DB status to ready
        if (adminRun) {
          await adminRun(
            "UPDATE chat_message_files SET processing_status = 'ready' WHERE id = $1",
            [fileId],
          );
        }

        // Broadcast SSE notification
        if (typeof emitChatEvent === "function") {
          emitChatEvent("nextdesk:realtime-event", {
            type: "video:ready",
            fileId,
            storageKey: row.storage_key || storageKey,
          });
        }
      }
    } catch (err) {
      if (adminRun) {
        await adminRun(
          "UPDATE chat_message_files SET processing_status = 'failed' WHERE id = $1",
          [fileId],
        );
      }
    }
  }

  if (isRealRedis) {
    try {
      const connection = redisClient.options
        ? {
            host: redisClient.options.host,
            port: redisClient.options.port,
            username: redisClient.options.username,
            password: redisClient.options.password,
            db: redisClient.options.db,
          }
        : { host: "127.0.0.1", port: 6379 };

      bullQueue = new Queue("media-processing", { connection });
      bullWorker = new Worker(
        "media-processing",
        async (job) => {
          await processMediaJob(job.data);
        },
        { connection },
      );
    } catch (e) {
      bullQueue = null;
      bullWorker = null;
    }
  }

  function enqueueJob(data, delayMs = 0) {
    if (bullQueue) {
      bullQueue.add("process-media", data, { delay: delayMs });
    } else {
      if (delayMs > 0) {
        const timer = setTimeout(() => {
          activeTimers.delete(data.fileId);
          processMediaJob(data);
        }, delayMs);
        if (typeof timer.unref === "function") timer.unref();
        activeTimers.set(data.fileId, timer);
      } else {
        inMemoryQueue.push(data);
        setImmediate(() => processMediaJob(data));
      }
    }
  }

  function scheduleFallbackCheck({ fileId, storageKey }: any) {
    if (s3ProcessingMode === "remote") return; // Pure remote, no local fallback timer

    // Read live so admin-panel changes apply without a restart.
    const liveTimeoutMs = typeof getSetting === "function"
      ? Number(getSetting("STORAGE_PROCESSING_TIMEOUT_MS"))
      : 0;
    enqueueJob(
      { fileId, storageKey, reason: "fallback_timer" },
      Number.isFinite(liveTimeoutMs) && liveTimeoutMs > 0 ? liveTimeoutMs : effectiveTimeoutMs,
    );
  }

  function cancelFallbackCheck(fileId) {
    if (activeTimers.has(fileId)) {
      clearTimeout(activeTimers.get(fileId));
      activeTimers.delete(fileId);
    }
  }

  async function close() {
    for (const timer of activeTimers.values()) {
      clearTimeout(timer);
    }
    activeTimers.clear();

    if (bullWorker) await bullWorker.close();
    if (bullQueue) await bullQueue.close();
  }

  return {
    enqueueJob,
    scheduleFallbackCheck,
    cancelFallbackCheck,
    processMediaJob,
    close,
  };
}

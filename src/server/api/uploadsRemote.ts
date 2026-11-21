import crypto from "node:crypto";
import path from "node:path";
import rateLimit from "express-rate-limit";
import { storageEncryption as defaultStorageEncryption } from "../lib/storageEncryption.ts";
import { dispatchMediaWorkerJob } from "../lib/mediaWorker.ts";
import { ensureBucketCorsForRequest } from "../lib/bucketCors.ts";
import { resolveWebhookCallbackUrl } from "../lib/webhookUrl.ts";
import { resolveThumbUrl } from "../lib/thumbUrl.ts";
import { readEnvBool } from "../settings/env.ts";

export function registerRemoteUploadRoutes(app, deps) {
  const {
    storageProvider,
    mediaQueueManager,
    adminGetRow,
    adminRun,
    adminSave,
    getSession,
    createMessageFiles,
    findMessageFileById,
    emitChatEvent,
    recordPendingPresignedUpload,
    storageProcessingMode = "auto",
    s3ProcessingMode = "auto",
    webhookSecret,
    workerUrl =
      deps.workerUrl ||
      deps.mediaWorkerUrl ||
      process.env.WORKER_URL ||
      process.env.MEDIA_WORKER_URL ||
      null,
    mediaWorkerUrl =
      deps.workerUrl ||
      deps.mediaWorkerUrl ||
      process.env.WORKER_URL ||
      process.env.MEDIA_WORKER_URL ||
      null,
    requireSession,
    getSessionFromRequest,
    storageEncryption = defaultStorageEncryption,
    enqueueVideoTranscodeJob = deps.enqueueVideoTranscodeJob,
    listMessageFilesByMessageIds = deps.listMessageFilesByMessageIds,
    ALLOWED_AVATAR_MIME_TYPES = deps.ALLOWED_AVATAR_MIME_TYPES,
    AVATAR_FILE_LIMITS = deps.AVATAR_FILE_LIMITS,
  } = deps;

  function toSql(builder, p: any = []) {
    if (builder && typeof builder.toSQL === "function") {
      const c: any = builder.toSQL();
      return { sql: c.sql, params: c.bindings || [] };
    }
    return { sql: builder, params: p };
  }

  const callAdminGetRow = (builder, p?: any) => {
    const { sql, params } = toSql(builder, p);
    return adminGetRow(sql, params);
  };
  const callAdminRun = (builder, p?: any) => {
    const { sql, params } = toSql(builder, p);
    return adminRun(sql, params);
  };

  const parseCookies = (cookieHeader = "") => {
    const list: any = {};
    cookieHeader.split(";").forEach((cookie) => {
      const parts: any = cookie.split("=");
      if (parts.length >= 2) {
        list[parts.shift().trim()] = decodeURIComponent(parts.join("=").trim());
      }
    });
    return list;
  };

  const authenticateSession = async (req, res) => {
    if (typeof requireSession === "function") {
      return await requireSession(req, res);
    }
    let session: any = null;
    if (typeof getSessionFromRequest === "function") {
      const rawSession: any = getSessionFromRequest(req);
      session = rawSession && typeof rawSession.then === "function" ? await rawSession : rawSession;
    } else if (typeof getSession === "function") {
      const cookies: any = parseCookies(req.headers.cookie || "");
      const token =
        cookies.sid || req.headers.authorization?.replace(/^Bearer\s+/i, "");
      const rawSession: any = getSession(token);
      session = rawSession && typeof rawSession.then === "function" ? await rawSession : rawSession;
    }
    if (!session) {
      res.status(401).json({ error: "Not authenticated." });
      return null;
    }
    return session;
  };

  const presignRateLimiter: any = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({ error: "Too many upload requests. Please slow down." }),
  });

  // POST /api/uploads/presign
  app.post("/api/uploads/presign", presignRateLimiter, async (req, res) => {
    const session: any = await authenticateSession(req, res);
    if (!session) return;

    // Self-heal bucket CORS from the request's own origin (covers domains
    // attached after first boot — no redeploy needed). Best-effort: presign
    // continues regardless of the outcome. Opt-in via STORAGE_AUTO_CORS=true.
    if (
      (deps.getSetting && deps.getSetting("STORAGE_AUTO_CORS")) ||
      String(process.env.STORAGE_AUTO_CORS ?? "false").toLowerCase() ===
        "true" ||
      String(process.env.STORAGE_AUTO_CORS ?? "false") === "1"
    ) {
      try {
        const corsResult: any = await ensureBucketCorsForRequest(
          storageProvider,
          req,
        );
        if (corsResult.status === "applied") {
          console.log(
            `[server] Bucket CORS policy applied for presign origin (uploadsRemote).`,
          );
        } else if (corsResult.status === "error") {
          console.warn(
            `[server] Presign CORS self-heal failed: ${corsResult.error}`,
          );
        }
      } catch (_) {}
    }

    const {
      filename,
      originalName,
      contentType,
      mimeType,
      fileSize,
      sizeBytes,
      width,
      height,
      duration,
      clientWebpThumbBase64,
      blurhash,
      waveform,
      messageId,
      encryptionType,
      encryption_type,
      uploadType,
    } = req.body || {};

    const name = filename || originalName || "upload.bin";
    const mime = contentType || mimeType || "application/octet-stream";
    const size: any = Number(fileSize ?? sizeBytes ?? 0);

    const isAvatarUpload = String(uploadType || "").toLowerCase() === "avatar";

    if (isAvatarUpload) {
      const avatarLimit =
        AVATAR_FILE_LIMITS?.maxFileSizeBytes ||
        deps.AVATAR_FILE_LIMITS?.maxFileSizeBytes ||
        10 * 1024 * 1024;

      if (!size || size <= 0 || size > avatarLimit) {
        return res
          .status(400)
          .json({ error: "File size exceeds maximum allowed limit." });
      }

      const allowedMimes =
        ALLOWED_AVATAR_MIME_TYPES ||
        deps.ALLOWED_AVATAR_MIME_TYPES ||
        new Set([
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
          "image/bmp",
        ]);

      if (!allowedMimes.has(String(mime || "").toLowerCase())) {
        return res
          .status(400)
          .json({ error: "Avatar must be a JPEG, PNG, GIF, WEBP, or BMP image." });
      }

      if (
        !storageProvider ||
        (storageProvider.type !== "remote" && storageProvider.type !== "s3") ||
        typeof storageProvider.getUploadUrl !== "function"
      ) {
        return res.json({
          success: true,
          type: "local",
        });
      }

      const ext = path.extname(name).toLowerCase() || ".png";
      const generatedName = `avatar-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
      const generatedKey = `uploads/avatars/${generatedName}`;

      try {
        const uploadResult: any = await storageProvider.getUploadUrl({
          filename: generatedName,
          contentType: mime,
          fileSize: size,
          key: generatedKey,
        });

        const finalStorageKey =
          uploadResult.storageKey || uploadResult.key || generatedKey;
        const providerType = storageProvider.type || uploadResult.type || "s3";

        if (typeof recordPendingPresignedUpload === "function") {
          try {
            recordPendingPresignedUpload({
              storageKey: finalStorageKey,
              userId: session?.userId || null,
            });
          } catch (_) {}
        } else if (typeof adminRun === "function") {
          try {
            await callAdminRun(
              "INSERT INTO pending_presigned_uploads (storage_key, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (storage_key) DO NOTHING",
              [finalStorageKey, session?.userId || null, new Date().toISOString()],
            );
            if (typeof adminSave === "function") adminSave();
          } catch (_) {}
        }

        return res.json({
          success: true,
          type: providerType,
          uploadUrl: uploadResult.uploadUrl,
          storageKey: finalStorageKey,
          avatarUrl: `/api/uploads/avatars/${generatedName}`,
        });
      } catch (err) {
        return res.status(500).json({
          error: err.message || "Failed to generate presigned upload URL.",
        });
      }
    }

    const maxLimit =
      deps.MESSAGE_FILE_LIMITS?.maxFileSizeBytes ||
      (deps.getSetting ? deps.getSetting("FILE_UPLOAD_MAX_SIZE") : null) ||
      100 * 1024 * 1024;

    if (!size || size <= 0 || size > maxLimit) {
      return res
        .status(400)
        .json({ error: "File size exceeds maximum allowed limit." });
    }

    const ext: any = path.extname(name).toLowerCase();
    const generatedKey = `uploads/messages/${Date.now()}_${crypto.randomBytes(8).toString("hex")}${ext}`;

    if (
      !storageProvider ||
      typeof storageProvider.getUploadUrl !== "function"
    ) {
      return res
        .status(500)
        .json({ error: "Storage provider not configured." });
    }

    try {
      const uploadResult: any = await storageProvider.getUploadUrl({
        filename: name,
        contentType: mime,
        fileSize: size,
        key: generatedKey,
      });

      const finalStorageKey =
        uploadResult.storageKey || uploadResult.key || generatedKey;
      const providerType = storageProvider.type || uploadResult.type || "s3";

      let kind = "document";
      if (mime.startsWith("image/")) kind = "image";
      else if (mime.startsWith("video/")) kind = "video";
      else if (mime.startsWith("audio/")) kind = "audio";

      const transcodeEnabled = deps.getSetting
        ? Boolean(deps.getSetting("FILE_UPLOAD_TRANSCODE_VIDEOS"))
        : readEnvBool("FILE_UPLOAD_TRANSCODE_VIDEOS", true);

      const fileObj: any = {
        kind,
        originalName: name,
        storedName: path.basename(finalStorageKey),
        mimeType: mime,
        sizeBytes: size,
        widthPx: Number.isFinite(Number(width)) ? Number(width) : null,
        heightPx: Number.isFinite(Number(height)) ? Number(height) : null,
        durationSeconds: Number.isFinite(Number(duration))
          ? Number(duration)
          : null,
        processingStatus: (kind === "video" && !transcodeEnabled) ? "ready" : "pending",
        storageDriver: providerType,
        storageKey: finalStorageKey,
        blurhash: clientWebpThumbBase64 || blurhash || null,
        waveform: waveform
          ? typeof waveform === "string"
            ? waveform
            : JSON.stringify(waveform)
          : null,
        encryptionType:
          encryptionType ||
          encryption_type ||
          process.env.STORAGE_ENCRYPTION_MODE ||
          "remote",
      };

      const targetMsgId = messageId || null;
      let fileId: any = null;
      if (targetMsgId && typeof createMessageFiles === "function") {
        const rawInserted: any = createMessageFiles(targetMsgId, [fileObj]);
        const inserted = rawInserted && typeof rawInserted.then === "function" ? await rawInserted : rawInserted;
        if (Array.isArray(inserted) && inserted[0]?.id) {
          fileId = inserted[0].id;
        } else if (inserted && typeof inserted === "object" && inserted.id) {
          fileId = inserted.id;
        }
      }
      if (!fileId && targetMsgId && typeof adminGetRow === "function") {
        const row: any = await callAdminGetRow(
          "SELECT id FROM chat_message_files WHERE storage_key = $1 ORDER BY id DESC LIMIT 1",
          [finalStorageKey],
        );
        fileId = row?.id || null;
      }

      if (typeof recordPendingPresignedUpload === "function") {
        try {
          recordPendingPresignedUpload({
            storageKey: finalStorageKey,
            userId: session?.userId || null,
          });
        } catch (_) {}
      } else if (typeof adminRun === "function") {
        try {
          await callAdminRun(
            "INSERT INTO pending_presigned_uploads (storage_key, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (storage_key) DO NOTHING",
            [finalStorageKey, session?.userId || null, new Date().toISOString()],
          );
          if (typeof adminSave === "function") adminSave();
        } catch (_) {}
      }

      return res.json({
        success: true,
        type: providerType,
        uploadUrl: uploadResult.uploadUrl,
        storageKey: finalStorageKey,
        fileId,
      });
    } catch (err) {
      return res.status(500).json({
        error: err.message || "Failed to generate presigned upload URL.",
      });
    }
  });

  // POST /api/uploads/complete
  app.post("/api/uploads/complete", async (req, res) => {
    const session: any = await authenticateSession(req, res);
    if (!session) return;

    const { fileId, storageKey } = req.body || {};
    if (!fileId) {
      return res.status(400).json({ error: "fileId is required." });
    }

    let file: any = null;
    if (typeof findMessageFileById === "function") {
      const raw: any = findMessageFileById(fileId);
      file = raw && typeof raw.then === "function" ? await raw : raw;
    }
    if (!file && typeof adminGetRow === "function") {
      file = await callAdminGetRow(
        "SELECT * FROM chat_message_files WHERE id = $1 LIMIT 1",
        [fileId],
      );
    }

    if (!file) {
      return res.status(404).json({ error: "File not found." });
    }

    if (storageKey && file.storage_key && file.storage_key !== storageKey) {
      return res.status(400).json({ error: "Storage key mismatch." });
    }

    if (
      file.message_id &&
      typeof adminGetRow === "function"
    ) {
      const rawMsg: any = callAdminGetRow(
        "SELECT user_id, username FROM chat_messages WHERE id = $1 LIMIT 1",
        [file.message_id],
      );
      const msg = rawMsg && typeof rawMsg.then === "function" ? await rawMsg : rawMsg;
      if (
        msg &&
        msg.user_id &&
        session.userId &&
        msg.user_id !== session.userId
      ) {
        return res.status(403).json({ error: "Access denied." });
      }
    }

    const mode: any = String(
      deps.storageProcessingMode || storageProcessingMode || "auto",
    ).toLowerCase();
    const isVideo: any = String(file.mime_type || file.mimeType || "")
      .toLowerCase()
      .startsWith("video/");

    const transcodeEnabled = deps.getSetting
      ? Boolean(deps.getSetting("FILE_UPLOAD_TRANSCODE_VIDEOS"))
      : readEnvBool("FILE_UPLOAD_TRANSCODE_VIDEOS", true);

    let newStatus = "ready";
    if (transcodeEnabled) {
      if (mode === "remote") {
        newStatus = "pending";
      } else if (isVideo) {
        newStatus = "pending";
      }
    }

    if (typeof adminRun === "function") {
      await callAdminRun(
        "UPDATE chat_message_files SET processing_status = $1 WHERE id = $2",
        [newStatus, fileId],
      );
      if (typeof adminSave === "function") adminSave();
    }

    if (isVideo && transcodeEnabled) {
      dispatchMediaWorkerJob({
        workerUrl:
          (deps.getSetting && deps.getSetting("WORKER_URL")) ||
          deps.workerUrl ||
          deps.mediaWorkerUrl ||
          workerUrl ||
          mediaWorkerUrl ||
          process.env.WORKER_URL ||
          process.env.MEDIA_WORKER_URL ||
          null,
        mediaWorkerUrl:
          (deps.getSetting && deps.getSetting("WORKER_URL")) ||
          deps.workerUrl ||
          deps.mediaWorkerUrl ||
          workerUrl ||
          mediaWorkerUrl ||
          process.env.WORKER_URL ||
          process.env.MEDIA_WORKER_URL ||
          null,
        storageProcessingMode: mode,
        storageProcessingTimeoutMs:
          (deps.getSetting && Number(deps.getSetting("STORAGE_PROCESSING_TIMEOUT_MS"))) ||
          deps.storageProcessingTimeoutMs ||
          (process.env.STORAGE_PROCESSING_TIMEOUT_MS ? Number(process.env.STORAGE_PROCESSING_TIMEOUT_MS) : undefined),
        workerPort: deps.workerPort || process.env.WORKER_PORT || "8080",
        webhookSecret:
          deps.webhookSecret !== undefined
            ? deps.webhookSecret
            : webhookSecret || process.env.WEBHOOK_SECRET || null,
        callbackUrl: deps.webhookCallbackUrl || resolveWebhookCallbackUrl(),
        fileId: file.id || fileId,
        storageKey: file.storage_key || storageKey,
        storedName: file.stored_name || file.storedName,
        mimeType: file.mime_type || file.mimeType || "video/mp4",
        encryptionType: file.encryption_type || file.encryptionType || "none",
        fetchImpl: deps.fetchImpl || globalThis.fetch,
        transcodeEnabled,
      }).catch(() => {});
    }

    if (newStatus === "pending" && mediaQueueManager?.scheduleFallbackCheck) {
      mediaQueueManager.scheduleFallbackCheck({
        fileId,
        storageKey: file.storage_key || storageKey,
      });
    }

    return res.json({
      success: true,
      fileId,
      status: newStatus,
    });
  });

  // GET /api/uploads/thumbs/:fileId — serves video thumbnails.
  app.get("/api/uploads/thumbs/:fileId", async (req, res) => {
    const fileId = req.params?.fileId;
    if (!fileId) return res.status(404).end();

    let file: any = null;
    if (typeof findMessageFileById === "function") {
      const raw: any = findMessageFileById(fileId);
      file = raw && typeof raw.then === "function" ? await raw : raw;
    }
    if (!file && typeof adminGetRow === "function") {
      file = await callAdminGetRow(
        "SELECT * FROM chat_message_files WHERE id = $1 LIMIT 1",
        [fileId],
      );
    }
    if (!file) return res.status(404).end();

    const thumbKey = file.thumb_storage_key || file.thumbStorageKey;
    if (!thumbKey) return res.status(404).end();

    const enc = storageEncryption || defaultStorageEncryption;
    const sendJpeg = (buf) => {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.send(buf);
    };
    // NOTE: filesystem helpers come from deps.* (never shadow node:path).
    const depFs = deps.fs;
    const depPath = deps.path;
    const depUploadRootDir = deps.uploadRootDir;

    // Local disk first (covers local-driver deployments).
    const localPaths: any = [];
    if (depUploadRootDir && depPath && typeof depPath.join === "function") {
      localPaths.push(depPath.join(depUploadRootDir, String(thumbKey)));
      const base =
        typeof depPath.basename === "function"
          ? depPath.basename(String(thumbKey))
          : String(thumbKey).split("/").pop();
      if (base && base !== String(thumbKey)) {
        localPaths.push(depPath.join(depUploadRootDir, base));
      }
    }
    for (const candidate of localPaths) {
      try {
        if (depFs && typeof depFs.existsSync === "function" && depFs.existsSync(candidate)) {
          try {
            return sendJpeg(enc.decryptBuffer(depFs.readFileSync(candidate)));
          } catch (_) {
            return res.status(500).end();
          }
        }
      } catch (_) {
        return res.status(500).end();
      }
    }

    // Remote object storage: fetch + decrypt (no-op for plaintext).
    try {
      if (
        !storageProvider ||
        typeof storageProvider.getDownloadUrl !== "function"
      ) {
        return res.status(404).end();
      }
      const url: any = await storageProvider.getDownloadUrl(thumbKey);
      const fetchImpl = deps.fetch || globalThis.fetch;
      const resp: any = await fetchImpl(url);
      if (!resp || !resp.ok) return res.status(502).end();
      return sendJpeg(enc.decryptBuffer(Buffer.from(await resp.arrayBuffer())));
    } catch (_) {
      return res.status(502).end();
    }
  });

  // POST /api/uploads/webhook/processed
  app.post("/api/uploads/webhook/processed", async (req, res) => {
    const expectedSecret =
      deps.webhookSecret !== undefined ? deps.webhookSecret : webhookSecret;
    if (expectedSecret) {
      const headerSecret = req.headers["x-chatdesk-webhook-secret"];
      if (headerSecret !== expectedSecret) {
        console.warn(
          `[uploads] Rejected webhook for file ${req.body?.fileId ?? "unknown"}: invalid webhook secret.`,
        );
        return res.status(401).json({ error: "Unauthorized webhook request." });
      }
    }

    const {
      fileId,
      status,
      transcodedStorageKey,
      thumbStorageKey,
      width,
      height,
      duration,
    } = req.body || {};
    if (!fileId) {
      return res.status(400).json({ error: "fileId is required." });
    }
    console.log(
      `[uploads] Webhook received for file ${fileId} (status=${status || "ready"}).`,
    );

    let file: any = null;
    if (typeof findMessageFileById === "function") {
      const raw: any = findMessageFileById(fileId);
      file = raw && typeof raw.then === "function" ? await raw : raw;
    }
    if (!file && typeof adminGetRow === "function") {
      file = await callAdminGetRow(
        "SELECT * FROM chat_message_files WHERE id = $1 LIMIT 1",
        [fileId],
      );
    }

    if (!file) {
      console.warn(`[uploads] Webhook for unknown file ${fileId}: ignored.`);
      return res.status(404).json({ error: "File not found." });
    }

    const finalStatus = status || "ready";
    if (typeof adminRun === "function") {
      const setClauses: string[] = ["processing_status = $1"];
      const values: unknown[] = [finalStatus];
      let idx = 2;
      if (transcodedStorageKey) {
        setClauses.push(`storage_key = ${idx++}`, `stored_name = ${idx++}`);
        values.push(transcodedStorageKey, path.basename(transcodedStorageKey));
      }
      if (thumbStorageKey) {
        setClauses.push(`thumb_storage_key = ${idx++}`);
        values.push(thumbStorageKey);
      }
      if (Number.isFinite(Number(width)) && Number(width) > 0) {
        setClauses.push(`width_px = ${idx++}`);
        values.push(Number(width));
      }
      if (Number.isFinite(Number(height)) && Number(height) > 0) {
        setClauses.push(`height_px = ${idx++}`);
        values.push(Number(height));
      }
      if (Number.isFinite(Number(duration)) && Number(duration) >= 0) {
        setClauses.push(`duration_seconds = ${idx++}`);
        values.push(Number(duration));
      }
      values.push(fileId);
      await callAdminRun(
        `UPDATE chat_message_files SET ${setClauses.join(", ")} WHERE id = ${idx}`,
        values,
      );
      if (typeof adminSave === "function") adminSave();
    }

    if (mediaQueueManager?.cancelFallbackCheck) {
      mediaQueueManager.cancelFallbackCheck(fileId);
    }

    let chatId: any = null;
    let messageRow: any = null;
    if (file.message_id && typeof adminGetRow === "function") {
      const rawMsg: any = callAdminGetRow(
        "SELECT * FROM chat_messages WHERE id = $1 LIMIT 1",
        [file.message_id],
      );
      messageRow = rawMsg && typeof rawMsg.then === "function" ? await rawMsg : rawMsg;
      chatId = messageRow?.chat_id || null;
    }

    if (typeof emitChatEvent === "function") {
      if (chatId && file.message_id) {
        const rawFiles = typeof listMessageFilesByMessageIds === "function"
          ? listMessageFilesByMessageIds([file.message_id])
          : [];
        const filesForMessage =
          (rawFiles && typeof rawFiles.then === "function" ? await rawFiles : rawFiles) || [];

        const enc = deps.storageEncryption || defaultStorageEncryption;
        const decryptedBody = enc
          ? enc.decryptText(messageRow?.body || "")
          : messageRow?.body || "";

        const resolvedFiles: any = await Promise.all(
          filesForMessage.map(async (f) => {
            const isTargetFile = String(f.id) === String(fileId);
            const driver = f.storage_driver || f.storageDriver;
            const sKey = (isTargetFile && transcodedStorageKey)
              ? transcodedStorageKey
              : (f.storage_key || f.storageKey);
            const thumbKey = (isTargetFile && thumbStorageKey)
              ? thumbStorageKey
              : (f.thumb_storage_key || f.thumbStorageKey);
            const storedName = f.stored_name || f.storedName || "";
            let fileUrl = storedName ? `/api/uploads/messages/${storedName}` : null;
            let thumbUrl: any = await resolveThumbUrl({
              storageProvider,
              file: f,
              thumbKey,
              fileId: f?.id ?? fileId,
            });
            if (
              (driver === "remote" || driver === "s3") &&
              storageProvider &&
              typeof storageProvider.getDownloadUrl === "function"
            ) {
              if (sKey) {
                try {
                  fileUrl = await storageProvider.getDownloadUrl(sKey);
                } catch (_) {}
              }
            }
            const isThisPending = isTargetFile
              ? finalStatus === "pending"
              : (f.processing_status || f.processingStatus) === "pending";

            const fileWidth = isTargetFile && Number.isFinite(Number(width)) && Number(width) > 0
              ? Number(width)
              : Number.isFinite(Number(f.width_px ?? f.widthPx))
                ? Number(f.width_px ?? f.widthPx)
                : null;
            const fileHeight = isTargetFile && Number.isFinite(Number(height)) && Number(height) > 0
              ? Number(height)
              : Number.isFinite(Number(f.height_px ?? f.heightPx))
                ? Number(f.height_px ?? f.heightPx)
                : null;
            const fileDuration = isTargetFile && Number.isFinite(Number(duration)) && Number(duration) >= 0
              ? Number(duration)
              : Number.isFinite(Number(f.duration_seconds ?? f.durationSeconds))
                ? Number(f.duration_seconds ?? f.durationSeconds)
                : null;

            return {
              id: f.id,
              kind: f.kind,
              name: f.original_name || f.originalName || "",
              mimeType: f.mime_type || f.mimeType || "",
              processing: isThisPending,
              sizeBytes: Number(f.size_bytes || f.sizeBytes || 0),
              width: fileWidth,
              height: fileHeight,
              durationSeconds: fileDuration,
              blurhash: f.blurhash || null,
              expiresAt: f.expires_at || f.expiresAt || null,
              storageDriver: driver || null,
              storageKey: sKey || null,
              thumbStorageKey: thumbKey || null,
              thumbUrl: thumbUrl || null,
              url: fileUrl,
            };
          }),
        );

        emitChatEvent(chatId, {
          type: "chat_message_updated",
          chatId,
          messageId: file.message_id,
          username: messageRow?.username || "",
          userId: messageRow?.user_id || null,
          body: decryptedBody || "",
          files: resolvedFiles,
        });
      }

      emitChatEvent(chatId, {
        type: "video:ready",
        fileId,
        status: finalStatus,
        storageKey: transcodedStorageKey || file.storage_key,
        thumbStorageKey: thumbStorageKey || file.thumb_storage_key,
      });
    }

    console.log(
      `[uploads] Webhook processed file ${fileId}: status=${finalStatus}` +
        (transcodedStorageKey ? ` storageKey=${transcodedStorageKey}` : "") +
        (thumbStorageKey ? ` thumb=${thumbStorageKey}` : ""),
    );
    return res.json({ success: true });
  });

  // POST /api/uploads (fallback multipart upload)
  app.post("/api/uploads", async (req, res) => {
    const session: any = await authenticateSession(req, res);
    if (!session) return;

    if (deps.getSetting && !deps.getSetting("FILE_UPLOAD")) {
      return res
        .status(503)
        .json({ error: "File uploads are disabled on this server." });
    }

    const file = req.file || (Array.isArray(req.files) ? req.files[0] : null);
    const filename =
      req.body?.filename || file?.originalname || file?.name || "upload.bin";
    const mimeType =
      req.body?.contentType ||
      req.body?.mimeType ||
      file?.mimetype ||
      file?.type ||
      "application/octet-stream";
    const fileSize: any = Number(
      req.body?.fileSize || req.body?.size || file?.size || 0,
    );

    const ext: any = path.extname(filename).toLowerCase();
    const generatedKey = `uploads/messages/${Date.now()}_${crypto.randomBytes(8).toString("hex")}${ext}`;

    let kind = "document";
    if (mimeType.startsWith("image/")) kind = "image";
    else if (mimeType.startsWith("video/")) kind = "video";
    else if (mimeType.startsWith("audio/")) kind = "audio";

    const fileObj: any = {
      kind,
      originalName: filename,
      storedName: path.basename(generatedKey),
      mimeType,
      sizeBytes: fileSize,
      widthPx: Number.isFinite(Number(req.body?.width))
        ? Number(req.body?.width)
        : null,
      heightPx: Number.isFinite(Number(req.body?.height))
        ? Number(req.body?.height)
        : null,
      durationSeconds: Number.isFinite(Number(req.body?.duration))
        ? Number(req.body?.duration)
        : null,
      processingStatus: "ready",
      storageDriver: "local",
      storageKey: generatedKey,
      blurhash: req.body?.clientWebpThumbBase64 || req.body?.blurhash || null,
      waveform: req.body?.waveform
        ? typeof req.body.waveform === "string"
          ? req.body.waveform
          : JSON.stringify(req.body.waveform)
        : null,
      encryptionType: "none",
    };

    let inserted: any = null;
    if (typeof createMessageFiles === "function") {
      inserted = createMessageFiles(0, [fileObj]);
    }

    let fileId: any = null;
    if (Array.isArray(inserted) && inserted[0]?.id) {
      fileId = inserted[0].id;
    } else if (inserted && typeof inserted === "object" && inserted.id) {
      fileId = inserted.id;
    } else if (typeof adminGetRow === "function") {
      const row: any = await callAdminGetRow(
        "SELECT id FROM chat_message_files WHERE storage_key = $1 ORDER BY id DESC LIMIT 1",
        [generatedKey],
      );
      fileId = row?.id || 1;
    } else {
      fileId = 1;
    }

    return res.json({
      success: true,
      fileId,
      url: `/api/uploads/file/${fileId}`,
      filename,
      mimeType,
      fileSize,
      waveform: fileObj.waveform,
      blurhash: fileObj.blurhash,
    });
  });

  // GET /api/uploads/file/:id
  app.get("/api/uploads/file/:id", async (req, res) => {
    const idParam = req.params?.id;
    if (!idParam) return res.status(404).end();

    let file: any = null;
    if (typeof findMessageFileById === "function") {
      const raw: any = findMessageFileById(idParam);
      file = raw && typeof raw.then === "function" ? await raw : raw;
    }
    if (!file && typeof adminGetRow === "function") {
      const raw: any = callAdminGetRow(
        "SELECT * FROM chat_message_files WHERE id = $1 OR stored_name = $1 OR storage_key = $1 LIMIT 1",
        [idParam],
      );
      file = raw && typeof raw.then === "function" ? await raw : raw;
    }

    if (!file) return res.status(404).end();

    const driver = file.storage_driver || file.storageDriver;
    if (driver === "s3" || driver === "remote") {
      if (
        !storageProvider ||
        typeof storageProvider.getDownloadUrl !== "function"
      ) {
        return res
          .status(500)
          .json({ error: "Storage provider not available." });
      }

      try {
        const downloadUrl: any = await storageProvider.getDownloadUrl(
          file.storage_key,
        );

        const encType = file.encryption_type || "remote";
        if (
          encType === "remote" ||
          encType === "none" ||
          encType === "provider_sse"
        ) {
          return res.redirect(302, downloadUrl);
        }

        if (
          encType === "local" ||
          encType === "app" ||
          encType === "aes-256-gcm"
        ) {
          const fetchImpl = deps.fetch || globalThis.fetch;
          const resp: any = await fetchImpl(downloadUrl);
          if (!resp.ok) return res.status(resp.status).end();

          const arrayBuf: any = await resp.arrayBuffer();
          const cipherBuf: any = Buffer.from(arrayBuf);
          const decrypted: any = (
            deps.storageEncryption || defaultStorageEncryption
          ).decryptBuffer(cipherBuf);

          if (file.mime_type) res.type(file.mime_type);
          return res.send(decrypted);
        }

        return res.redirect(302, downloadUrl);
      } catch (err) {
        return res
          .status(500)
          .json({ error: err.message || "Download failed." });
      }
    }

    // Local storage driver
    if (file.mime_type) res.type(file.mime_type);
    return res.status(200).send("OK");
  });
}

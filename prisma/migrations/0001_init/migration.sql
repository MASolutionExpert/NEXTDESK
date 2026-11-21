-- NextDesk PostgreSQL Baseline Migration (Prisma 7)
-- Safe & non-destructive: uses IF NOT EXISTS so existing live databases are never dropped or truncated.

CREATE TABLE IF NOT EXISTS "meta" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "meta_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "app_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "departments" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "active" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "nickname" TEXT,
    "avatar_url" TEXT,
    "avatar_storage_driver" TEXT DEFAULT 'local',
    "avatar_storage_key" TEXT,
    "avatar_encryption_type" TEXT DEFAULT 'none',
    "color" TEXT,
    "status" TEXT NOT NULL DEFAULT 'online',
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "banned" INTEGER NOT NULL DEFAULT 0,
    "verified" INTEGER NOT NULL DEFAULT 0,
    "department_id" INTEGER,
    "language" TEXT NOT NULL DEFAULT 'fa',
    "created_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    "last_seen" TEXT,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chats" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "type" TEXT NOT NULL DEFAULT 'dm',
    "group_username" TEXT,
    "group_visibility" TEXT NOT NULL DEFAULT 'public',
    "invite_token" TEXT,
    "created_by_user_id" TEXT,
    "group_color" TEXT,
    "allow_member_invites" INTEGER NOT NULL DEFAULT 1,
    "group_avatar_url" TEXT,
    "verified" INTEGER NOT NULL DEFAULT 0,
    "auto_add_new_users" INTEGER NOT NULL DEFAULT 0,
    "department_id" INTEGER,
    "created_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    CONSTRAINT "chats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chat_members" (
    "chat_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    CONSTRAINT "chat_members_pkey" PRIMARY KEY ("chat_id", "user_id"),
    CONSTRAINT "chat_members_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "chat_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "chat_left_members" (
    "chat_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "left_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    CONSTRAINT "chat_left_members_pkey" PRIMARY KEY ("chat_id", "user_id"),
    CONSTRAINT "chat_left_members_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "chat_left_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "chat_messages" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "client_request_id" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    "read_at" TEXT,
    "read_by_user_id" TEXT,
    "reply_to_message_id" TEXT,
    "edited" INTEGER NOT NULL DEFAULT 0,
    "edited_body" TEXT,
    "hidden_everyone_at" TEXT,
    "forwarded_from_chat_id" TEXT,
    "forwarded_from_label" TEXT,
    "forwarded_from_user_id" TEXT,
    "forwarded_from_username" TEXT,
    "forwarded_from_avatar_url" TEXT,
    "forwarded_from_color" TEXT,
    "expires_at" TEXT,
    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "chat_message_files" (
    "id" SERIAL NOT NULL,
    "message_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "stored_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width_px" INTEGER,
    "height_px" INTEGER,
    "duration_seconds" DOUBLE PRECISION,
    "expires_at" TEXT,
    "storage_driver" TEXT DEFAULT 'local',
    "storage_key" TEXT,
    "processing_status" TEXT DEFAULT 'ready',
    "blurhash" TEXT,
    "waveform" TEXT,
    "thumb_storage_key" TEXT,
    "encryption_type" TEXT DEFAULT 'none',
    "created_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    CONSTRAINT "chat_message_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_message_files_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "chat_message_reads" (
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    CONSTRAINT "chat_message_reads_pkey" PRIMARY KEY ("message_id", "user_id"),
    CONSTRAINT "chat_message_reads_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "chat_message_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "hidden_chat_messages" (
    "user_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "hidden_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    CONSTRAINT "hidden_chat_messages_pkey" PRIMARY KEY ("user_id", "message_id"),
    CONSTRAINT "hidden_chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "hidden_chat_messages_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "hidden_chats" (
    "user_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "hidden_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    CONSTRAINT "hidden_chats_pkey" PRIMARY KEY ("user_id", "chat_id"),
    CONSTRAINT "hidden_chats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "hidden_chats_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "chat_mutes" (
    "user_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "muted" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    CONSTRAINT "chat_mutes_pkey" PRIMARY KEY ("user_id", "chat_id"),
    CONSTRAINT "chat_mutes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "chat_mutes_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "group_removed_members" (
    "chat_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "removed_by_user_id" TEXT NOT NULL,
    "removed_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    CONSTRAINT "group_removed_members_pkey" PRIMARY KEY ("chat_id", "user_id"),
    CONSTRAINT "group_removed_members_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "group_removed_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "group_removed_members_removed_by_user_id_fkey" FOREIGN KEY ("removed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "sessions" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    "last_seen" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT,
    "auth" TEXT,
    "message_preview" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT DEFAULT (CURRENT_TIMESTAMP::text),
    "updated_at" TEXT DEFAULT (CURRENT_TIMESTAMP::text),
    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "remote_channel_sources" (
    "id" SERIAL NOT NULL,
    "chat_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'telegram',
    "source_raw" TEXT,
    "source_url" TEXT,
    "source_chat_id" TEXT,
    "source_username" TEXT,
    "source_title" TEXT,
    "source_avatar_url" TEXT,
    "last_remote_message_id" INTEGER,
    "source_version" INTEGER NOT NULL DEFAULT 1,
    "sync_metadata" INTEGER NOT NULL DEFAULT 0,
    "stream_media" INTEGER NOT NULL DEFAULT 0,
    "enabled" INTEGER NOT NULL DEFAULT 0,
    "paused" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_seen_at" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    "updated_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    CONSTRAINT "remote_channel_sources_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "remote_channel_sources_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "remote_channel_queue" (
    "id" SERIAL NOT NULL,
    "source_id" INTEGER NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'telegram',
    "telegram_update_id" INTEGER,
    "telegram_message_id" INTEGER,
    "source_version" INTEGER NOT NULL DEFAULT 1,
    "payload_json" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TEXT,
    "locked_at" TEXT,
    "lock_owner" TEXT,
    "last_error" TEXT,
    "created_message_id" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    "processed_at" TEXT,
    CONSTRAINT "remote_channel_queue_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "remote_channel_queue_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "remote_channel_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "remote_channel_provider_state" (
    "provider" TEXT NOT NULL,
    "next_update_offset" INTEGER,
    "last_error" TEXT,
    "last_polled_at" TEXT,
    "updated_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    CONSTRAINT "remote_channel_provider_state_pkey" PRIMARY KEY ("provider")
);

CREATE TABLE IF NOT EXISTS "pending_presigned_uploads" (
    "storage_key" TEXT NOT NULL,
    "user_id" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    "expires_at" TEXT,
    CONSTRAINT "pending_presigned_uploads_pkey" PRIMARY KEY ("storage_key")
);

CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
    "id" SERIAL NOT NULL,
    "ts" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    "actor_user_id" TEXT,
    "actor_username" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_label" TEXT,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'success',
    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_departments_active" ON "departments"("active");

CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users"("username");
CREATE INDEX IF NOT EXISTS "idx_users_created_at" ON "users"("created_at");
CREATE INDEX IF NOT EXISTS "idx_users_department" ON "users"("department_id");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_chats_group_username" ON "chats"("group_username");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_chats_invite_token" ON "chats"("invite_token");
CREATE INDEX IF NOT EXISTS "idx_chats_type" ON "chats"("type");
CREATE INDEX IF NOT EXISTS "idx_chats_department" ON "chats"("department_id");

CREATE INDEX IF NOT EXISTS "idx_members_user" ON "chat_members"("user_id");
CREATE INDEX IF NOT EXISTS "idx_chat_members_user_chat" ON "chat_members"("user_id", "chat_id");

CREATE INDEX IF NOT EXISTS "idx_chat_left_members_user" ON "chat_left_members"("user_id", "chat_id");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_chat_messages_client_request" ON "chat_messages"("chat_id", "user_id", "client_request_id");
CREATE INDEX IF NOT EXISTS "idx_messages_chat_time" ON "chat_messages"("chat_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_messages_reply_to" ON "chat_messages"("reply_to_message_id");
CREATE INDEX IF NOT EXISTS "idx_chat_messages_hidden_everyone" ON "chat_messages"("hidden_everyone_at");
CREATE INDEX IF NOT EXISTS "idx_chat_messages_forwarded_from_chat" ON "chat_messages"("forwarded_from_chat_id");
CREATE INDEX IF NOT EXISTS "idx_chat_messages_forwarded_from_user" ON "chat_messages"("forwarded_from_user_id");
CREATE INDEX IF NOT EXISTS "idx_chat_messages_expires_at" ON "chat_messages"("expires_at");
CREATE INDEX IF NOT EXISTS "idx_chat_messages_chat_id_id" ON "chat_messages"("chat_id", "id" DESC);
CREATE INDEX IF NOT EXISTS "idx_chat_messages_chat_user_id_id" ON "chat_messages"("chat_id", "user_id", "id" DESC);
CREATE INDEX IF NOT EXISTS "idx_chat_messages_chat_hidden_id" ON "chat_messages"("chat_id", "hidden_everyone_at", "id" DESC);
CREATE INDEX IF NOT EXISTS "idx_chat_messages_chat_created_id" ON "chat_messages"("chat_id", "created_at" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "idx_chat_messages_created_at" ON "chat_messages"("created_at");

CREATE INDEX IF NOT EXISTS "idx_message_files_message_id" ON "chat_message_files"("message_id");

CREATE INDEX IF NOT EXISTS "idx_message_reads_message" ON "chat_message_reads"("message_id");
CREATE INDEX IF NOT EXISTS "idx_message_reads_user" ON "chat_message_reads"("user_id");
CREATE INDEX IF NOT EXISTS "idx_message_reads_user_message" ON "chat_message_reads"("user_id", "message_id");

CREATE INDEX IF NOT EXISTS "idx_hidden_chat_messages_user" ON "hidden_chat_messages"("user_id");
CREATE INDEX IF NOT EXISTS "idx_hidden_chat_messages_message" ON "hidden_chat_messages"("message_id");
CREATE INDEX IF NOT EXISTS "idx_hidden_chat_messages_user_message" ON "hidden_chat_messages"("user_id", "message_id");

CREATE INDEX IF NOT EXISTS "idx_chat_mutes_chat_user" ON "chat_mutes"("chat_id", "user_id");

CREATE INDEX IF NOT EXISTS "idx_group_removed_members_user" ON "group_removed_members"("user_id", "chat_id");

CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_key" ON "sessions"("token");
CREATE INDEX IF NOT EXISTS "idx_sessions_token" ON "sessions"("token");

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

CREATE UNIQUE INDEX IF NOT EXISTS "remote_channel_sources_chat_id_key" ON "remote_channel_sources"("chat_id");
CREATE INDEX IF NOT EXISTS "idx_remote_channel_sources_provider_enabled" ON "remote_channel_sources"("provider", "enabled");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_remote_channel_queue_source_update" ON "remote_channel_queue"("source_id", "source_version", "telegram_update_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_remote_channel_queue_source_message" ON "remote_channel_queue"("source_id", "source_version", "telegram_message_id");
CREATE INDEX IF NOT EXISTS "idx_remote_channel_queue_status_next" ON "remote_channel_queue"("status", "next_attempt_at", "created_at");
CREATE INDEX IF NOT EXISTS "idx_remote_channel_queue_claim" ON "remote_channel_queue"("provider", "status", "next_attempt_at", "created_at", "id");
CREATE INDEX IF NOT EXISTS "idx_remote_channel_queue_processing_lock" ON "remote_channel_queue"("status", "locked_at");
CREATE INDEX IF NOT EXISTS "idx_remote_channel_queue_source_status" ON "remote_channel_queue"("source_id", "status");

CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_ts" ON "admin_audit_logs"("ts" DESC);
CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_action" ON "admin_audit_logs"("action");

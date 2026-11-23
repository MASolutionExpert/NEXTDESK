-- Non-destructive migration: add chats.channel to strictly separate direct vs support threads
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'direct';

-- Backfill existing department-tagged DMs as support threads
UPDATE "chats"
SET "channel" = 'support'
WHERE "type" = 'dm'
  AND "department_id" IS NOT NULL
  AND COALESCE("channel", 'direct') = 'direct';

CREATE INDEX IF NOT EXISTS "idx_chats_channel" ON "chats"("channel");

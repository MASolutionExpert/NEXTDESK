#!/bin/sh
set -e

WORKER_PORT="${WORKER_PORT:-8080}"
STORAGE_PROCESSING_MODE="${STORAGE_PROCESSING_MODE:-auto}"
START_LOCAL_WORKER="${START_LOCAL_WORKER:-auto}"
FILE_UPLOAD_TRANSCODE_VIDEOS="${FILE_UPLOAD_TRANSCODE_VIDEOS:-true}"
WORKER_URL="${WORKER_URL:-${MEDIA_WORKER_URL:-}}"
AUTO_MIGRATE_ON_START="${AUTO_MIGRATE_ON_START:-true}"

should_start_local_worker() {
  if [ "$START_LOCAL_WORKER" = "false" ]; then
    return 1
  fi
  if [ "$START_LOCAL_WORKER" = "true" ]; then
    return 0
  fi
  if [ "$FILE_UPLOAD_TRANSCODE_VIDEOS" = "false" ] || [ "$FILE_UPLOAD_TRANSCODE_VIDEOS" = "0" ] || [ "$FILE_UPLOAD_TRANSCODE_VIDEOS" = "no" ] || [ "$FILE_UPLOAD_TRANSCODE_VIDEOS" = "off" ]; then
    return 1
  fi
  if [ "$STORAGE_PROCESSING_MODE" = "remote" ]; then
    return 1
  fi
  if [ "$STORAGE_PROCESSING_MODE" = "local" ] || [ "$STORAGE_PROCESSING_MODE" = "auto" ]; then
    return 0
  fi
  case "$WORKER_URL" in
    *127.0.0.1*|*localhost*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

DATA_DIR="${DATA_DIR:-/app/data}"
mkdir -p "${DATA_DIR}/uploads/messages" "${DATA_DIR}/uploads/avatars" "${DATA_DIR}/backups" 2>/dev/null || true

# Run safe, non-destructive Prisma 7 PostgreSQL migrations before launching the server.
if [ "$AUTO_MIGRATE_ON_START" != "false" ] && [ "$1" = "node" ] && [ -f /app/src/server/scripts/migrate.ts ]; then
  echo "[entrypoint] Running safe PostgreSQL + Prisma 7 migrations..."
  node /app/src/server/scripts/migrate.ts --allow-online
fi

if should_start_local_worker; then
  echo "[entrypoint] Starting local NextDesk Media Worker on port ${WORKER_PORT}..."
  WORKER_PORT="${WORKER_PORT}" PORT="${WORKER_PORT}" DATA_DIR="${DATA_DIR}" node /app/worker/index.ts &
fi

exec "$@"

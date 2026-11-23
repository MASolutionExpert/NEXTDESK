# Changelog

All notable changes to **NextDesk** are documented in this file.

## 2.0.0-dev.2026112304

### Added
- **Direct vs. Support Channel Separation & `ChannelBadge`**: added a persisted `chats.channel` column (`direct` | `support`) via Prisma migration `0002_chat_channel` so regular messenger DMs and helpdesk support threads stay strictly separated, accompanied by the LTR-pinned `ChannelBadge` across chat lists, headers, message bubbles, and the admin Chats tab (with channel filtering and department names).
- **Per-Thread Files Gallery & Full-History Search**: added member-only `GET /api/chats/:chatId/files` (with presigned remote URLs and thumbnail resolution) and `GET /api/chats/:chatId/search` (chunked scan decrypting at-rest messages across text, edited text, and attachment filenames), plus `ChatFilesModal`, `ChatSearchModal`, and jump-to-message scroll + highlight flash from `ChatProfileModal`.
- **Admin Call History Report & One-Click TURN Setup**: added admin-only `GET /api/admin/calls` and a dedicated **Call history** sub-view inside the admin Chats tab (search, voice/video type filter, outcome filter, sortable columns, pagination, EN/FA i18n), plus `scripts/setup-turn.sh` for one-click coturn deployment and `.env` wiring.
- **Read-Only Search Diagnostics (`npm run search:doctor`)**: added a strictly read-only CLI diagnostic tool (`src/server/scripts/search-doctor.ts`) to inspect user search normalization and case-insensitive matching against PostgreSQL.

### Changed
- **Moderator-Only Edit & Delete Policy with Audit Trail**: enforced server-side moderator role checks (`owner` | `admin` | `operator`) on message edits, message deletions (both `self` and `everyone`, allowing moderators to remove any participant's message inside chats they belong to), and DM/support thread hiding, while recording `message.delete.everyone`, `message.delete.self`, `thread.delete`, and `chat.delete` in `admin_audit_logs`.

### Fixed
- **WebRTC Call Stability & Failure Diagnostics**:
  - Externalized `callManager` timers (`ringTimers`, `maxDurationTimers`, `bothOfflineSince`) so active call objects serialize cleanly without circular-JSON 500 errors when `CALL_MAX_DURATION` is enabled.
  - Added 60-second server ring timeout (`missed` outcome + push dismissal), cross-session `call:ring-ended` broadcasts, `409 callee_busy` pre-check, caller redial resume, 30-second stale-call reaper with 45-second offline grace window and 12-hour lifetime cap, last-session-only WebSocket disconnect cleanup, and `call:error` feedback on failed signal relays.
  - Added 1 automatic client ICE restart with a 10-second recovery window, verified HTTP/WS signal delivery, structured media/server/signaling/ICE failure diagnostics (with TURN hints shown only for genuine ICE failures), and full bilingual (FA/EN) call status and call-log labels (`outgoing`, `connected`, `cancelled`, `declined`, `missed`, `failed`).
- **User Search & `@` Prefix Normalization**: fixed case-insensitive user search and stripped leading `@` characters in server queries and client search hooks; removed the `dmUsernames` filter so existing contacts remain searchable when starting or revisiting a chat.
- **Mobile Overlay Back-Button Navigation (`useOverlayBack`)**: rewrote `useOverlayBack` with a module-level sentinel registry, deferred 1-tick close-pop verification, and sibling-overlay `popstate` guards to prevent accidental app exits or broken modal dismissal.

## 2.0.0-dev.2026112303

### Fixed

- **Installer Monolith Alignment (`scripts/install.sh`)**: fixed legacy `$INSTALL_DIR/server` directory checks and unconditional `npm --prefix server install` calls that did not match NextDesk's unified TypeScript monolith layout (`package.json` + `src/server/`). `run_migrations`, `backup_database`, `restore_database`, `db_doctor`, VAPID key generation, offline zip validation, and `db:doctor` diagnostic hints now target the unified monolith root cleanly.
- **Installer Streaming Log Permissions**: `ensure_log_dir` now hands ownership of the install log file to the invoking `SUDO_USER`, and `run_in_install_dir_streaming` falls back gracefully to `sudo -n tee` (or direct terminal output) so live migration streaming never fails with `Permission denied`.
- **PostgreSQL SSL Precedence (`POSTGRES_SSL=true` vs `sslmode=`)**: `POSTGRES_SSL=true` is now applied to `DATABASE_URL`/`POSTGRES_URL` connections (supporting self-signed Postgres servers) only when the URL has no explicit `sslmode=` parameter; any explicit `sslmode=` inside the URL always takes precedence, and `describePgTarget()` reflects the effective TLS state accurately.
- **Migration Watchdog (`DB_MIGRATION_TIMEOUT_MS=0`)**: explicit `DB_MIGRATION_TIMEOUT_MS=0` now truly disables the per-migration watchdog as documented, while blank or unset values safely fall back to the 120s default. `prisma migrate deploy` now streams output live with elapsed timing and a clear timeout error if aborted.
- **Pre-Migration `pg_dump` Backup Hardening**: `createPostgresPreMigrationBackup()` now defaults `DB_BACKUP_TIMEOUT_MS` to 120s with `PGCONNECT_TIMEOUT` and `PGSSLMODE` support, warns cleanly if `pg_dump` is not installed (without blocking), and removes any partial dump file on timeout or failure.
- **GitHub Update Check Pagination**: `fetchLatestGitHubTag()` now paginates up to 3×100 tags (stopping early when fewer than 100 tags are returned) so newer releases are never missed on repositories with long tag histories.

### Improved

- **3-Probe PostgreSQL Connectivity Preflight**: `runPostgresPreflight()` now performs up to 3 quick `SELECT 1` probes (failing immediately on non-retryable auth/database/SSL errors) with root-cause classification (`connection_refused`, `dns`, `auth`, `missing_database`, `ssl`, `timeout`), latency measurement, and password-redacted target reporting.
- **Strictly Read-Only `db:doctor` Diagnostics**: `npm run db:doctor` now measures connection latency, compares `prisma/migrations/` on disk against `_prisma_migrations` to report pending or failed migrations accurately, detects leftover temporary rebuild tables, and reports PostgreSQL server version, database size, active connections, and blocking lock waits — without mutating the database.
- **Environment Documentation & Tests**: documented all PostgreSQL timeout and migration hardening variables in `.env.example` and added unit, server, and Bats test coverage.

## 2.0.0-dev.2026112301

- **100% Pure NextDesk Brand & Codebase Independence**: removed all remaining legacy brand references (`ChatDesk`, `Songbird` / `سانگبرد`) across backend, frontend, media worker, tests, installer/CLI (`nextdesk-deploy`, `# nextdesk-deploy-version:`), Docker/Nginx/Ansible/Railway/Render configs, GitHub workflows, and English/Persian documentation.
- **License Cleanup**: removed the legacy `LICENSE` file and legacy MIT license metadata from `package.json`, `worker/package.json`, and README files.

## 2.0.0-dev.2026112107

- **Clean TypeScript Build (`tsc --noEmit`)**: aligned `runDatabaseMigrations` option types (`backupBeforeMigrate`, `quiet`), `MigrateDatabaseResult.baselinedLegacyDb`, and `runPostgresPreflight()` signature across scripts and DB integration tests.

## 2.0.0-dev.2026112106

- **100% PostgreSQL Server Test Alignment**: updated the final legacy SQLite `INSERT OR IGNORE` assertion in `test/server/api/adminDbTools.test.ts` to PostgreSQL `ON CONFLICT DO NOTHING`, bringing all 112 server test suites (957 tests) to green against PostgreSQL 17 + Prisma 7.

## 2.0.0-dev.2026112105

- **Async Admin Helper Fix**: marked `resolveUserId` as `async` and awaited its calls in `src/server/api/admin.ts` for PostgreSQL query compatibility under Node 24 native TypeScript execution.

## 2.0.0-dev.2026112104

- **Final PostgreSQL + Prisma 7 Server Verification Fixes**: restored `createUser(username, passwordHash, nickname?, ...)` signature order in `src/server/db/usersRepo.ts`, removed duplicate `adminTransaction` import in `src/server/index.ts`, fixed template literal quoting on two `INSERT INTO users` statements, and aligned normalized timestamp format in `test/server/db/prisma.test.ts`.

## 2.0.0-dev.2026112103

- **PostgreSQL + Prisma 7 CI Stabilization**: fixed SQL template literal escaping for UTC ISO timestamps across admin routes and CLI scripts, removed duplicate `adminTransaction` destructuring, standardized `?` placeholders across unit-tested helpers (`secrets.ts`, `dbToolHelpers.ts`, `inspect.ts`, `_addChatMemberLogic.ts`), aligned `db-doctor.ts` diagnostics metadata, and moved Prisma CLI npm aliases to `prisma:*` to satisfy the privileged `db:*` launcher policy.

## 2.0.0-dev.2026112102

- **Single-Database PostgreSQL + Prisma 7 ORM Architecture**: completely removed dual-database branching, SQLite (`better-sqlite3`, `sql.js`), `knex`, and `sqlNormalizer.ts`. NextDesk now runs exclusively on **PostgreSQL** via **Prisma 7** (`prisma@7.10.1`, `@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1`, `pg@8.23.1`) with a pure-TypeScript, Rust-free generated client (`provider = "prisma-client"`) and `globalThis`-cached `pg.Pool` connection pooling.
- **Safe, Non-Destructive Live Database Migration Layer**: introduced `prisma/schema.prisma`, `prisma.config.ts`, baseline `prisma/migrations/0001_init/migration.sql`, and `src/server/db/migrate.ts`. On every install, update, Docker container start, and server boot, migrations run automatically with best-effort `pg_dump` backup, idempotent additive column guards, safe baselining (`prisma migrate resolve --applied`), and `prisma migrate deploy` — never dropping tables or destroying live data.
- **Modular TypeScript Repositories & Pooled Transaction Safety**: split database access into dedicated TypeScript repository modules (`usersRepo.ts`, `chatsRepo.ts`, `messagesRepo.ts`, `remoteChannelsRepo.ts`, `adminRepo.ts`) and replaced raw pooled `BEGIN`/`COMMIT` calls with dedicated-client `withPgTransaction` / `adminTransaction` across API routes, background jobs, and all 30 CLI scripts.
- **PostgreSQL-Only Admin Panel, Installer, Docker & Real PostgreSQL 17 CI**: simplified Admin Panel maintenance and service health cards, updated `docker-compose.yaml` (PostgreSQL 17 service with persistent volume and healthcheck), `Dockerfile`, `scripts/docker-entrypoint.sh`, `scripts/install.sh`, and GitHub Actions CI (`postgres:17-alpine` service container running live Prisma 7 migrations and the full server test suite).

## 2.0.0-dev.2026112101

- **100% Pure TypeScript + Unified Full-Stack Next.js 16 Monolith**: migrated the entire codebase across frontend (`src/`), backend (`src/server/`), tests (`test/` & `test/server/`), media worker (`worker/`), docs (`docs/.vitepress/`), and root configs (`server.ts`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.ts`, `postcss.config.json`, `release.config.ts`) to TypeScript — **0 JavaScript files remaining anywhere in the repository**.
- **Latest Stable Stack**: upgraded runtime to **Next.js 16.4.6 (Turbopack)**, **React 19.3.1**, **Tailwind CSS 4.3.5**, **TypeScript 5.9.3**, **Vitest 5.1.1**, **Express 5.3**, **better-sqlite3 13.2**, **bullmq 6.7**, and **web-push 4.0** running natively on **Node.js 24** (`node server.ts`).
- **Next.js 16 + Dual-Database Hardening**: configured `serverExternalPackages` in `next.config.ts` for native SQLite/PostgreSQL/WebSocket modules, added Next.js-safe `globalThis` singleton pooling in `src/server/db/knex.ts`, and aligned `application_name: "nextdesk"` across PostgreSQL URL and parts modes.
- **Persistent Media & Data Storage Hardening**: added `ENV DATA_DIR=/app/data`, pre-created `/app/data/uploads/messages`, `/app/data/uploads/avatars`, and `/app/data/backups`, declared `VOLUME ["/app/data"]` in `Dockerfile`, and ensured `scripts/docker-entrypoint.sh` initializes persistent storage directories on every boot so media and databases survive container restarts and rebuilds.
- **Native Next.js 16 Service Worker**: replaced static `public/sw.js` with App Router Route Handler `src/app/sw.js/route.ts` featuring `/_next/static/` & `/fonts/` caching and automatic legacy cache cleanup.
- **Sortable `dev` Release Versioning**: standardized `dev` prereleases to **`X.Y.Z-dev.YYYYMMDDNN`** (strictly ordered both alphabetically on GitHub and numerically in SemVer/CLI updater).
- **Full Repository & Brand Cleanup**: removed dead Vite leftover directory (`src/assets/`), removed stale `docs/public/CNAME`, renamed brand assets to `nextdesk-logo.svg` / `nextdesk-hero.svg`, cleaned `.gitignore`/`.dockerignore`/GitHub workflows, and updated all documentation (`README.md`, `README.fa_IR.md`, `AGENTS.md`, `DESIGN.md`, `ACCESSIBILITY.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and bilingual `docs/`) to **NextDesk**.
- **Bug Fixes**: resolved shadowed `globalThis.File` bug in `MessageComposer.tsx`, `web-push` v4 ESM named exports, monolith `sql.js` WASM resolution, and achieved **0 TypeScript errors** (`tsc --noEmit`) + **0 ESLint errors** + **1,138/1,138 passing server tests**.

## 1.1.0

- First independent stable baseline of **NextDesk** (`MASolutionExpert/NEXTDESK`) on `main` with hardened two-channel release pipeline (`dev` prereleases vs frozen `main` stable), PostgreSQL fail-fast timeout protection, pre-migration backups, `db:doctor`, and self-healing CLI updater.

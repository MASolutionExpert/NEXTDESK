# Changelog

All notable changes to ChatDesk are documented in this file.

## 2.0.0-dev.7

- Fixed shadowed `globalThis.File` bug in `src/components/chat/messages/MessageComposer.tsx` (previously shadowed by `File` icon import from `lucide.ts`) caught by full TypeScript `tsc --noEmit` verification.
- Resolved all remaining third-party `@types/*` mismatches across `src/` (`bucketCors`, `webhookUrl`, `turnHealth`, `redis`, `websocketGateway`, `markdown`, `adminRemoteChannel`, `configure-remote-channel`) and Vitest 5 / Knex mock typings in `test/` so `tsc --noEmit` passes with 0 errors across the entire 530-file pure TypeScript monolith.

## 2.0.0-dev.6

- Resolved `sql.js` WASM asset path in unified monolith (`src/server/db.ts` and `src/server/scripts/_db-admin.ts`) from root `node_modules` (`projectRootDir`) instead of legacy `server/node_modules`.
- Fixed Vitest 5 `benchmark` config placement inside `test` block in `vitest.config.ts` and `worker/vitest.config.ts`, and narrowed `res.Body` stream type in `worker/storage.ts` for strict `tsc --noEmit`.
- Updated `test/server/scripts/backupDb.test.ts` dynamic import path to `settings/env.ts` and aligned `callManager` declaration in `src/server/index.ts`.
- Removed tracked `tsconfig.tsbuildinfo` and added `*.tsbuildinfo` to `.gitignore` so server updates never conflict on TypeScript incremental cache files.

## 2.0.0-dev.5

- **100% Pure TypeScript + Unified Full-Stack Next.js 16 Monolith**: converted every single `.js`, `.jsx`, and `.mjs` file across frontend (`src/`), backend (`src/server/`), tests (`test/` & `test/server/`), worker (`worker/`), docs (`docs/.vitepress/`), and root configs (`server.ts`, `next.config.ts`, `vitest.config.ts`, `eslint.config.ts`, `release.config.ts`, `tsconfig.json`, `postcss.config.json`) to TypeScript — **0 JavaScript files remaining anywhere in the repository**.
- **Single Unified Monolith**: merged `server/` into `src/server/` and consolidated all frontend, backend, database, realtime, TypeScript, ESLint, and Vitest dependencies + all 28 `db:*` CLI scripts into one root `package.json`, executed natively by Node.js 24 (`node server.ts`).
- Moved PWA Service Worker from `public/sw.js` to a native Next.js 16 App Router Route Handler (`src/app/sw.js/route.ts`) with `/_next/static/` caching support.
- Added shared full-stack domain TypeScript interfaces (`src/types/index.ts`), `typescript@^5.9.3`, `typescript-eslint@^8.73.0`, `jiti@^2.7.0`, and full `tsc --noEmit` CI verification in `.github/workflows/build.yml`.
- Updated `Dockerfile`, `worker/Dockerfile`, `scripts/install.sh`, `scripts/run-data-command.sh`, `scripts/docker-entrypoint.sh`, bats tests, `AGENTS.md`, `DESIGN.md`, `README.md`, and `README.fa_IR.md` for the pure TypeScript monolith.

## 2.0.0-dev.4

- Updated `web-push` v4 ESM imports in `server/index.js` and `server/lib/secrets.js` (`import * as webpush from "web-push"`) for native `web-push@^4.0.0` named-export compatibility.

## 2.0.0-dev.3

- Upgraded full-stack runtime to **Next.js 16 (`^16.4.6`)** with Turbopack production builds, **React 19.3 (`^19.3.1`)**, **Tailwind CSS 4.3 (`^4.3.5`)**, **Vitest 5.1 (`^5.1.1`)**, and latest stable packages across root, `server/`, and `worker/` (`bullmq@^6.7.8`, `better-sqlite3@^13.2.0`, `web-push@^4.0.0`, `ws@^8.23.0`, `@aws-sdk/client-s3@^3.1173.0`, `lucide-react@^1.77.0`, `marked@^18.2.1`, `dompurify@^3.4.18`, `undici@^8.13.0`, `express-rate-limit@^8.7.5`, `sql.js@^1.17.0`).
- Removed deprecated `eslint` config key from `next.config.mjs` (removed in Next.js 16) and integrated `@next/eslint-plugin-next@^16.4.6` directly into flat `eslint.config.mjs`.
- Scoped Express JSON body parsing to `/api` and excluded `/_next/*` from Express compression middleware so Next.js 16 App Router streams and HMR operate natively without double-buffering.
- Updated `AGENTS.md`, `DESIGN.md`, `README.md`, and `README.fa_IR.md` to reflect the Next.js 16 + React 19.3 + Tailwind CSS 4.3 stack.

## 2.0.0-dev.2

- Fixed client unit test suite (`test/utils/versioning.test.js`) by replacing unimported `it(...)` with `test(...)`.
- Fixed `server/test/serverBoot.test.js` to run isolated backend boot with `NEXTDESK_API_ONLY=true` and match the NextDesk server startup log.
- Updated `server/test/db/databaseHardening.test.js` to assert the fixed `DB_MIGRATION_TIMEOUT_MS=0` watchdog-disable behavior and to verify both read-only uninitialized diagnostics and healthy migrated SQLite diagnostics for `db:doctor`.
- Updated GitHub Action versions in `codeql.yml` and `docker.yml` (`@v4`/`@v3`/`@v5`/`@v6`) and limited automatic Docker release builds to non-prerelease `released` events.

## 2.0.0-dev.1

### New
- ⚡ **Full-Stack Next.js 15 Architecture (1:1 migration)**: replaced the separate Vite SPA with a unified Full-Stack **Next.js 15 App Router** application (`src/app/`, `src/components/`, `src/views/`, `src/hooks/`, `src/i18n/`, `src/utils/`, `public/`, `next.config.mjs`) coupled with the unified Node HTTP + Express 5 + SSE + WebSocket (`/ws`) server entrypoint (`server.mjs`).
- 🔄 **Zero Logic Loss**: preserved every single feature, route (`/`, `/login`, `/signup`, `/chat`, `/admin`, `/departments`, `/invite/[token]`), 43 database migrations, Helpdesk department routing, WebRTC voice/video calls, BullMQ media worker, Remote Channels, Persian/English i18n, PWA service worker, and all unit/integration tests verbatim.
- 🧰 **Installer, Docker, CI/CD & Docs synced to NextDesk**: updated `scripts/install.sh` (`nextdesk-deploy` + backwards-compatible `chatdesk-deploy`), `Dockerfile`, `docker-compose.yaml`, `.github/workflows/build.yml`, `AGENTS.md`, `DESIGN.md`, `README.md`, and `README.fa_IR.md` for unified Next.js builds (`npm run build` / `node server.mjs`).

## 1.1.0-dev.11

### Fixed
- 🔢 SemVer prerelease comparison in both server (`appMeta.js`) and client (`versioning.js`): numeric identifiers now compare numerically (`1.1.0-dev.10 > 1.1.0-dev.9`) and GitHub tag lookup requests up to 100 tags.
- 🧰 Installer/CLI (`scripts/install.sh`): replaced raw `dpkg --compare-versions` with pure-Bash SemVer 2.0.0 comparator so `1.1.0 > 1.1.0-dev.10 > 1.1.0-dev.9` always holds; fixed `run_in_install_dir_streaming` log permissions under `sudo`; fixed `write_install_config` and `install_global_command_from_remote` to preserve the active branch; added `--finalize-update` self-handoff so new installer logic runs immediately on the first update; added lockfile protection before `git pull`; replaced leftover upstream ASCII banner with NextDesk branding.
- 🩺 Database layer: made `db:doctor` strictly read-only (no longer triggers migrations on import); fixed `DB_MIGRATION_TIMEOUT_MS=0` to genuinely disable the watchdog; added fail-fast `timeout` + `PGCONNECT_TIMEOUT` to pre-migration `pg_dump`; ensured `migrate.js` cleanly destroys the Knex pool and exits immediately; honored `POSTGRES_SSL=true` in `POSTGRES_URL` mode.
- 🚀 DevOps pipeline: fixed missing `STABLE_TAG` in `promote-stable.yml`, added `GITHUB_TOKEN` fallback when `RELEASE_TOKEN` secret is unset, fixed duplicate `1.1.0-dev.6` heading in `CHANGELOG.md`, and hardened `verify-release-sync.sh` with duplicate-heading and channel validation.

## 1.1.0-dev.10

### New

- 🩺 **Database hardening** — the database layer now fails fast instead of hanging forever, even though the data itself is tiny. This release was built after an update stalled for a long time at "Running database migrations" on a database with only 2–3 accounts: the stall was never about data size, it was the database layer having **no timeouts at all** in Postgres mode (a single unreachable/locked/stalled query could hang forever, and one update involves hundreds of queries).
- 🧪 New **`db:doctor`** diagnostics command (menu: Manage Database → "Database diagnostics (db:doctor)") that reports the engine and connection target, connection latency, schema version vs. latest migration, missing critical tables, leftover interrupted-migration rebuild tables, row counts, database size, and (SQLite) integrity check + WAL health.

### Fixed

- ⏱️ **Fail-fast timeouts everywhere in Postgres mode**: TCP connect (10s), pool acquire (15s), per-statement `statement_timeout` (30s) and `idle_in_transaction_session_timeout` (30s), pool `min: 0` so dead servers are not propped up by stale sockets. Every value is overridable via `DB_CONNECTION_TIMEOUT_MS`, `DB_ACQUIRE_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` for large datasets.
- 🚦 **Connectivity preflight before migrations**: 3 quick `SELECT 1` probes with a clear, actionable error naming the exact cause (server not listening / DNS / credentials / SSL / timeout) and the configured target — nothing is modified when the database is unreachable, instead of a silent chain of 60s+ stalls.
- 🛑 **Per-migration watchdog** (`DB_MIGRATION_TIMEOUT_MS`, default 120s): a single migration that refuses to finish is aborted with an error that names the migration and explains that schema version was not advanced — no more frozen "Running database migrations".
- 💾 **Automatic pre-migration backup for Postgres too** via best-effort `pg_dump` into `data/backups/` (SQLite keeps its file-copy backup); a missing `pg_dump` warns instead of blocking.
- 📺 The updater now **streams migration output live** (every migration with its number and elapsed time) instead of capture-and-show-later output that looks frozen; a 15-minute hard ceiling (`DB_MIGRATION_MAX_SECONDS`) force-stops a stuck migration with a pointer to `db:doctor`.

## 1.1.0-dev.9

### Fixed

- 🐢 Update stuck on "Running database migrations": the migration runner re-applied all 43 idempotent migrations on **every** update and every server boot ("self-heal"), which on large databases silently burned minutes with zero output — it looked frozen. The self-heal pass now runs only when a critical table is actually missing (cheap existence check), the schema version prints correctly (previously `[object Promise]`), and each applied migration logs its number and elapsed time so progress is always visible.
- ⌨️ Pressing Ctrl+C during the migration step of an update left the stopped ChatDesk service down behind nginx (**502 Bad Gateway**) — the interrupt handler now automatically restores the service before exiting, in addition to the existing recovery on every other interrupted update path.

### Changed

- 🧭 The updater now warns before migrations that large databases can take several minutes and that interrupting the step can corrupt the schema; migration output streams live instead of staying silent.

## 1.1.0-dev.8

### Changed

- 🧹 Project cleanup: removed the original upstream project's leftovers — the old maintainer's personal email/LinkedIn/Telegram/Railway links (Security Policy, Code of Conduct, Accessibility statement, docs site social links, in-app About panel) now point to the ChatDesk GitHub project; removed the dead `opencode.json` AI-tool config and the graphify/Superpowers sections from `AGENTS.md`; dropped the stale static `1.0.0` version badge from the READMEs and fixed `CONTRIBUTING.md` to route contributions into `dev` (two-channel law). The MIT `LICENSE` retains the original author's copyright line as legally required.

### New

- 📌 The release delivery checklist (installer/CLI sync law) is now recorded as permanent memory in `AGENTS.md` — every future change must pass the release-sync gate, update the installer header, and be registered as a bilingual dev release before being reported. The two-channel mechanism is now also documented in the deployment guide (English and Persian).

## 1.1.0-dev.7

### Fixed

- 🧰 Installer & CLI versioning was broken: the `chatdesk-deploy` CLI stamped its own version with a `sed` pointed at the wrong line, and the installer header (`chatdesk-deploy-version`) had not been bumped since dev.2 — so installed CLIs never self-updated and servers stayed on old versions even after updates. The header is now bumped with every release and stamped correctly; a CI gate (`verify-release-sync.sh`) refuses any push where VERSION, the installer header and CHANGELOG disagree, so this can never drift again.
- 🔀 Update checks are now channel-aware: a Stable-channel install is only offered stable releases and a Test-channel install follows dev prereleases — previously the app mixed both channels when showing "update available".

### New

- 🚦 Two-channel DevOps pipeline end to end: `chatdesk-deploy --status` shows the installed version and channel; the menu banner shows the same; a new **"Switch Test (dev) / Stable (main) channel"** menu action moves an install between channels through the full update pipeline; and a new **"Promote dev to Stable"** GitHub Actions workflow is the single user-triggered path from an approved dev tag to a stable release on `main`. All install/update/channel-switch paths now share one finalization pipeline (dependencies, migrations, client build, CLI sync, systemd, restart, health check).

## 1.1.0-dev.5

### Fixed

- 🛠️ Helpdesk: admin panel department endpoints crashed with an internal error (`ReferenceError`) because the helpdesk database helpers were never wired into the admin panel module — the Helpdesk tab showed "Could not load helpdesk data", department creation failed, and the support picker could not list departments. All department and support-report endpoints now work end to end.
- ➕ The "+" menu in the sidebar now lists "Contact support" first (then private message, group, channel) to match the support-first workflow.

## 1.1.0-dev.6

### Fixed

- 🔧 Installer (CLI Update): the updater stops the ChatDesk service before doing any work, but many failure or early-exit paths (failed dependency install, failed client build, failed migration, failed `git fetch`, aborted prompt, even the "already up to date" exit) returned without restarting the service — leaving the site permanently behind nginx as **502 Bad Gateway**. The updater now restores the service automatically on every interrupted path and verifies the health endpoint after restarting, with clear `journalctl` hints when it cannot come up.

## 1.0.0

First independent release of ChatDesk.

### New Features

- 🎧 Helpdesk mode: departments, operator role and fair routing of support requests
- 🏢 Department picker during customer registration; conversations start in the right queue
- ⚖️ Fair assignment strategies (round-robin / least-busy) for incoming support requests
- 🛡️ Admin panel extensions: operator account management, department management and reports
- 🗂️ Request status, assignment, tags and customer-invisible internal notes
- 🌐 Bilingual (English / Persian) setup guide and documentation
- 🚀 Branch-aware deployment installer with PostgreSQL as the default database

### Inherited Platform Features

- Messenger core: direct messages, groups and channels with realtime SSE
- File uploads, voice messages and video transcoding worker
- Web push notifications (VAPID) and voice/video calls
- Remote channels (Telegram / ChatDesk mirroring)
- Owner admin panel, PWA support and encryption at rest

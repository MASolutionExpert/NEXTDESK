# Changelog

All notable changes to ChatDesk are documented in this file.

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

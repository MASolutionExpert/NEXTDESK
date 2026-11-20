# Changelog

All notable changes to ChatDesk are documented in this file.

## 1.1.0-dev.7

### Fixed

- 🧰 Installer & CLI versioning was broken: the `chatdesk-deploy` CLI stamped its own version with a `sed` pointed at the wrong line, and the installer header (`chatdesk-deploy-version`) had not been bumped since dev.2 — so installed CLIs never self-updated and servers stayed on old versions even after updates. The header is now bumped with every release and stamped correctly; a CI gate (`verify-release-sync.sh`) refuses any push where VERSION, the installer header and CHANGELOG disagree, so this can never drift again.
- 🔀 Update checks are now channel-aware: a Stable-channel install is only offered stable releases and a Test-channel install follows dev prereleases — previously the app mixed both channels when showing "update available".

### New

- 🚦 Two-channel DevOps pipeline end to end: `chatdesk-deploy --status` shows the installed version and channel; the menu banner shows the same; a new **"Switch Test (dev) / Stable (main) channel"** menu action moves an install between channels through the full update pipeline; and a new **"Promote dev to Stable"** GitHub Actions workflow is the single user-triggered path from an approved dev tag to a stable release on `main`. All install/update/channel-switch paths now share one finalization pipeline (dependencies, migrations, client build, CLI sync, systemd, restart, health check).

## 1.1.0-dev.6

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

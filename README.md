# NextDesk

**NextDesk** is a self-hosted, real-time organizational messenger and helpdesk platform built as a unified **Full-Stack Next.js 16 + TypeScript Monolith** application (App Router + Custom Express/SSE/WebSocket Server + PostgreSQL/SQLite + optional FFmpeg Media Worker).

## Highlights

- ⚡ **Unified Full-Stack Next.js 16 + TypeScript Monolith**: Single runtime (`server.ts`) serving the Next.js App Router frontend alongside Express 5 APIs, Server-Sent Events (`/api/events`), and WebSocket signaling (`/ws`).
- 🎧 **Built-in Helpdesk**: Departments, operator roles, fair routing (round-robin / least-busy), support request queues, and admin reports.
- 💬 **Full Organizational Messenger**: Direct messages, groups, channels, replies, forwarding, mentions, pinned/hidden messages, read receipts, and offline-resilient IndexedDB caching.
- 📞 **Voice & Video Calls**: WebRTC 1:1 audio/video calls with TURN diagnostics and screen sharing.
- 📎 **Media & Object Storage**: Local or S3/Cloudflare R2 encrypted storage, voice waveforms, and FFmpeg video transcoding worker.
- 🌐 **Bilingual (Persian & English)**: Full RTL/LTR support with Vazirmatn & DM Sans fonts and per-user language preference.
- 🛡️ **Hardened Database Layer**: PostgreSQL (default in production) & SQLite with 43 idempotent migrations, fail-fast timeouts, pre-migration backups, and read-only `db:doctor`.

## Quick Install (Ubuntu 22.04+)

| Channel | Branch | Versions | Install command |
|---------|--------|----------|-----------------|
| **Stable** (production) | `main` | `vX.Y.Z` | `curl -fsSL https://raw.githubusercontent.com/MASolutionExpert/NEXTDESK/main/scripts/install.sh \| bash` |
| **Test** (pre-release) | `dev` | `vX.Y.Z-dev.N` | `curl -fsSL https://raw.githubusercontent.com/MASolutionExpert/NEXTDESK/dev/scripts/install.sh \| REPO_BRANCH=dev bash` |

Manage your installation anytime from anywhere with `nextdesk-deploy` (or `chatdesk-deploy`):
- `nextdesk-deploy --status` — inspect installed version and release channel.
- Menu option **2) Update** stays inside your installed channel and self-hands-off to the latest installer pipeline.
- Menu option **4) Switch channel** safely transitions between `dev` (Test) and `main` (Stable).

## Local Development

```bash
# Install dependencies (Node >= 24)
npm install
npm install
npm install --prefix worker

# Run unified Full-Stack Next.js dev server (frontend + API + SSE + WebSocket)
npm run dev

# Build & run production
npm run build
npm start
```

## License

MIT — see [LICENSE](./LICENSE).

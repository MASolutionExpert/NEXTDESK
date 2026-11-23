# Repository Guidelines: NextDesk (Full-Stack Next.js)

NextDesk is a self-hosted real-time organizational communication and helpdesk platform built as a unified **Full-Stack Next.js 16 + TypeScript Monolith** application (App Router + Custom Realtime HTTP/Express/SSE/WebSocket Server + PostgreSQL + Prisma 7 + optional FFmpeg Media Worker).

## MANDATORY Agent Rules (read first, always)

Every agent (and any AI/human contributor) working on this project MUST follow these rules. Read this section BEFORE doing anything else, on every session:

1. **Read the rules first**: Always read `AGENTS.md` and `DESIGN.md` before making any change.
2. **Use only the project's native stack**: Work exclusively with the project's existing stack (**Next.js 16 App Router + React 19 + Tailwind CSS 4** frontend in `src/`, **unified custom Next.js server** `server.ts` + **Express 5 + Prisma 7 (`@prisma/adapter-pg`)** API/realtime engine in `src/server/`, PostgreSQL, optional `worker/`). Never introduce competing frameworks or side solutions.
3. **Absolutely NOTHING fake**: Never fabricate, mock, stub, hardcode, or simulate data or behavior. Every feature must work end-to-end, full-stack: real database reads/writes, real API endpoints, real SSE/WebSocket events.
4. **No demo/display-only features**: Nothing decorative or display-only. Every screen must be backed by real, persistent, secure server-side functionality.
5. **Security is the absolute top priority**: Authentication, authorization (role checks on every endpoint), input validation, parameterized SQL queries only, XSS prevention, and safe secrets handling on every change.
6. **Integration over isolation**: Every change must integrate cleanly with existing migrations, API contracts, client state, installer/CLI (`scripts/install.sh`), docs (`docs/` + `docs/fa/`), and tests.
7. **No patch-work fixes**: Find and fix the root cause cleanly.
8. **Zero-bug tolerance with reasonable effort**: Verify syntax, imports, release-sync gates, and unit tests before delivering.
9. **Performance matters**: Efficient indexed queries, pagination, lean payloads, no N+1 patterns.
10. **No unnecessary work**: Stay strictly scoped to what is requested plus correctness/security/integration requirements.
11. **When fixing a bug**: Write/verify a reproduction test first, then apply the minimal root-cause fix without breaking unrelated features.

## DevOps Workflow: Two GitHub Spaces (MANDATORY — read every session)

NextDesk (`MASolutionExpert/NEXTDESK`) has EXACTLY TWO spaces on GitHub — `dev` and `main`. NEVER mix them, and NEVER let `dev` changes leak into `main` without explicit user approval.

### Space 1 — `dev` (development & testing)
- EVERY completed change is IMMEDIATELY pushed to `dev` and registered as a NEW dev version:
  1. Bump root `VERSION` (`X.Y.Z-dev.YYYYMMDDNN`, YYYYMMDD + 2-digit daily sequence `01..99`) and `# chatdesk-deploy-version:` header in `scripts/install.sh` (can use `bash scripts/release-dev.sh X.Y.Z-dev.YYYYMMDDNN`).
  2. Add a `## {VERSION}` section to `CHANGELOG.md`.
  3. Pass `bash scripts/verify-release-sync.sh --channel dev` and `bash -n scripts/install.sh`.
  4. Commit, create an annotated git tag `v{VERSION}`, push `dev` + tag, and publish a bilingual (EN + FA) GitHub **prerelease**.
- Dev releases require NO user approval — registering them is part of delivering the task.

### Space 2 — `main` (stable releases)
- `main` is FROZEN for the agent. NEVER push, merge, or build a stable version on `main` on your own initiative.
- ONLY when the user explicitly approves a tested `dev` tag, run the **"Promote dev to Stable"** workflow (`.github/workflows/promote-stable.yml`) or execute the exact equivalent promotion steps: merge the approved tag into `main`, rewrite `VERSION`/`scripts/install.sh` header/`CHANGELOG.md` to `X.Y.Z` (no `-dev`), pass `bash scripts/verify-release-sync.sh --channel stable`, tag `vX.Y.Z`, push `main` + tag, and publish a full Stable GitHub release.

### Separate install commands (never mix)
- **Main / Stable**: `curl -fsSL https://raw.githubusercontent.com/MASolutionExpert/NEXTDESK/main/scripts/install.sh | bash`
- **Dev / Test**: `curl -fsSL https://raw.githubusercontent.com/MASolutionExpert/NEXTDESK/dev/scripts/install.sh | REPO_BRANCH=dev bash`

### Installer/CLI release-sync law (MANDATORY — every change, no exceptions)
Every change MUST ship together with the installer and CLI (`nextdesk-deploy`).
- Run `bash scripts/verify-release-sync.sh` before ANY release.
- Any install/update step MUST live in `finalize_chatdesk_source_change()` (shared by git update, offline update, channel switch, and invoked via `--finalize-update` self-handoff).
- Never use raw `dpkg --compare-versions` for SemVer comparisons; always use `semver_compare_versions` / `semver_gt` / `semver_lt`.

## Sandbox / Environment Workflow (IMPORTANT)
- Do NOT waste time trying to run Postgres/Redis/Nginx/Playwright inside ephemeral sandboxes.
- Run static checks (`bash -n scripts/install.sh`, `bash scripts/verify-release-sync.sh`, import/syntax checks, and Node unit tests when runnable).
- Push incrementally to `dev` and register a new dev prerelease; real end-to-end testing happens on the user's test server via CLI Update and on GitHub Actions CI (Node 24).

## Full-Stack Next.js Architecture

- **`src/app/`**: Next.js 16 App Router entrypoints (`layout.tsx`, `globals.css`, `/`, `/login`, `/signup`, `/chat`, `/admin`, `/departments`, `/invite/[token]`, `/[...slug]`).
- **`src/components/`**, **`src/views/`**, **`src/hooks/`**, **`src/api/`**, **`src/i18n/`**, **`src/icons/`**, **`src/settings/`**, **`src/utils/`**: Client React 19 UI, hooks, bilingual i18n (FA/EN), IndexedDB cache, WebRTC calls, and API boundary (`apiFetch`).
- **`public/`**: Static PWA assets (`sw.js`, `manifest.webmanifest`, `icons/`, `sounds/`, `fonts/`, logos).
- **`server.ts` & `src/server/`**: Unified 100% TypeScript Full-Stack Next.js 16 Custom Server (`node server.ts`) booting Next.js App Router together with Express 5 API routes (`src/server/api/`), single-database PostgreSQL + Prisma 7 ORM (`prisma/schema.prisma`, `src/server/db/prisma.ts`, `src/server/db/migrate.ts`, modular repositories in `src/server/db/*Repo.ts`, and `src/server/db.ts`), SSE realtime hub (`src/server/lib/sse.ts`), WebSocket gateway (`/ws`), BullMQ media queue, Helpdesk routing, Remote Channels, and DB maintenance CLI (`src/server/scripts/`).
- **`worker/`**: Optional standalone FFmpeg video transcoding & media worker.
- **`test/`**: Frontend unit & Playwright browser component tests (Vitest).
- **`docs/`**: Dual-language VitePress documentation (English `docs/*.md` & Persian `docs/fa/*.md` — mirrored).

## Essential Commands

```bash
# Development & Production (Full-Stack Next.js)
npm run dev                  # Unified Next.js dev server + API + SSE + WebSocket
npm run dev:all              # Next.js full-stack dev server + media worker
npm run build                # Next.js production build (.next/)
npm start                    # Unified Next.js production server (node server.ts)

# Lint & Testing
npm run lint                 # ESLint across src/
npm run test:client:unit     # Frontend unit tests (Node)
npm run test:client:browser  # Frontend component tests (Playwright)
npm run test:server          # Backend Vitest + Supertest suite
npm run test:worker          # Media worker tests
npm run test:scripts         # Bats shell tests for installer & release-sync

# Database & Diagnostics
npm run db:migrate           # Run idempotent schema migrations
npm run db:doctor            # Strictly read-only DB health diagnostics
npm run db:backup            # Create database backup

# Documentation
npm run docs:dev             # VitePress dev server
npm run docs:build           # Build docs
```

## Critical Architecture Rules
- **Node Requirement**: Requires Node `>=24.18.0` and npm `>=11.18.0` in production/CI.
- **Client Env Variables**: Never use `import.meta.env`. Add build-time client env keys to `next.config.ts` (`CLIENT_ENV_KEYS`) and `src/settings/clientEnv.js`.
- **SQL Isolation**: All SQL queries **must** live inside `src/server/db.ts`. Never write inline SQL in route handlers.
- **Read-Only Diagnostics**: `src/server/scripts/db-doctor.ts` MUST NEVER import `src/server/db.ts` (which triggers migrations on import); keep diagnostics strictly read-only via `pg.Pool` (`buildPgPoolConfig()`).
- **Thin API Routes + DI**: Express handlers in `src/server/api/` receive dependencies through `apiDeps` in `src/server/index.ts`.
- **Realtime Updates**: Broadcast mutations via `emitChatEvent` (SSE) and WebSocket gateway.
- **API Boundary**: All frontend HTTP calls **must** use `apiFetch` in `src/api/chatApi.js` (`credentials: "include"`).
- **Icons**: Import icons from `src/icons/lucide.js` or `src/icons/BrandIcons.jsx`.
- **Docs Mirroring**: Any docs change must update both `docs/*.md` and `docs/fa/*.md`.

## Release Delivery Checklist (PERMANENT MEMORY — run at the end of EVERY change)
1. **Root-cause fix only.**
2. **Installer coverage** inside `finalize_chatdesk_source_change()`.
3. **Release-sync gate**: bump `VERSION`, `scripts/install.sh` header, `CHANGELOG.md`, then pass `bash scripts/verify-release-sync.sh --channel dev`.
4. **Static & unit checks**: `bash -n scripts/install.sh`, syntax/import checks, tests.
5. **Push + register dev release**: commit, push `dev`, push annotated tag `v{VERSION}`, publish bilingual GitHub prerelease.
6. **Never touch `main`** without explicit user approval.

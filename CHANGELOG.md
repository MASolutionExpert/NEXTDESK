# Changelog

All notable changes to **NextDesk** are documented in this file.

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

# Repository Guidelines: ChatDesk

ChatDesk is a self-hosted real-time communication platform built as a Node.js/React monorepo.

## MANDATORY Agent Rules (read first, always)

Every agent (and any AI/human contributor) working on this project MUST follow these rules. Read this section BEFORE doing anything else, on every session:

1. **Read the rules first**: Always read `AGENTS.md` and `DESIGN.md` before making any change.
2. **Use only the project's native stack**: Work exclusively with the project's existing language, frameworks, libraries, and patterns (React 19 + Vite client, Express 5 + Knex server, SQLite/Postgres). Never introduce your own alternatives, new frameworks, or side solutions.
3. **Absolutely NOTHING fake**: Never fabricate, mock, stub, hardcode, or simulate data or behavior. ChatDesk is a REAL organizational messenger. Every feature must work end-to-end, full-stack: real database reads/writes, real API endpoints, real realtime events. A UI that only "displays" without a working backend is forbidden.
4. **No demo/display-only features**: Nothing purely decorative or "fancy". Every screen must be backed by real, persistent, secure server-side functionality — like the original Songbird project: powerful, robust, no theater.
5. **Security is the absolute top priority**: Treat security as first-class in every change — authentication, authorization (role checks on every endpoint), input validation, SQL injection prevention (parameterized queries only), XSS prevention, secrets handling. When in doubt, choose the secure path.
6. **Integration over isolation**: Every change must be fully integrated with the whole project — existing migrations, existing API contracts, existing client state management, docs (`docs/` + `docs/fa/`), and tests. No orphan code.
7. **No patch-work fixes**: Never fix a bug with a hack, band-aid, or workaround layered on top. Find the root cause and fix it properly, cleanly, and completely. A fix that leaves inconsistency in the codebase is not a fix.
8. **Zero-bug tolerance with reasonable effort**: Try your hardest to deliver each change bug-free. Review your own code carefully before delivering it.
9. **Performance matters**: Security AND speed are both critical. Prefer efficient queries (indexes, pagination), avoid N+1 patterns, keep payloads lean.
10. **No unnecessary work**: Do only what is asked plus what is strictly required for correctness/security/integration. No refactoring for taste, no scope creep, no changes that could break working features.
11. **When fixing a bug**: Change ONLY what is needed for that bug. Never break other working features while fixing one. After the fix, mentally (or via tests) re-verify the affected flows end-to-end.

## Sandbox / Environment Workflow (IMPORTANT)

The development sandbox used for coding is EPHEMERAL and UNSTABLE — it resets and loses local state. Therefore:

- **Never rely on the sandbox to run or prove the app.** Do not waste time trying to run, serve, or manually test the full stack inside the sandbox. Static checks only (lint, build, unit tests if they pass in the environment).
- **Deliverable = git branch.** The source of truth is GitHub, not the sandbox. When a task is complete, push the work to the `dev` branch.
- **Push incrementally (MANDATORY)**: The sandbox can reset and lose local changes at any moment. Therefore EVERY important completed change (bug fix, new feature, i18n batch, refactor) MUST be committed and pushed to `dev` on GitHub IMMEDIATELY after it passes a build/lint check — do not batch up hours of work locally. At the end of each planned step, review and summarize the changes, then push again to `dev`.
- **Release flow**: user tests `dev` on their real server → reports bugs → fixes go to `dev` → after the user EXPLICITLY approves, a new release version is built on `main`. Never build/release on `main` without that explicit approval.
- **Testing happens on the user's real test server** using the `dev` branch installer. The user reports results back.
- **Bug-fix loop**: user reports a bug → fix only that bug (root cause, no patch-work, nothing else broken) → push to `dev` again → user re-tests.
- **`main` is release-only**: NEVER push or merge to `main` without explicit user approval after successful testing on the user's server.
- If a task genuinely cannot be implemented or verified without a running environment, say so honestly instead of faking verification.

## Workspace Architecture

- **`client/`**: React 19 SPA (Vite, Tailwind CSS 4, Vitest + Playwright).
- **`server/`**: Node.js Express 5 backend (SSE realtime updates, in-memory SQLite via `sql.js`, Vitest + Supertest).
- **`docs/`**: Dual-language VitePress documentation (English & Persian/Farsi).

## Essential Commands

```bash
# Development & Build
npm run dev                  # Concurrent client + server dev servers
npm --prefix client run dev  # Frontend dev server (Vite)
npm --prefix server run dev  # Backend dev server (Node --watch)
npm run build                # Build client frontend

# Testing
npm test                     # Run client and server tests concurrently
npm --prefix client run test # Client Vitest (unit + browser)
npm --prefix client run test:unit    # Fast Node-only unit tests
npm --prefix client run test:browser # Playwright browser component tests (Chromium + Firefox)
npm --prefix server run test # Server Vitest (unit + Supertest API integration)

# Docs
npm run docs:dev             # VitePress dev server
npm run docs:build           # Build documentation site
```

## Critical Architecture Quirks & Pitfalls

- **Design & Styling (`DESIGN.md`)**: Respect and follow [`DESIGN.md`](./DESIGN.md) for all frontend styling, UI component design, typography, color system, accessibility, and UI patterns.
- **Node Requirement**: Requires Node `>=24.18.0` and npm `>=11.18.0`.
- **Database (`server/db.js`)**: `sql.js` runs in-memory with debounced disk persistence (`DB_SAVE_DEBOUNCE_MS`). All SQL queries **must** reside inside `server/db.js`. Never write inline SQL queries elsewhere.
- **Server Test Isolation**: `server/db.js` and `server/index.js` initialize WASM and disk state on module load and **cannot** be imported in tests. Server API integration tests must use `makeApp` from `server/test/helpers/makeApp.js` to inject stubbed dependencies.
- **Realtime SSE**: Real-time events are dispatched via `server/lib/sse.js` (`emitChatEvent`). API mutations must invoke SSE broadcast handlers to notify connected clients.
- **Client Routing & API**: No React Router library. SPA navigation is managed manually in `client/src/App.jsx` via `window.history`. All client HTTP calls **must** use `apiFetch` in `client/src/api/chatApi.js` (`credentials: "include"`).
- **Documentation Updates**: Any update to documentation under `docs/` must update both English (`docs/*.md`) and Persian (`docs/fa/*.md`) documents, matching the structure in `docs/.vitepress/config.mjs`. Call the `documentor` subagent to update docs when you implant a new feature.

## Development & Git Workflow

- **Git Execution & Branching**: Work on the `dev` branch. `main` is release-only and must never be pushed/merged without explicit user approval after testing on the user's server. Commit messages use the format `type(scope): description`. Pushing to `dev` is part of delivering a task (see Sandbox / Environment Workflow).
- **Bug Fixing Workflow**: Do not guess or fix immediately upon a bug report. First write a test reproducing the issue under test scenarios, verify it catches the bug, then apply the fix.
- **Response Style**: Keep task completions concise. Do not generate unrequested markdown summary files.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output. Always prefer graphify query commands over raw text grepping on graphify-out/.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Superpowers

When using superpowers skills, create the plans or specs docs under `.superpowers/docs`.

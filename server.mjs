#!/usr/bin/env node
/**
 * NextDesk Unified Full-Stack Next.js Server Entrypoint.
 *
 * Boots the complete Next.js App Router frontend together with the Express 5
 * API layer, SSE realtime hub, WebSocket (/ws) gateway, PostgreSQL/SQLite Knex
 * engine, BullMQ media queue, remote channels, and local media worker on one
 * single HTTP server and port.
 */
import "./server/index.js";

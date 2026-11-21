import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { serverDir, dataDir } from "./_cli.ts";
import {
  pgPool,
  pgGetRow,
  pgGetAll,
  pgRun,
  withPgTransaction,
  closeDatabase,
} from "../db/prisma.ts";
import {
  runDatabaseMigrations,
  getAppliedMigrations,
} from "../db/migrate.ts";

const projectRootDir = path.resolve(serverDir, "../..");
dotenv.config({ path: path.join(projectRootDir, ".env"), quiet: true });
dotenv.config({ path: path.join(serverDir, ".env"), override: true, quiet: true });

export const uploadsDir = path.join(dataDir, "uploads", "messages");
export const avatarUploadsDir = path.join(dataDir, "uploads", "avatars");

export async function openDatabase(options: { skipMigrations?: boolean } = {}) {
  const { skipMigrations = false } = options;

  if (!skipMigrations) {
    await runDatabaseMigrations({ quiet: process.env.NODE_ENV === "test" });
  }

  const getRow = (sql: string, params: unknown = []) => pgGetRow(sql, params);
  const getAll = (sql: string, params: unknown = []) => pgGetAll(sql, params);
  const run = (sql: string, params: unknown = []) => pgRun(sql, params);

  const tableExists = async (name: string): Promise<boolean> => {
    const row = await pgGetRow(
      "SELECT 1 AS found FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1",
      [String(name || "").toLowerCase()],
    );
    return Boolean(row?.found);
  };

  const hasColumn = async (tableName: string, columnName: string): Promise<boolean> => {
    const row = await pgGetRow(
      "SELECT 1 AS found FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2 LIMIT 1",
      [String(tableName || "").toLowerCase(), String(columnName || "").toLowerCase()],
    );
    return Boolean(row?.found);
  };

  const getSchemaVersion = async (): Promise<number> => {
    const applied = await getAppliedMigrations().catch(() => []);
    return applied.length;
  };

  const transaction = async <T>(
    callback: (tx: {
      raw: (sql: string, params?: unknown) => Promise<any>;
      run: (sql: string, params?: unknown) => Promise<any>;
      getRow: (sql: string, params?: unknown) => Promise<any>;
      getAll: (sql: string, params?: unknown) => Promise<any[]>;
    }) => Promise<T>,
  ): Promise<T> => {
    return withPgTransaction(async (tx) => {
      return callback({
        raw: (sql: string, params: unknown = []) => tx.query(sql, params),
        run: (sql: string, params: unknown = []) => tx.query(sql, params),
        getRow: (sql: string, params: unknown = []) => tx.getRow(sql, params),
        getAll: (sql: string, params: unknown = []) => tx.getAll(sql, params),
      });
    });
  };

  const save = () => {
    // No-op: PostgreSQL commits transactions durably.
  };

  const close = async () => {
    await closeDatabase();
  };

  return {
    db: pgPool,
    getRow,
    getAll,
    run,
    save,
    transaction,
    close,
    fileExists: true,
    tableExists,
    hasColumn,
    getSchemaVersion,
  };
}

export function removeStoredFiles(storedNames: string[] = []) {
  if (!Array.isArray(storedNames) || storedNames.length === 0) {
    return { removed: 0, missing: 0 };
  }
  let removed = 0;
  let missing = 0;
  storedNames.forEach((storedName) => {
    const safeName = String(storedName || "").trim();
    if (!safeName) return;
    const filePath = path.join(uploadsDir, safeName);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
      removed += 1;
    } else {
      missing += 1;
    }
  });
  return { removed, missing };
}

export function removeAvatarFiles(fileNames: string[] = []) {
  if (!Array.isArray(fileNames) || fileNames.length === 0) {
    return { removed: 0, missing: 0 };
  }
  let removed = 0;
  let missing = 0;
  fileNames.forEach((name) => {
    const safeName = path.basename(String(name || "").trim());
    if (!safeName) return;
    const filePath = path.join(avatarUploadsDir, safeName);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
      removed += 1;
    } else {
      missing += 1;
    }
  });
  return { removed, missing };
}

export function chunkArray<T>(items: T[] = [], size = 500): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function detectRunningServer() {
  const port = Number(process.env.PORT || process.env.SERVER_PORT || 5174);
  const timeoutMs = 600;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      method: "GET",
      signal: controller.signal,
    });
    return res.ok ? { running: true, port } : { running: false, port };
  } catch {
    return { running: false, port };
  } finally {
    clearTimeout(timer);
  }
}

export async function runAdminActionViaServer(action: string, payload: Record<string, unknown> = {}) {
  const { running, port } = await detectRunningServer();
  if (!running) return null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.ADMIN_API_TOKEN) {
    headers["x-chatdesk-admin-token"] = process.env.ADMIN_API_TOKEN;
  }
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/db-tools`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, payload }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Server admin action failed (${res.status}).`);
  }
  return data?.result || data || { ok: true };
}

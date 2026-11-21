import pg from "pg";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
import { buildPgPoolConfig } from "./connectionConfig.ts";

export type PgParam = unknown;

const globalForPrisma = globalThis as typeof globalThis & {
  __nextdeskPgPool?: Pool;
  __nextdeskPrisma?: PrismaClient;
};

export function createPgPool(): Pool {
  const pool = new pg.Pool(buildPgPoolConfig());
  pool.on("error", (err) => {
    console.error("[db] Unexpected idle PostgreSQL pool error:", err?.message || err);
  });
  return pool;
}

export const pgPool: Pool = (globalForPrisma.__nextdeskPgPool ??= createPgPool());

export function createPrismaClient(pool: Pool = pgPool): PrismaClient {
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log:
      process.env.PRISMA_LOG_QUERIES === "true"
        ? ["query", "warn", "error"]
        : ["error"],
  });
}

export const prisma: PrismaClient = (globalForPrisma.__nextdeskPrisma ??=
  createPrismaClient(pgPool));

export function toPgPlaceholders(sql: string): string {
  if (!sql.includes("?")) return sql;
  let out = "";
  let paramIdx = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      out += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === "*" && next === "/") {
        out += next;
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === "-" && next === "-") {
        out += "--";
        i += 1;
        inLineComment = true;
        continue;
      }
      if (ch === "/" && next === "*") {
        out += "/*";
        i += 1;
        inBlockComment = true;
        continue;
      }
    }
    if (ch === "'" && !inDouble) {
      out += ch;
      if (inSingle && next === "'") {
        out += next;
        i += 1;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }
    if (ch === '"' && !inSingle) {
      out += ch;
      if (inDouble && next === '"') {
        out += next;
        i += 1;
      } else {
        inDouble = !inDouble;
      }
      continue;
    }
    if (ch === "?" && !inSingle && !inDouble) {
      paramIdx += 1;
      out += `$${paramIdx}`;
      continue;
    }
    out += ch;
  }

  return out;
}

export function normalizeParams(params: unknown = []): unknown[] {
  if (params === undefined || params === null) return [];
  return Array.isArray(params) ? params : [params];
}

export async function pgQuery<T extends QueryResultRow = Record<string, any>>(
  sql: string,
  params: unknown = [],
): Promise<QueryResult<T>> {
  const normalizedSql = toPgPlaceholders(String(sql || ""));
  const normalizedParams = normalizeParams(params);
  return pgPool.query<T>(normalizedSql, normalizedParams);
}

export async function pgGetRow<T extends QueryResultRow = Record<string, any>>(
  sql: string,
  params: unknown = [],
): Promise<T | null> {
  const result = await pgQuery<T>(sql, params);
  return result.rows[0] ?? null;
}

export async function pgGetAll<T extends QueryResultRow = Record<string, any>>(
  sql: string,
  params: unknown = [],
): Promise<T[]> {
  const result = await pgQuery<T>(sql, params);
  return result.rows;
}

export async function pgRun(
  sql: string,
  params: unknown = [],
): Promise<number> {
  const result = await pgQuery(sql, params);
  return typeof result.rowCount === "number" ? result.rowCount : result.rows.length;
}

export interface PgTransactionClient {
  client: PoolClient;
  query: <T extends QueryResultRow = Record<string, any>>(
    sql: string,
    params?: unknown,
  ) => Promise<QueryResult<T>>;
  getRow: <T extends QueryResultRow = Record<string, any>>(
    sql: string,
    params?: unknown,
  ) => Promise<T | null>;
  getAll: <T extends QueryResultRow = Record<string, any>>(
    sql: string,
    params?: unknown,
  ) => Promise<T[]>;
  run: (sql: string, params?: unknown) => Promise<number>;
  raw: <T extends QueryResultRow = Record<string, any>>(
    sql: string,
    params?: unknown,
  ) => Promise<QueryResult<T>>;
}

export async function withPgTransaction<T>(
  callback: (tx: PgTransactionClient) => Promise<T>,
): Promise<T> {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const tx: PgTransactionClient = {
      client,
      query: (sql, params = []) =>
        client.query(toPgPlaceholders(String(sql || "")), normalizeParams(params)),
      getRow: async (sql, params = []) => {
        const res = await client.query(
          toPgPlaceholders(String(sql || "")),
          normalizeParams(params),
        );
        return res.rows[0] ?? null;
      },
      getAll: async (sql, params = []) => {
        const res = await client.query(
          toPgPlaceholders(String(sql || "")),
          normalizeParams(params),
        );
        return res.rows;
      },
      run: async (sql, params = []) => {
        const res = await client.query(
          toPgPlaceholders(String(sql || "")),
          normalizeParams(params),
        );
        return typeof res.rowCount === "number" ? res.rowCount : res.rows.length;
      },
      raw: (sql, params = []) =>
        client.query(toPgPlaceholders(String(sql || "")), normalizeParams(params)),
    };
    const result = await callback(tx);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function withPrismaTransaction<T>(
  callback: Parameters<PrismaClient["$transaction"]>[0],
): Promise<T> {
  return prisma.$transaction(callback as any) as Promise<T>;
}

export async function closeDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch {}
  try {
    await pgPool.end();
  } catch {}
  delete globalForPrisma.__nextdeskPrisma;
  delete globalForPrisma.__nextdeskPgPool;
}

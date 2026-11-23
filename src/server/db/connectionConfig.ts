import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import type { PoolConfig } from "pg";

pg.types.setTypeParser(pg.types.builtins.INT8, (value: string | null) =>
  value === null ? null : Number.parseInt(value, 10),
);

const dbDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRootDir = path.resolve(dbDir, "..", "..", "..");
export const serverRootDir = path.resolve(dbDir, "..");

dotenv.config({ path: path.join(projectRootDir, ".env"), quiet: true });
dotenv.config({ path: path.join(serverRootDir, ".env"), quiet: true });

export interface PostgresTimeouts {
  connectionTimeoutMs: number;
  acquireTimeoutMs: number;
  poolCreateTimeoutMs: number;
  statementTimeoutMs: number;
  idleInTransactionTimeoutMs: number;
}

export interface PgTargetDescription {
  mode: "url" | "parts";
  host: string;
  port: string;
  database: string;
  user: string;
  ssl: boolean;
}

const PG_TIMEOUT_DEFAULTS = {
  CONNECTION_TIMEOUT_MS: 10_000,
  ACQUIRE_TIMEOUT_MS: 15_000,
  POOL_CREATE_TIMEOUT_MS: 10_000,
  STATEMENT_TIMEOUT_MS: 30_000,
  IDLE_IN_TRANSACTION_TIMEOUT_MS: 30_000,
} as const;

type PgTimeoutKey = keyof typeof PG_TIMEOUT_DEFAULTS;

function pgTimeoutMs(key: PgTimeoutKey): number {
  const raw = process.env[`DB_${key}`];
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return PG_TIMEOUT_DEFAULTS[key];
}

export function getPostgresTimeouts(): PostgresTimeouts {
  return {
    connectionTimeoutMs: pgTimeoutMs("CONNECTION_TIMEOUT_MS"),
    acquireTimeoutMs: pgTimeoutMs("ACQUIRE_TIMEOUT_MS"),
    poolCreateTimeoutMs: pgTimeoutMs("POOL_CREATE_TIMEOUT_MS"),
    statementTimeoutMs: pgTimeoutMs("STATEMENT_TIMEOUT_MS"),
    idleInTransactionTimeoutMs: pgTimeoutMs("IDLE_IN_TRANSACTION_TIMEOUT_MS"),
  };
}

export function resolveDatabaseUrl(): string {
  const explicitUrl = (
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const host = (process.env.POSTGRES_HOST || "127.0.0.1").trim();
  const port = String(process.env.POSTGRES_PORT || "5432").trim();
  const user = encodeURIComponent(
    (process.env.POSTGRES_USER || "postgres").trim(),
  );
  const password = encodeURIComponent(
    process.env.POSTGRES_PASSWORD ?? "postgres",
  );
  const database = encodeURIComponent(
    (process.env.POSTGRES_DB || "nextdesk").trim(),
  );
  const sslQuery = process.env.POSTGRES_SSL === "true" ? "?sslmode=require" : "";

  return `postgresql://${user}:${password}@${host}:${port}/${database}${sslQuery}`;
}

export function describePgTarget(): PgTargetDescription {
  const explicitUrl = (
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
  if (explicitUrl) {
    try {
      const parsed = new URL(explicitUrl);
      return {
        mode: "url",
        host: parsed.hostname,
        port: parsed.port || "5432",
        database: parsed.pathname.replace(/^\//, "") || "(default)",
        user: parsed.username || "(default)",
        ssl: /sslmode=(require|verify-ca|verify-full)/i.test(explicitUrl),
      };
    } catch {
      return {
        mode: "url",
        host: "(unparseable URL)",
        port: "?",
        database: "?",
        user: "?",
        ssl: false,
      };
    }
  }
  return {
    mode: "parts",
    host: process.env.POSTGRES_HOST || "127.0.0.1",
    port: String(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || "nextdesk",
    user: process.env.POSTGRES_USER || "postgres",
    ssl: process.env.POSTGRES_SSL === "true",
  };
}

export function buildPgPoolConfig(): PoolConfig {
  const timeouts = getPostgresTimeouts();
  const explicitUrl = (
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
  const maxPoolSize = Math.max(
    1,
    Number(process.env.DB_POOL_MAX || 20) || 20,
  );

  const sharedOptions: PoolConfig = {
    max: maxPoolSize,
    min: 0,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: timeouts.connectionTimeoutMs,
    statement_timeout: timeouts.statementTimeoutMs,
    idle_in_transaction_session_timeout: timeouts.idleInTransactionTimeoutMs,
    keepAlive: true,
    application_name: "nextdesk",
  };

  if (explicitUrl) {
    return {
      ...sharedOptions,
      connectionString: explicitUrl,
      ...(process.env.POSTGRES_SSL === "true"
        ? { ssl: { rejectUnauthorized: false } }
        : {}),
    };
  }

  return {
    ...sharedOptions,
    host: process.env.POSTGRES_HOST || "127.0.0.1",
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD ?? "postgres",
    database: process.env.POSTGRES_DB || "nextdesk",
    ssl:
      process.env.POSTGRES_SSL === "true"
        ? { rejectUnauthorized: false }
        : false,
  };
}

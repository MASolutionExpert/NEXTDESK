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

export const DEFAULT_MIGRATION_TIMEOUT_MS = 120_000;
export const DEFAULT_BACKUP_TIMEOUT_MS = 120_000;

type PgTimeoutKey = keyof typeof PG_TIMEOUT_DEFAULTS;

export function resolveDurationTimeoutMs(
  raw: string | undefined,
  defaultMs: number,
  options: { allowZero?: boolean; minPositiveMs?: number } = {},
): number {
  const { allowZero = false, minPositiveMs = 1 } = options;
  if (raw === undefined || raw === null) return defaultMs;
  const trimmed = String(raw).trim();
  if (trimmed === "") return defaultMs;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return defaultMs;
  if (parsed === 0) return allowZero ? 0 : defaultMs;
  return Math.max(minPositiveMs, Math.trunc(parsed));
}

function pgTimeoutMs(key: PgTimeoutKey): number {
  return resolveDurationTimeoutMs(
    process.env[`DB_${key}`],
    PG_TIMEOUT_DEFAULTS[key],
    { allowZero: false, minPositiveMs: 1 },
  );
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

/**
 * Per-migration watchdog timeout in milliseconds.
 * - Unset or blank -> 120,000ms (2 minutes default; blank never disables watchdog).
 * - Explicit "0"   -> 0 (disables watchdog as documented).
 * - Positive int   -> exact timeout in ms (minimum 1,000ms).
 */
export function getMigrationTimeoutMs(): number {
  return resolveDurationTimeoutMs(
    process.env.DB_MIGRATION_TIMEOUT_MS,
    DEFAULT_MIGRATION_TIMEOUT_MS,
    { allowZero: true, minPositiveMs: 1_000 },
  );
}

/**
 * Hard timeout for pre-migration pg_dump backups in milliseconds.
 * Default 120,000ms (2 minutes); cannot be disabled to prevent updater freezes.
 */
export function getBackupTimeoutMs(): number {
  return resolveDurationTimeoutMs(
    process.env.DB_BACKUP_TIMEOUT_MS,
    DEFAULT_BACKUP_TIMEOUT_MS,
    { allowZero: false, minPositiveMs: 5_000 },
  );
}

export function hasExplicitSslMode(url: string): boolean {
  return /[?&]sslmode=/i.test(url);
}

function extractExplicitSslMode(url: string): string | null {
  const match = url.match(/[?&]sslmode=([^&#]+)/i);
  return match ? decodeURIComponent(match[1]).trim().toLowerCase() : null;
}

export function shouldUseFallbackSslForUrl(url: string): boolean {
  return process.env.POSTGRES_SSL === "true" && !hasExplicitSslMode(url);
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
      const explicitSslMode = extractExplicitSslMode(explicitUrl);
      const sslEnabled =
        explicitSslMode !== null
          ? ["require", "verify-ca", "verify-full", "prefer"].includes(
              explicitSslMode,
            )
          : process.env.POSTGRES_SSL === "true";
      return {
        mode: "url",
        host: parsed.hostname,
        port: parsed.port || "5432",
        database: parsed.pathname.replace(/^\//, "") || "(default)",
        user: parsed.username || "(default)",
        ssl: sslEnabled,
      };
    } catch {
      return {
        mode: "url",
        host: "(unparseable URL)",
        port: "?",
        database: "?",
        user: "?",
        ssl: process.env.POSTGRES_SSL === "true",
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
    // Honor POSTGRES_SSL=true for self-signed Postgres servers when the URL
    // does not specify an explicit sslmode=; an explicit sslmode= in the URL
    // always takes precedence.
    return {
      ...sharedOptions,
      connectionString: explicitUrl,
      ...(shouldUseFallbackSslForUrl(explicitUrl)
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

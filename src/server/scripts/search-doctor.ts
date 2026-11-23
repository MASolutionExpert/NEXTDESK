#!/usr/bin/env node
/**
 * Strictly read-only search diagnostic for NextDesk PostgreSQL deployments.
 *
 * NEVER imports src/server/db.ts (so it never runs migrations or mutates state).
 * Inspects:
 *  - PostgreSQL server_encoding and lc_collate
 *  - Actual contents of the users table (flagging mixed-case usernames)
 *  - Compares legacy raw-LIKE SQL vs current lower()+@-stripped SQL for probes
 *
 * Usage:
 *   npm run search:doctor
 *   npm run search:doctor -- @milad ahmadi
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { resolvePostgresConnectionConfig } from "../db/postgresConfig.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true });

function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

function escapeLike(value: string): string {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

function normalizeSearchTerm(raw: string): string {
  return String(raw || "").trim().replace(/^@+/, "").trim().toLowerCase();
}

async function main() {
  const cliProbes = process.argv.slice(2).filter((arg) => arg && arg !== "--");
  const config = resolvePostgresConnectionConfig(process.env);
  const pool = new Pool({
    ...config.pgOptions,
    max: 1,
    min: 0,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
  });

  console.log("NextDesk Search Doctor (read-only)");
  console.log("==================================");
  console.log(`Engine: PostgreSQL`);
  console.log(`Target: ${redactUrl(config.connectionString)}`);
  console.log(`SSL: ${config.ssl ? "enabled" : "disabled"} (${config.sslReason})`);

  try {
    const started = Date.now();
    const meta = await pool.query(
      `SELECT current_database() AS db_name,
              current_setting('server_encoding') AS server_encoding,
              current_setting('lc_collate') AS lc_collate,
              version() AS pg_version`,
    );
    const latencyMs = Date.now() - started;
    const row = meta.rows[0] || {};
    console.log(`Connected in ${latencyMs}ms | DB: ${row.db_name} | Encoding: ${row.server_encoding} | Collate: ${row.lc_collate}`);
    console.log("");

    const usersRes = await pool.query(
      `SELECT id, username, nickname, role, banned
       FROM users
       ORDER BY username ASC
       LIMIT 200`,
    );
    const users = usersRes.rows || [];
    console.log(`Users inspected: ${users.length} (showing up to 200)`);
    const mixedCase = users.filter((u: any) => String(u.username || "") !== String(u.username || "").toLowerCase());
    if (mixedCase.length > 0) {
      console.warn(
        `[WARN] Found ${mixedCase.length} mixed-case username(s): ${mixedCase.map((u: any) => u.username).join(", ")}`,
      );
    }
    for (const u of users.slice(0, 25)) {
      console.log(
        `  - @${u.username} | nickname=${JSON.stringify(u.nickname || "")} | role=${u.role || "user"} | banned=${u.banned ? "yes" : "no"}`,
      );
    }
    if (users.length > 25) {
      console.log(`  ... (${users.length - 25} more user(s))`);
    }
    console.log("");

    const probes: string[] = [];
    if (cliProbes.length > 0) {
      probes.push(...cliProbes);
    } else if (users.length > 0) {
      const sample = users[0];
      probes.push(`@${sample.username}`);
      if (sample.nickname) {
        probes.push(String(sample.nickname).toLowerCase());
      }
    }

    if (probes.length === 0) {
      console.log("No users or probe arguments available to test search queries.");
      return;
    }

    console.log("Search SQL Comparison (OLD raw-LIKE vs NEW lower() + @-strip):");
    for (const probe of probes) {
      const legacyPattern = `%${escapeLike(probe.trim())}%`;
      const oldRes = await pool.query(
        `SELECT username, nickname FROM users
         WHERE username LIKE $1 ESCAPE '\\' OR nickname LIKE $2 ESCAPE '\\'
         ORDER BY username ASC LIMIT 20`,
        [legacyPattern, legacyPattern],
      );

      const normalized = normalizeSearchTerm(probe);
      let newRows: any[] = [];
      if (normalized) {
        const newPattern = `%${escapeLike(normalized)}%`;
        const newRes = await pool.query(
          `SELECT username, nickname FROM users
           WHERE LOWER(username) LIKE $1 ESCAPE '\\' OR LOWER(COALESCE(nickname, '')) LIKE $2 ESCAPE '\\'
           ORDER BY LOWER(username) ASC LIMIT 20`,
          [newPattern, newPattern],
        );
        newRows = newRes.rows || [];
      }

      console.log(`  Probe ${JSON.stringify(probe)} (normalized=${JSON.stringify(normalized)}):`);
      console.log(`    OLD raw-LIKE : ${oldRes.rows.length} match(es) -> [${oldRes.rows.map((r: any) => r.username).join(", ")}]`);
      console.log(`    NEW lower()  : ${newRows.length} match(es) -> [${newRows.map((r: any) => r.username).join(", ")}]`);
      if (oldRes.rows.length === 0 && newRows.length > 0) {
        console.log("    -> Diagnosis: OLD SQL returned 0 while NEW SQL matched. If the app still returns empty, verify the deployed build is up to date.");
      }
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("search:doctor failed:", err?.message || err);
  process.exit(1);
});

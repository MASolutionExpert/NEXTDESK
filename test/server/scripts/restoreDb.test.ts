import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";

const serverDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../src/server",
);
const restoreScriptPath = path.join(serverDir, "scripts", "restore-db.ts");

describe("restore-db CLI (PostgreSQL-only)", () => {
  test("rejects a .db file with a clear .dump error", () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "nextdesk-restore-"),
    );
    const backupFile = path.join(tempRoot, "backup.db");
    fs.writeFileSync(backupFile, "DB_CONTENT");

    let stderr = "";
    try {
      execFileSync(
        process.execPath,
        [restoreScriptPath, "-y", "--file", backupFile],
        {
          encoding: "utf8",
          env: { ...process.env, DATA_DIR: path.join(tempRoot, "data") },
        },
      );
    } catch (error: any) {
      stderr = error?.stderr?.toString?.() || "";
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    expect(stderr).toMatch(/Backup file not found or is not a \.dump file/);
  });

  test("reports permission denied when .dump file is not readable", () => {
    if (process.getuid?.() === 0) return;
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "nextdesk-restore-"),
    );
    const backupFile = path.join(tempRoot, "unreadable.dump");
    fs.writeFileSync(backupFile, "SECRET_DUMP");
    fs.chmodSync(backupFile, 0);

    let stderr = "";
    try {
      execFileSync(
        process.execPath,
        [restoreScriptPath, "-y", "--file", backupFile],
        {
          encoding: "utf8",
          env: { ...process.env, DATA_DIR: path.join(tempRoot, "data") },
        },
      );
    } catch (error: any) {
      stderr = error?.stderr?.toString?.() || "";
    } finally {
      fs.chmodSync(backupFile, 0o600);
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    expect(stderr).toMatch(/Permission denied accessing backup file/);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";

const serverDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../src/server",
);
const backupScriptPath = path.join(serverDir, "scripts", "backup-db.ts");

describe("backup-db CLI (PostgreSQL-only)", () => {
  test("loads dotenv configuration like sibling db:* scripts", () => {
    const source = fs.readFileSync(backupScriptPath, "utf8");
    expect(source).toMatch(/import dotenv from ["']dotenv["']/);
    expect(source).toMatch(/dotenv.config(/);
  });

  test("always targets PostgreSQL .dump archives and never creates .db files", () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "nextdesk-backup-script-"),
    );
    const dataDir = path.join(tempRoot, "data");
    fs.mkdirSync(dataDir, { recursive: true });

    let stderr = "";
    try {
      execFileSync(process.execPath, [backupScriptPath], {
        encoding: "utf8",
        env: { ...process.env, DATA_DIR: dataDir },
      });
    } catch (error: any) {
      stderr = error?.stderr?.toString?.() || "";
    }
    expect(stderr).not.toMatch(/No database found at/);

    const backupDir = path.join(dataDir, "backups");
    const files = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
    const dbFiles = files.filter((f) => f.endsWith(".db"));
    fs.rmSync(tempRoot, { recursive: true, force: true });
    expect(dbFiles).toEqual([]);
  });
});

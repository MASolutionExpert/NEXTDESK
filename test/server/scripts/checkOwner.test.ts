import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { resetTestTables } from "../db/testDbHelper.ts";

const serverDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../src/server",
);

describe("check-owner CLI (PostgreSQL)", () => {
  test("exits 1 when no owner exists and exits 0 when owner exists", async () => {
    await resetTestTables();
    try {
      let initialStatus = 0;
      try {
        execFileSync(process.execPath, ["scripts/check-owner.ts"], {
          cwd: serverDir,
          encoding: "utf8",
          env: { ...process.env, SERVER_PORT: "0" },
        });
      } catch (err: any) {
        initialStatus = err.status;
      }
      expect(initialStatus).toBe(1);

      execFileSync(
        process.execPath,
        [
          "scripts/create-user.ts",
          "--nickname",
          "Owner Test",
          "--username",
          "owner_test_cli",
          "--password",
          "test-password",
          "--role",
          "owner",
        ],
        {
          cwd: serverDir,
          encoding: "utf8",
          env: { ...process.env, SERVER_PORT: "0" },
        },
      );

      let statusWithOwner = -1;
      try {
        execFileSync(process.execPath, ["scripts/check-owner.ts"], {
          cwd: serverDir,
          encoding: "utf8",
          env: { ...process.env, SERVER_PORT: "0" },
        });
        statusWithOwner = 0;
      } catch (err: any) {
        statusWithOwner = err.status;
      }
      expect(statusWithOwner).toBe(0);
    } finally {
      await resetTestTables();
    }
  });
});

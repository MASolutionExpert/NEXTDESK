import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { pgGetRow } from "../../../src/server/db/prisma.ts";
import { resetTestTables } from "../db/testDbHelper.ts";

const serverDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../src/server",
);

describe("create-user CLI (PostgreSQL)", () => {
  test("creates a requested owner role in PostgreSQL", async () => {
    await resetTestTables();
    try {
      const output = execFileSync(
        process.execPath,
        [
          "scripts/create-user.ts",
          "--nickname",
          "Owner Test",
          "--username",
          "owner_create_cli",
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

      expect(output).toContain("User created: id=");
      const row = await pgGetRow(
        "SELECT username, nickname, role FROM users WHERE username = ?",
        ["owner_create_cli"],
      );
      expect(row).toEqual({
        username: "owner_create_cli",
        nickname: "Owner Test",
        role: "owner",
      });
    } finally {
      await resetTestTables();
    }
  });
});

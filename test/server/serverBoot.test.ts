import { describe, test, expect } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const projectRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const serverDir = path.join(projectRootDir, "src/server");

const BOOT_TIMEOUT_MS = 20_000;

function bootServer(timeoutMs = BOOT_TIMEOUT_MS) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-boot-"));

  const child = spawn(process.execPath, ["index.ts"], {
    cwd: serverDir,
    env: {
      ...process.env,
      SERVER_PORT: "0",
      BIND_ADDRESS: "127.0.0.1",
      DATA_DIR: dataDir,
      NEXTDESK_API_ONLY: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let killedByTest = false;
  child.stdout.on("data", (d) => (stdout += d.toString()));
  child.stderr.on("data", (d) => (stderr += d.toString()));

  return new Promise<any>((resolve) => {
    const timer = setTimeout(() => {
      killedByTest = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.once("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, signal: null, stdout, stderr, dataDir, error: err });
    });

    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ ok: killedByTest, code, signal, stdout, stderr, dataDir });
    });
  });
}

describe("Server boot", () => {
  test("index.js starts and binds a port without crashing", { timeout: 30_000 }, async () => {
    const result = await bootServer();
    try {
      expect(
        result.ok,
        `server exited early (code=${result.code}, signal=${result.signal}) stderr:\n${result.stderr}`,
      ).toBe(true);
      expect(result.stdout).toMatch(/(NextDesk|ChatDesk).*server running/i);
      expect(result.stderr).not.toMatch(/ReferenceError/);
    } finally {
      fs.rmSync(result.dataDir, { recursive: true, force: true });
    }
  });
});

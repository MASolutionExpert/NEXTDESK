import fs from "node:fs";
import path from "node:path";
import { dataDir, getCliArgs, hasForceYes, confirmAction } from "./_cli.ts";
import { detectRunningServer } from "./_db-admin.ts";
import { createPostgresMaintenance } from "../lib/postgresMaintenance.ts";
import { readDbConfig } from "../settings/env.ts";

const uploadsDir = path.join(dataDir, "uploads", "messages");

async function main() {
  const args = getCliArgs();
  const hasForceFlag = hasForceYes(args) || process.env.CHATDESK_FORCE_DELETE === "1";
  const confirmed = await confirmAction({
    prompt: "This will permanently delete the PostgreSQL database and uploaded message files. Continue?",
    force: hasForceFlag,
    forceHint: "Refusing to delete in non-interactive mode without -y/--yes. Run: npm run db:delete -- -y",
  });
  if (!confirmed) return console.log("Aborted.");

  const dbConfig = readDbConfig();
  const { running, port } = await detectRunningServer();
  if (running) {
    throw new Error(`Stop NextDesk on port ${port} before deleting its PostgreSQL database, or use the Admin Panel action.`);
  }
  await createPostgresMaintenance({ config: dbConfig }).dropDatabase();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
  console.log("PostgreSQL database and local message uploads deleted.");
}

main().catch((error: any) => {
  console.error(error?.message || error);
  process.exit(1);
});

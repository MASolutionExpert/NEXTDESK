import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { serverDir, dataDir } from "./_cli.ts";
import { readDbConfig } from "../settings/env.ts";
import { createPostgresMaintenance } from "../lib/postgresMaintenance.ts";

const projectRootDir = path.resolve(serverDir, "../..");
dotenv.config({ path: path.join(projectRootDir, ".env"), quiet: true });
dotenv.config({ path: path.join(serverDir, ".env"), override: true, quiet: true });

const backupDir = path.join(dataDir, "backups");

async function main() {
  const dbConfig = readDbConfig();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `nextdesk-backup-${stamp}.dump`);
  await createPostgresMaintenance({ config: dbConfig }).backup(backupPath);
  console.log(`PostgreSQL backup created: ${backupPath}`);
}

await main();

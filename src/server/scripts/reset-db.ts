import fs from "node:fs";
import path from "node:path";
import { dataDir, getCliArgs, hasForceYes, confirmAction } from "./_cli.ts";
import { openDatabase, runAdminActionViaServer } from "./_db-admin.ts";
import { createPostgresMaintenance } from "../lib/postgresMaintenance.ts";
import { readDbConfig } from "../settings/env.ts";

const uploadsDir = path.join(dataDir, "uploads", "messages");

async function main() {
  const args = getCliArgs();
  const hasForceFlag = hasForceYes(args) || process.env.CHATDESK_FORCE_RESET === "1";
  const hasNoRecreateFlag = args.includes("--no-recreate");
  const hasRecreateFlag = args.includes("--recreate");
  const dbConfig = readDbConfig();

  const confirmed = await confirmAction({
    prompt: "This will reset the PostgreSQL database and delete uploaded message files. Continue?",
    force: hasForceFlag,
    forceHint: "Refusing to reset in non-interactive mode without -y/--yes. Run: npm run db:reset -- -y",
  });
  if (!confirmed) return console.log("Aborted.");

  // When NextDesk is running, reset through its authenticated loopback API
  // (schema-preserving PostgreSQL TRUNCATE).
  const remoteResult = await runAdminActionViaServer("reset_db");
  if (remoteResult) {
    console.log("Server mode: PostgreSQL database content reset while server is running.");
    return;
  }

  const maintenance = createPostgresMaintenance({ config: dbConfig });
  await maintenance.dropDatabase();
  fs.rmSync(uploadsDir, { recursive: true, force: true });

  const shouldRecreate = hasNoRecreateFlag
    ? false
    : hasRecreateFlag || hasForceFlag
      ? true
      : await confirmAction({ prompt: "Recreate a fresh PostgreSQL database now?", force: false });
  if (!shouldRecreate) {
    console.log("PostgreSQL database reset. Database recreation skipped.");
    return;
  }

  await maintenance.createDatabase();
  const dbApi = await openDatabase();
  await dbApi.close();
  console.log("PostgreSQL database reset and Prisma 7 migrations recreated the schema.");
}

main().catch((error: any) => {
  console.error(error?.message || error);
  process.exit(1);
});

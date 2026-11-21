import { getCliArgs, getPositionalArgs } from "./_cli.ts";
import { openDatabase, runAdminActionViaServer } from "./_db-admin.ts";
import { resolveUserRow } from "../lib/dbToolHelpers.ts";

async function main() {
  const args = getCliArgs();
  const positional = getPositionalArgs(args);
  const userSelector = String(positional[0] || "").trim();

  if (!userSelector) {
    console.error("Usage: npm run db:user:verify -- <user-id-or-username>");
    process.exit(1);
  }

  const remoteResult = await runAdminActionViaServer("toggle_user_verified", {
    userSelector,
  });
  if (remoteResult) {
    console.log(
      `Server mode user ${remoteResult.verified ? "verified" : "unverified"}: id=${remoteResult.id} username=${remoteResult.username}`,
    );
    return;
  }

  const dbApi = await openDatabase();
  try {
    const user = await resolveUserRow(dbApi, userSelector);
    if (!user?.id) {
      console.error("User not found.");
      process.exit(1);
    }
    const nextVerified = Number(user.verified || 0) ? 0 : 1;
    await dbApi.run("UPDATE users SET verified = $1 WHERE id = $2", [
      nextVerified,
      user.id,
    ]);
    await dbApi.save();
    console.log(
      `User ${nextVerified ? "verified" : "unverified"}: id=${user.id} username=${user.username}`,
    );
  } finally {
    await dbApi.close();
  }
}

main().catch((err: any) => {
  console.error(err?.message || err);
  process.exit(1);
});

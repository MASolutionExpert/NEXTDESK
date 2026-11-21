export const migration015RemoveIdleStatus = {
  version: 15,
  up: ({ db, tableExists, hasColumn }: any) => {
    if (!tableExists("users") || !hasColumn("users", "status")) return;
    db.run(
      "UPDATE users SET status = 'online' WHERE LOWER(COALESCE(status, '')) = 'idle'",
    );
  },
};

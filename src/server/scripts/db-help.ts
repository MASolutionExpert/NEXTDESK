const helpText = `NextDesk PostgreSQL + Prisma 7 DB Commands

Core:
  npm run db:help
  npm run db:doctor
  npm run db:migrate
  npm run db:backup
  npm run db:restore -- -y --file /path/to/nextdesk-backup-<timestamp>.dump
  npm run db:vacuum -- -y
  npm run db:inspect -- --limit 25
  npm run db:chat:inspect -- --limit 25
  npm run db:user:inspect -- --limit 25
  npm run db:file:inspect -- --limit 25

Reset/Delete:
  npm run db:reset -- -y --recreate
  npm run db:reset -- -y --no-recreate
  npm run db:delete -- -y
  npm run db:chat:delete -- -y <chat-id-or-username>
  npm run db:chat:delete -- --all -y
  npm run db:user:delete -- -y <username>
  npm run db:user:delete -- --all -y
  npm run db:file:delete -- -y <file-id-or-name>
  npm run db:file:delete -- --all -y

Users:
  npm run db:user:create -- --nickname "NextDesk Admin" --username admin --password "12345678" --role owner
  npm run db:user:generate -- --count 50 --password "12345678" --nickname-prefix User --username-prefix user
  npm run db:user:edit -- admin --nickname "NextDesk Admin" --color "#ff6b6b"
  npm run db:user:verify -- admin
  npm run db:user:ban -- username -y

Chats:
  npm run db:chat:create -- --type group --name "Core Team" --owner admin --username core.team --visibility public --users bob,charlie
  npm run db:chat:add -- core.team --all
  npm run db:chat:edit -- core.team --name "Core Team HQ"
  npm run db:chat:verify -- core.team

Messages:
  npm run db:message:generate -- --chatId <id> --userA alice --userB bob --count 300 --days 7

Notes:
  - NextDesk uses PostgreSQL exclusively with Prisma 7 (@prisma/adapter-pg).
  - PostgreSQL backup/restore use native .dump archives and require pg_dump/pg_restore in PATH.
  - Stop NextDesk before offline db:restore, db:reset, or db:delete.
`;
console.log(helpText.trim());

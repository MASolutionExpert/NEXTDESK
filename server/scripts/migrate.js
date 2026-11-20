import { detectRunningServer } from './_db-admin.js'

const startedAt = Date.now()

const { running, port } = await detectRunningServer()
if (running) {
  console.error(
    `Refusing to run db:migrate while ChatDesk is running on port ${port}. Stop the server first so sql.js cannot race the migration writer.`,
  )
  process.exit(1)
}

console.log('[db-migrations] Checking database schema...')

const { getCurrentSchemaVersion } = await import('../db.js')

const schemaVersion = await getCurrentSchemaVersion()

console.log(
  `Migrations complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s. Current schema version: ${schemaVersion}`,
)

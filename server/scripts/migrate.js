import { detectRunningServer } from './_db-admin.js'

const startedAt = Date.now()

const { running, port } = await detectRunningServer()
if (running) {
  console.error(
    `Refusing to run migrations while server is running on port ${port}. Stop the server first.`,
  )
  process.exit(1)
}

console.log('[db-migrations] Checking database schema...')

let knexToClose = null
try {
  const { getCurrentSchemaVersion } = await import('../db.js')
  const { dbKnex } = await import('../db/knex.js')
  knexToClose = dbKnex

  const schemaVersion = await getCurrentSchemaVersion()

  console.log(
    `Migrations complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s. Current schema version: ${schemaVersion}`,
  )
  if (knexToClose && typeof knexToClose.destroy === 'function') {
    await knexToClose.destroy().catch(() => {})
  }
  process.exit(0)
} catch (error) {
  // Fail-fast errors (connectivity preflight, migration watchdog) carry a
  // full actionable message — print it cleanly instead of a stack trace.
  console.error(String(error?.message || error))
  console.error('[db-migrations] Migration FAILED. Nothing beyond the failed migration was changed.')
  if (knexToClose && typeof knexToClose.destroy === 'function') {
    await knexToClose.destroy().catch(() => {})
  }
  process.exit(1)
}

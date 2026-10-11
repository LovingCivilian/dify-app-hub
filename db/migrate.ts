import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
	console.error('The DATABASE_URL environment variable is missing; check the configuration')
	process.exit(1)
}

// Drizzle "Migrations", option 4: migrate() at runtime from the folder drizzle-kit generates, run by
// docker/entrypoint.sh before the server starts (decision 25). The pool is ended so the script leaves no connection
// behind; a failure rejects the top-level await, the process exits non-zero, and the entrypoint's `set -e` stops the
// container.
const pool = new Pool({ connectionString: databaseUrl })
await migrate(drizzle({ client: pool }), { migrationsFolder: './db/migrations' })
await pool.end()

console.log('Database migration complete')
process.exit(0)

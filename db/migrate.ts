import { migrate } from 'drizzle-orm/mysql2/migrator'
import { drizzle } from 'drizzle-orm/mysql2'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
	console.error('The DATABASE_URL environment variable is missing; check the configuration')
	process.exit(1)
}

const db = drizzle(databaseUrl)

await migrate(db, { migrationsFolder: './db/migrations' })

console.log('Database migration complete')
process.exit(0)

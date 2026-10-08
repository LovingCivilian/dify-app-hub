import { drizzle } from 'drizzle-orm/mysql2'

import { env } from '@/lib/env'

// drizzle-orm 1.0.0-rc.3: the mysql2 driver takes a connection string; its config has no `schema` option (the
// relational API is typed over defineRelations), and the DAL uses the query builder with explicit columns.
const createDb = () => drizzle(env().databaseUrl, { logger: env().nodeEnv === 'development' })

export type Db = ReturnType<typeof createDb>

// One pool per process. In development the module is re-evaluated on edits, so the instance lives on globalThis
// (the inherited code did the same); in production the module loads once anyway.
const globalForDb = globalThis as unknown as { difyAppHubDb?: Db }

export const getDb = (): Db => (globalForDb.difyAppHubDb ??= createDb())

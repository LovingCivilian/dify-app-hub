import 'server-only'

import { eq, sql, type SQL } from 'drizzle-orm'

import { users } from '@/db/schema'
import { lower } from '@/db/schema/users'

/**
 * The condition that finds the account using this email, whatever its case (spec §3.4, ADR-0031): `lower()` on the
 * column and on the value, in SQL. PostgreSQL's citext page writes such a lookup as `lower(col) = LOWER(?)` and warns
 * that "you always have to remember to use lower on both the column and the query value"; the unique index
 * `users_email_key` on `lower(email)` (db/schema/users.ts) serves it (PostgreSQL 18 "Indexes on Expressions": a query
 * on `lower(col1)` "can use an index if one has been defined on the result of the lower(col1) function"). Drizzle's
 * guide "Unique and Case-Insensitive Email Handling" lowers the value in JavaScript (`email.toLowerCase()`); here
 * PostgreSQL lowers both sides, so the value goes through the same function as the index (DV 3c). Case only: `lower()`
 * does not fold accents, where MySQL's `utf8mb4_0900_ai_ci` also ignored them (MySQL 8.4 "Collation Naming
 * Conventions": `_ai`, accent-insensitive), so `jose@` and `josé@` are two addresses.
 */
export const emailMatches = (email: string): SQL => eq(lower(users.email), sql`lower(${email})`)

import { timestamp } from 'drizzle-orm/pg-core'

/**
 * A point in time with its zone, as every hub table stores one (PostgreSQL wiki "Don't Do This": "Don't use timestamp
 * (without time zone)"; PostgreSQL 18 "Date/Time Types": "All timezone-aware dates and times are stored internally in
 * UTC"). No precision: "it rounds off the fractional part rather than truncating it" (the wiki's "Don't use
 * timestamp(0) or timestamptz(0)"), and a JS Date holds milliseconds anyway. Read as a Date (Drizzle "PostgreSQL column
 * types", timestamp, `mode: 'date'`). LobeHub's Drizzle schema keeps the same helper
 * (`lobehub/lobehub@canary:packages/database/src/schemas/_helpers.ts`).
 */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

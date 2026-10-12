import * as z from 'zod'

/**
 * Every id the hub stores is a UUID (ADR-0031: `uuid` columns since the fresh PostgreSQL start, filled by
 * `crypto.randomUUID()`). An id that comes from outside, a URL segment or an action argument, is checked here before it
 * reaches a query: PostgreSQL refuses a malformed one with SQLSTATE 22P02 invalid_text_representation (PostgreSQL 18
 * Appendix A) where MySQL's text column matched nothing (spec §3.2). `z.uuid()` takes RFC 9562/4122 UUIDs only (zod 4
 * "UUIDs"), a subset of what PostgreSQL's `uuid` input accepts (PostgreSQL 18 "8.12. UUID Type": upper-case digits,
 * braces, hyphens left out), so an id that passes never raises 22P02. Client-safe: the admin schemas use it.
 */
export const idSchema = z.uuid()

/** Whether an id from outside can be one of the hub's; a malformed one is answered as an unknown one (spec §3.2). */
export const isId = (value: string): boolean => idSchema.safeParse(value).success

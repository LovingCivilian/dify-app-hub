import { describe, expect, it } from 'vitest'

import { idSchema, isId } from '@/lib/ids'

describe('the id check (spec §3.2, ADR-0031)', () => {
	it('takes the ids the hub generates and the seeded e2e ids', () => {
		expect(isId(crypto.randomUUID())).toBe(true)
		expect(isId('e2e00000-0000-4000-8000-000000000001')).toBe(true)
		expect(isId('3b241101-e2bb-4255-8caf-4136c566a962')).toBe(true)
	})

	it('refuses what PostgreSQL would refuse with 22P02, and the old short ids', () => {
		for (const id of ['', 'abc', 'app-1', 'u9', 'not-a-uuid', 'x'.repeat(36)])
			expect(isId(id)).toBe(false)
	})

	// zod's z.uuid() takes RFC 9562/4122 UUIDs only (zod 4 "UUIDs"), a subset of PostgreSQL's uuid input, which also
	// takes braces and missing hyphens (PostgreSQL 18 "8.12. UUID Type"): an id that passes never raises 22P02.
	it('is stricter than PostgreSQL: the alternative input forms are refused too', () => {
		expect(isId('{3b241101-e2bb-4255-8caf-4136c566a962}')).toBe(false)
		expect(isId('3b241101e2bb42558caf4136c566a962')).toBe(false)
	})

	it('is a zod schema the admin schemas compose', () => {
		expect(idSchema.safeParse(crypto.randomUUID()).success).toBe(true)
		expect(idSchema.safeParse('legacy-id').success).toBe(false)
	})
})

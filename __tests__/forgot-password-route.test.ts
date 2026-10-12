import type { SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { conditions, sendPasswordResetEmail } = vi.hoisted(() => ({
	/** The condition each lookup passed to where(), rendered on drizzle.mock() below. */
	conditions: [] as unknown[],
	sendPasswordResetEmail: vi.fn(),
}))
// The lookup finds no account, so the handler answers its generic message before any token work.
vi.mock('@/db', () => ({
	getDb: () => ({
		select: () => ({
			from: () => ({
				where: (condition: unknown) => {
					conditions.push(condition)
					return { limit: () => Promise.resolve([]) }
				},
			}),
		}),
	}),
}))
vi.mock('@/lib/mail', () => ({ isMailConfigured: () => true, sendPasswordResetEmail }))

import { POST } from '@/app/api/auth/forgot-password/route'
import { users } from '@/db/schema'

const post = (body: unknown) =>
	new NextRequest('http://hub/api/auth/forgot-password', {
		method: 'POST',
		body: JSON.stringify(body),
	})

beforeEach(() => {
	conditions.length = 0
	sendPasswordResetEmail.mockReset()
})

describe('POST /api/auth/forgot-password (spec §3.4)', () => {
	it('looks the account up whatever the case typed: lower() on the column and on the trimmed value', async () => {
		const response = await POST(post({ email: '  Jane@Example.com ' }))
		expect(response.status).toBe(200)
		expect(conditions).toHaveLength(1)
		const { sql, params } = drizzle
			.mock()
			.select({ id: users.id })
			.from(users)
			.where(conditions[0] as SQL)
			.toSQL()
		expect(sql).toBe('select "id" from "users" where lower("users"."email") = lower($1)')
		expect(params).toEqual(['Jane@Example.com'])
		expect(sendPasswordResetEmail).not.toHaveBeenCalled()
	})
})

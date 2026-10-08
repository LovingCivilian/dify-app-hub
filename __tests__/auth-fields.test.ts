import bcrypt from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import {
	emailField,
	emailRule,
	nameField,
	nameRule,
	PASSWORD_MAX_BYTES,
	PASSWORD_MIN,
	passwordBytesRule,
	passwordField,
} from '@/lib/auth/fields'

// bcrypt reads only the first 72 bytes of its input (bcryptjs README: "The maximum input length is 72 bytes"), and
// OWASP's Password Storage Cheat Sheet says to "enforce a maximum password length of 72 bytes" (ADR-0024 decision f).
// '€' (U+20AC) is three bytes in UTF-8.
const boundary = [
	['72 ASCII characters', 'a'.repeat(72), true],
	['73 ASCII characters', 'a'.repeat(73), false],
	['24 three-byte characters (72 bytes)', '€'.repeat(24), true],
	['25 three-byte characters (75 bytes)', '€'.repeat(25), false],
] as const

describe('passwordField', () => {
	it('caps the UTF-8 encoding at 72 bytes', () => {
		expect(PASSWORD_MAX_BYTES).toBe(72)
	})

	it.each(boundary)('%s: accepted is %s', (_label, value, accepted) => {
		expect(passwordField.safeParse(value).success).toBe(accepted)
		// The same boundary as the library's own check (bcryptjs README: "should be checked with
		// bcrypt.truncates(password)").
		expect(bcrypt.truncates(value)).toBe(!accepted)
	})

	it('keeps the 8-character minimum', () => {
		expect(PASSWORD_MIN).toBe(8)
		expect(passwordField.safeParse('1234567').success).toBe(false)
		expect(passwordField.safeParse('12345678').success).toBe(true)
	})
})

// The antd rule the account forms use (antd Form Rule `validator`): the same byte check as the server field.
describe('passwordBytesRule', () => {
	const { validator } = passwordBytesRule('too long')

	it.each(boundary)('%s: accepted is %s', async (_label, value, accepted) => {
		if (accepted) await expect(validator({}, value)).resolves.toBeUndefined()
		else await expect(validator({}, value)).rejects.toThrow('too long')
	})

	it('leaves an empty field to the required rule', async () => {
		await expect(validator({}, undefined)).resolves.toBeUndefined()
		await expect(validator({}, '')).resolves.toBeUndefined()
	})
})

// antd's `type: 'email'` accepted addresses z.email() refuses, so a form passed and the action answered invalid_input
// with no field marked (final review M-3). The forms now check with the server's own field.
describe('emailRule', () => {
	const { validator } = emailRule('invalid')

	it.each([
		'user@münchen.de',
		'jo#e@example.com',
		'o.brien!x@example.com',
		'a@localhost',
		`${'a'.repeat(250)}@example.com`,
	])('refuses %s, as the server field does', async value => {
		expect(emailField.safeParse(value).success).toBe(false)
		await expect(validator({}, value)).rejects.toThrow('invalid')
	})

	it('accepts an address the server field accepts', async () => {
		expect(emailField.safeParse('jane.doe@example.com').success).toBe(true)
		await expect(validator({}, 'jane.doe@example.com')).resolves.toBeUndefined()
	})

	it('leaves an empty field to the required rule', async () => {
		await expect(validator({}, undefined)).resolves.toBeUndefined()
		await expect(validator({}, '')).resolves.toBeUndefined()
	})
})

// The name fields had no client maximum against nameField's 255, so a longer name passed the form and the action
// answered invalid_input with no field marked (fix wave round 2).
describe('nameRule', () => {
	const { validator } = nameRule('too long')

	it.each([
		['255 characters', 'a'.repeat(255), true],
		['256 characters', 'a'.repeat(256), false],
		['255 characters inside spaces the server trims', `  ${'a'.repeat(255)}  `, true],
	] as const)(
		'%s: accepted is %s, as the server field decides',
		async (_label, value, accepted) => {
			expect(nameField.safeParse(value).success).toBe(accepted)
			if (accepted) await expect(validator({}, value)).resolves.toBeUndefined()
			else await expect(validator({}, value)).rejects.toThrow('too long')
		},
	)

	it('leaves an empty or blank name to the required rule with whitespace', async () => {
		await expect(validator({}, undefined)).resolves.toBeUndefined()
		await expect(validator({}, '')).resolves.toBeUndefined()
		await expect(validator({}, '   ')).resolves.toBeUndefined()
	})
})

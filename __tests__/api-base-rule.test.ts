import { describe, expect, it } from 'vitest'

import { validateApiBase } from '@/components/admin/apps/api-base-rule'

const MESSAGE = 'Enter a URL that starts with http:// or https://'
const validate = (value: unknown) => validateApiBase(MESSAGE)({}, value)

describe('validateApiBase (the API Base field, the action’s own URL check)', () => {
	it.each([
		'http://api:5001/v1',
		'http://nginx/v1',
		'https://dify.example/v1',
		'http://localhost:5001/v1',
	])('accepts %s, Docker service names included', async value => {
		await expect(validate(value)).resolves.toBeUndefined()
	})
	it.each(['dify.example/v1', 'www.dify.example/v1', 'ftp://dify.example/v1', '//dify.example/v1'])(
		'refuses %s with the given message',
		async value => {
			await expect(validate(value)).rejects.toThrow(MESSAGE)
		},
	)
	it('leaves an empty value to the required rule', async () => {
		await expect(validate('')).resolves.toBeUndefined()
		await expect(validate(undefined)).resolves.toBeUndefined()
	})
})

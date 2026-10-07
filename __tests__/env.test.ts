import { describe, expect, it } from 'vitest'

import { EnvError, parseEnv } from '@/lib/env'

const base = {
	DATABASE_URL: 'mysql://u:p@127.0.0.1:3306/db',
	NEXTAUTH_SECRET: 'not-a-secret',
}

describe('parseEnv', () => {
	it('parses the minimal environment with no mail', () => {
		expect(parseEnv(base)).toEqual({
			nodeEnv: 'development',
			databaseUrl: base.DATABASE_URL,
			nextAuthSecret: base.NEXTAUTH_SECRET,
			smtp: null,
		})
	})

	it('names the missing variables', () => {
		const error = (() => {
			try {
				parseEnv({ NEXTAUTH_SECRET: 'x' })
			} catch (e) {
				return e
			}
		})()
		expect(error).toBeInstanceOf(EnvError)
		expect((error as EnvError).keys).toEqual(['DATABASE_URL'])
		expect((error as Error).message).toContain('DATABASE_URL')
	})

	it('ignores partial SMTP values while SMTP_ENABLED is not true', () => {
		expect(
			parseEnv({ ...base, SMTP_ENABLED: 'false', SMTP_SERVER: 'smtp.example' }).smtp,
		).toBeNull()
	})

	it('requires the whole SMTP block once SMTP_ENABLED is true', () => {
		let keys: string[] = []
		try {
			parseEnv({ ...base, SMTP_ENABLED: 'true', SMTP_SERVER: 'smtp.example' })
		} catch (e) {
			keys = (e as EnvError).keys
		}
		expect(keys.sort()).toEqual(
			['APP_URL', 'MAIL_DEFAULT_SEND_FROM', 'SMTP_PASSWORD', 'SMTP_PORT', 'SMTP_USERNAME'].sort(),
		)
	})

	it('parses a full SMTP block, the port as a number', () => {
		const env = parseEnv({
			...base,
			NODE_ENV: 'production',
			SMTP_ENABLED: 'true',
			SMTP_SERVER: 'smtp.example',
			SMTP_PORT: '465',
			SMTP_USERNAME: 'mailer',
			SMTP_PASSWORD: 'pw',
			SMTP_USE_TLS: 'true',
			MAIL_DEFAULT_SEND_FROM: 'hub@example.com',
			APP_URL: 'https://hub.example.com/',
		})
		expect(env.nodeEnv).toBe('production')
		expect(env.smtp).toEqual({
			host: 'smtp.example',
			port: 465,
			username: 'mailer',
			password: 'pw',
			useTls: true,
			from: 'hub@example.com',
			appUrl: 'https://hub.example.com',
		})
	})

	it('rejects an APP_URL that is not a URL', () => {
		expect(() =>
			parseEnv({
				...base,
				SMTP_ENABLED: 'true',
				SMTP_SERVER: 'smtp.example',
				SMTP_PORT: '25',
				SMTP_USERNAME: 'm',
				SMTP_PASSWORD: 'p',
				MAIL_DEFAULT_SEND_FROM: 'a@b.c',
				APP_URL: 'not a url',
			}),
		).toThrow(EnvError)
	})
})

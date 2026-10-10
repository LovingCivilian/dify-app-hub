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
			ldap: null,
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
		let error: unknown
		try {
			parseEnv({
				...base,
				SMTP_ENABLED: 'true',
				SMTP_SERVER: 'smtp.example',
				SMTP_PORT: '25',
				SMTP_USERNAME: 'm',
				SMTP_PASSWORD: 'p',
				MAIL_DEFAULT_SEND_FROM: 'a@b.c',
				APP_URL: 'not a url',
			})
		} catch (e) {
			error = e
		}
		expect(error).toBeInstanceOf(EnvError)
		expect((error as EnvError).keys).toEqual(['APP_URL'])
	})

	// A blank flag counts as absent and a flag's case does not matter: a stray `SMTP_ENABLED=` in a .env file must
	// not take the app down (before B1, anything but 'true' meant mail off).
	it('reads a blank SMTP_ENABLED as absent: mail off, no SMTP variable required', () => {
		expect(parseEnv({ ...base, SMTP_ENABLED: '' }).smtp).toBeNull()
		expect(parseEnv({ ...base, SMTP_ENABLED: '  ' }).smtp).toBeNull()
	})

	const fullBlock = {
		SMTP_SERVER: 'smtp.example',
		SMTP_PORT: '587',
		SMTP_USERNAME: 'mailer',
		SMTP_PASSWORD: 'pw',
		MAIL_DEFAULT_SEND_FROM: 'hub@example.com',
		APP_URL: 'https://hub.example.com',
	}

	it('reads the flags without regard to case or surrounding blanks', () => {
		const env = parseEnv({ ...base, ...fullBlock, SMTP_ENABLED: 'TRUE', SMTP_USE_TLS: ' False ' })
		expect(env.smtp).toMatchObject({ host: 'smtp.example', port: 587, useTls: false })
	})

	it('falls back to the TLS default when SMTP_USE_TLS is blank', () => {
		expect(
			parseEnv({ ...base, ...fullBlock, SMTP_ENABLED: 'true', SMTP_USE_TLS: '' }).smtp,
		).toMatchObject({
			useTls: true,
		})
	})

	it('still refuses a flag that is neither true nor false', () => {
		let keys: string[] = []
		try {
			parseEnv({ ...base, SMTP_ENABLED: 'yes' })
		} catch (e) {
			keys = (e as EnvError).keys
		}
		expect(keys).toEqual(['SMTP_ENABLED'])
	})

	/** The settings an AD directory needs; everything else has a default (spec §7.1). */
	const ldapBlock = {
		LDAP_URL: 'ldap://10.0.0.5:389',
		LDAP_ENCRYPTION: 'none',
		LDAP_BIND_DN: 'CN=svc-hub,CN=Users,DC=corp,DC=example',
		LDAP_BIND_PASSWORD: ' pass word ',
		LDAP_USER_BASE_DN: 'DC=corp,DC=example',
	}
	const keysOfFailure = (source: Record<string, string>) => {
		try {
			parseEnv({ ...base, ...source })
		} catch (e) {
			return (e as EnvError).keys.sort()
		}
		return []
	}

	it('leaves the directory off without LDAP_URL, whatever else is set', () => {
		expect(parseEnv({ ...base, LDAP_ENCRYPTION: 'ldaps' }).ldap).toBeNull()
		expect(parseEnv({ ...base, LDAP_URL: '  ' }).ldap).toBeNull()
	})

	it('requires the whole block once LDAP_URL is set', () => {
		expect(keysOfFailure({ LDAP_URL: 'ldaps://dc.corp.example' })).toEqual([
			'LDAP_BIND_DN',
			'LDAP_BIND_PASSWORD',
			'LDAP_ENCRYPTION',
			'LDAP_USER_BASE_DN',
		])
	})

	it('applies the Active Directory defaults and takes the password as it is', () => {
		expect(parseEnv({ ...base, ...ldapBlock }).ldap).toEqual({
			url: 'ldap://10.0.0.5:389',
			encryption: 'none',
			caFile: null,
			bindDn: 'CN=svc-hub,CN=Users,DC=corp,DC=example',
			bindPassword: ' pass word ',
			userBaseDn: 'DC=corp,DC=example',
			userFilter:
				'(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))',
			loginAttribute: 'sAMAccountName',
			idAttribute: 'objectGUID',
			emailAttribute: 'mail',
			nameAttribute: 'displayName',
			groupBaseDn: 'DC=corp,DC=example',
			groupFilter: '(objectClass=group)',
			groupNameAttribute: 'cn',
			groupMemberFilter: '(memberOf:1.2.840.113556.1.4.1941:={group_dn})',
			syncSchedule: '0 * * * *',
			syncTimezone: null,
		})
	})

	it('reads a blank optional value as absent', () => {
		const ldap = parseEnv({ ...base, ...ldapBlock, LDAP_GROUP_BASE_DN: ' ', LDAP_CA_FILE: '' }).ldap
		expect(ldap).toMatchObject({ groupBaseDn: 'DC=corp,DC=example', caFile: null })
	})

	// Spec §7.1: ldaps goes with ldaps://, starttls and none with ldap://.
	it.each([
		['ldaps://dc.corp.example', 'none'],
		['ldaps://dc.corp.example', 'starttls'],
		['ldap://dc.corp.example', 'ldaps'],
	])('refuses %s with LDAP_ENCRYPTION=%s', (url, encryption) => {
		expect(keysOfFailure({ ...ldapBlock, LDAP_URL: url, LDAP_ENCRYPTION: encryption })).toEqual([
			'LDAP_ENCRYPTION',
		])
	})

	it.each([['ldap:host'], ['https://dc.corp.example'], ['dc.corp.example']])(
		'refuses LDAP_URL %s (decision d)',
		url => {
			expect(keysOfFailure({ ...ldapBlock, LDAP_URL: url })).toContain('LDAP_URL')
		},
	)

	it('refuses an attribute setting that is not an attribute name (decision d)', () => {
		// ldapts' filter parser cannot read a numeric OID as the attribute of a filter.
		expect(
			keysOfFailure({ ...ldapBlock, LDAP_LOGIN_ATTRIBUTE: '0.9.2342.19200300.100.1.1' }),
		).toEqual(['LDAP_LOGIN_ATTRIBUTE'])
		expect(keysOfFailure({ ...ldapBlock, LDAP_LOGIN_ATTRIBUTE: 'uid)(objectClass=*' })).toEqual([
			'LDAP_LOGIN_ATTRIBUTE',
		])
		expect(
			parseEnv({ ...base, ...ldapBlock, LDAP_ID_ATTRIBUTE: 'entryUUID' }).ldap?.idAttribute,
		).toBe('entryUUID')
	})

	it('refuses a filter ldapts cannot parse, or one without its outer parentheses (decision b)', () => {
		expect(keysOfFailure({ ...ldapBlock, LDAP_USER_FILTER: '(&(objectClass=user)))' })).toEqual([
			'LDAP_USER_FILTER',
		])
		expect(keysOfFailure({ ...ldapBlock, LDAP_GROUP_FILTER: 'objectClass=group' })).toEqual([
			'LDAP_GROUP_FILTER',
		])
		expect(keysOfFailure({ ...ldapBlock, LDAP_GROUP_MEMBER_FILTER: '(memberOf=cn=x)' })).toEqual([
			'LDAP_GROUP_MEMBER_FILTER',
		])
		expect(
			parseEnv({ ...base, ...ldapBlock, LDAP_GROUP_MEMBER_FILTER: '(memberOf={group_dn})' }).ldap
				?.groupMemberFilter,
		).toBe('(memberOf={group_dn})')
	})

	it('reads the schedule: off, five fields, a valid time zone (decision c)', () => {
		expect(
			parseEnv({ ...base, ...ldapBlock, LDAP_SYNC_SCHEDULE: 'off' }).ldap?.syncSchedule,
		).toBeNull()
		expect(
			parseEnv({ ...base, ...ldapBlock, LDAP_SYNC_SCHEDULE: ' OFF ' }).ldap?.syncSchedule,
		).toBeNull()
		expect(
			parseEnv({
				...base,
				...ldapBlock,
				LDAP_SYNC_SCHEDULE: '30 6 * * 1-5',
				LDAP_SYNC_TIMEZONE: 'Asia/Riyadh',
			}).ldap,
		).toMatchObject({ syncSchedule: '30 6 * * 1-5', syncTimezone: 'Asia/Riyadh' })
		expect(keysOfFailure({ ...ldapBlock, LDAP_SYNC_SCHEDULE: '*/5 * * * * *' })).toEqual([
			'LDAP_SYNC_SCHEDULE',
		])
		expect(keysOfFailure({ ...ldapBlock, LDAP_SYNC_SCHEDULE: 'every hour' })).toEqual([
			'LDAP_SYNC_SCHEDULE',
		])
		// Spec §7.1 and Review Focus 4: a pattern no date matches parses, but would never run the sync.
		expect(keysOfFailure({ ...ldapBlock, LDAP_SYNC_SCHEDULE: '0 0 31 2 *' })).toEqual([
			'LDAP_SYNC_SCHEDULE',
		])
		expect(keysOfFailure({ ...ldapBlock, LDAP_SYNC_TIMEZONE: 'Mars/Olympus' })).toEqual([
			'LDAP_SYNC_TIMEZONE',
		])
	})
})

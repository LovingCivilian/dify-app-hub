import 'server-only'

import { Cron } from 'croner'
import { escapeFilter, FilterParser } from 'ldapts'
import * as z from 'zod'

import { LDAP_ENCRYPTIONS, type LdapEncryption } from '@/lib/directory-status'

/**
 * A `'true' | 'false'` flag, read leniently: blanks around it and its case do not matter, and a blank value counts
 * as absent, so the default applies (`SMTP_ENABLED=` in a .env file means "not set", not an invalid value). zod 4's
 * `z.preprocess` runs before the inner schema, and `.default` answers the undefined it leaves.
 */
const flag = (fallback: 'true' | 'false') =>
	z.preprocess(
		value => (typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined),
		z.enum(['true', 'false']).default(fallback),
	)

const baseSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	DATABASE_URL: z.string().min(1),
	NEXTAUTH_SECRET: z.string().min(1),
	SMTP_ENABLED: flag('false'),
})

/** Required together once SMTP_ENABLED is true (charter §4.5: an all-or-nothing block). */
const smtpSchema = z.object({
	SMTP_SERVER: z.string().min(1),
	SMTP_PORT: z.coerce.number().int().positive(),
	SMTP_USERNAME: z.string().min(1),
	SMTP_PASSWORD: z.string().min(1),
	SMTP_USE_TLS: flag('true'),
	MAIL_DEFAULT_SEND_FROM: z.string().min(1),
	APP_URL: z.url(),
})

/** A blank value counts as absent, so the inner default applies; any other value reaches the inner schema unchanged. */
const blankAsAbsent = <T extends z.ZodType>(inner: T) =>
	z.preprocess(
		value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
		inner,
	)

/**
 * RFC 4512 §1.4: a descriptor, a letter then letters, digits and hyphens (decision d). Not a numeric OID, which RFC 4512
 * allows too: ldapts' filter parser reads an attribute as `[\w-]+` (src/FilterParser.ts), so `(2.5.4.3=x)` fails at the
 * search ("Invalid expression"), and these names go into filters.
 */
const ATTRIBUTE_NAME = /^[A-Za-z][A-Za-z0-9-]*$/

/** The placeholder LDAP_GROUP_MEMBER_FILTER carries for a group's DN (spec §6.5). */
export const GROUP_DN_PLACEHOLDER = '{group_dn}'

/** Decision b: wrapped in parentheses (RFC 4515 §3) and readable by the parser ldapts' search() uses. */
const isFilter = (value: string): boolean => {
	if (!value.startsWith('(') || !value.endsWith(')')) return false
	try {
		FilterParser.parseString(value)
		return true
	} catch {
		return false
	}
}

const isMemberFilter = (value: string): boolean =>
	value.includes(GROUP_DN_PLACEHOLDER) &&
	isFilter(value.replaceAll(GROUP_DN_PLACEHOLDER, escapeFilter`${'CN=Sample Group,DC=example'}`))

/**
 * MDN, `Intl.DateTimeFormat()` constructor: `timeZone` is an IANA name or an offset identifier such as "+01:00", and an
 * invalid value throws a RangeError. The canonical spelling is `resolvedOptions().timeZone` ("asia/riyadh" becomes
 * "Asia/Riyadh"). Checked on its own so a bad zone is named even while the schedule is `off`.
 */
const isTimeZone = (value: string): boolean => {
	try {
		new Intl.DateTimeFormat(undefined, { timeZone: value })
		return true
	} catch {
		return false
	}
}
const canonicalTimeZone = (value: string): string =>
	new Intl.DateTimeFormat(undefined, { timeZone: value }).resolvedOptions().timeZone

const attribute = (fallback: string) =>
	blankAsAbsent(z.string().trim().regex(ATTRIBUTE_NAME).default(fallback))
const filter = (fallback: string) =>
	blankAsAbsent(z.string().trim().refine(isFilter).default(fallback))

/**
 * Required together once LDAP_URL is set (spec §7.1: all or nothing, like the SMTP block). The defaults are Active
 * Directory's: Microsoft lists the user filter as "All enabled user objects" (archived TechNet wiki on Learn, "Active
 * Directory: LDAP Syntax Filters"), and the member filter walks nested groups (ADSI "Search Filter Syntax",
 * LDAP_MATCHING_RULE_IN_CHAIN).
 */
const ldapSchema = z
	.object({
		LDAP_URL: z.url({ protocol: /^ldaps?$/, hostname: /.+/ }),
		LDAP_ENCRYPTION: z.preprocess(
			value => (typeof value === 'string' ? value.trim().toLowerCase() : value),
			z.enum(LDAP_ENCRYPTIONS),
		),
		LDAP_CA_FILE: blankAsAbsent(z.string().trim().optional()),
		LDAP_BIND_DN: z.string().trim().min(1),
		LDAP_BIND_PASSWORD: z.string().min(1),
		LDAP_USER_BASE_DN: z.string().trim().min(1),
		LDAP_USER_FILTER: filter(
			'(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))',
		),
		LDAP_LOGIN_ATTRIBUTE: attribute('sAMAccountName'),
		LDAP_ID_ATTRIBUTE: attribute('objectGUID'),
		LDAP_EMAIL_ATTRIBUTE: attribute('mail'),
		LDAP_NAME_ATTRIBUTE: attribute('displayName'),
		LDAP_GROUP_BASE_DN: blankAsAbsent(z.string().trim().optional()),
		LDAP_GROUP_FILTER: filter('(objectClass=group)'),
		LDAP_GROUP_NAME_ATTRIBUTE: attribute('cn'),
		LDAP_GROUP_MEMBER_FILTER: blankAsAbsent(
			z
				.string()
				.trim()
				.refine(isMemberFilter)
				.default(`(memberOf:1.2.840.113556.1.4.1941:=${GROUP_DN_PLACEHOLDER})`),
		),
		LDAP_SYNC_SCHEDULE: blankAsAbsent(z.string().trim().default('0 * * * *')),
		LDAP_SYNC_TIMEZONE: blankAsAbsent(
			z
				.string()
				.trim()
				.refine(isTimeZone, 'a time zone name or offset')
				.transform(canonicalTimeZone)
				.optional(),
		),
	})
	.superRefine(
		(value, context) => {
			const secure = new URL(value.LDAP_URL).protocol === 'ldaps:'
			if (secure !== (value.LDAP_ENCRYPTION === 'ldaps'))
				context.addIssue({
					code: 'custom',
					path: ['LDAP_ENCRYPTION'],
					message: 'ldaps goes with ldaps://; starttls and none with ldap://',
				})
			const schedule = value.LDAP_SYNC_SCHEDULE
			if (schedule.toLowerCase() === 'off') return
			// Decision c: croner's `mode: '5-part'` (croner.d.ts: traditional five-field cron, anything else throws; a Cron
			// without a function parses the pattern and schedules nothing), and a pattern that fires: one no date matches
			// (`0 0 31 2 *`) parses, but its nextRun() answers null (`Date | null`).
			try {
				if (new Cron(schedule, { mode: '5-part' }).nextRun() === null) throw new Error('never runs')
			} catch {
				context.addIssue({
					code: 'custom',
					path: ['LDAP_SYNC_SCHEDULE'],
					message: 'a five-field cron expression that fires, or off',
				})
			}
		},
		{
			// zod 4 runs an object's refinement after continuable field issues too (a failed z.url() or refine() leaves the
			// raw string, and new URL() would throw); the cross-field checks run only once every field has parsed (zod
			// "Refinements", the `when` parameter; $ZodSuperRefineParams in zod/v4/core/api.d.ts).
			when: payload => payload.issues.length === 0,
		},
	)

export interface LdapConfig {
	url: string
	encryption: LdapEncryption
	/** A PEM file with the CA that signed the directory's certificate; Node's trust store when null. */
	caFile: string | null
	bindDn: string
	bindPassword: string
	userBaseDn: string
	userFilter: string
	loginAttribute: string
	idAttribute: string
	emailAttribute: string
	nameAttribute: string
	groupBaseDn: string
	groupFilter: string
	groupNameAttribute: string
	/** Carries GROUP_DN_PLACEHOLDER, replaced by a group's escaped DN at run time. */
	groupMemberFilter: string
	/** A five-field cron expression; null for `off`. */
	syncSchedule: string | null
	/** An IANA time zone; the process's zone when null (UTC in the image). */
	syncTimezone: string | null
}

export interface SmtpConfig {
	host: string
	port: number
	username: string
	password: string
	useTls: boolean
	from: string
	/** Without a trailing slash: the reset link is `${appUrl}/reset-password?token=…`. */
	appUrl: string
}

export interface ServerEnv {
	nodeEnv: 'development' | 'test' | 'production'
	databaseUrl: string
	nextAuthSecret: string
	smtp: SmtpConfig | null
	ldap: LdapConfig | null
}

export class EnvError extends Error {
	constructor(public readonly keys: string[]) {
		super(`Missing or invalid environment variables: ${keys.join(', ')}`)
		this.name = 'EnvError'
	}
}

const keysOf = (error: z.ZodError) => Object.keys(z.flattenError(error).fieldErrors)

/** Pure: the environment as the app reads it, or an EnvError naming every missing or invalid variable. */
export const parseEnv = (source: Record<string, string | undefined>): ServerEnv => {
	const base = baseSchema.safeParse(source)
	if (!base.success) throw new EnvError(keysOf(base.error))
	let smtp: SmtpConfig | null = null
	if (base.data.SMTP_ENABLED === 'true') {
		const parsed = smtpSchema.safeParse(source)
		if (!parsed.success) throw new EnvError(keysOf(parsed.error))
		smtp = {
			host: parsed.data.SMTP_SERVER,
			port: parsed.data.SMTP_PORT,
			username: parsed.data.SMTP_USERNAME,
			password: parsed.data.SMTP_PASSWORD,
			useTls: parsed.data.SMTP_USE_TLS === 'true',
			from: parsed.data.MAIL_DEFAULT_SEND_FROM,
			appUrl: parsed.data.APP_URL.replace(/\/$/, ''),
		}
	}
	let ldap: LdapConfig | null = null
	if (typeof source.LDAP_URL === 'string' && source.LDAP_URL.trim() !== '') {
		const parsed = ldapSchema.safeParse(source)
		if (!parsed.success) throw new EnvError(keysOf(parsed.error))
		const data = parsed.data
		ldap = {
			url: data.LDAP_URL,
			encryption: data.LDAP_ENCRYPTION,
			caFile: data.LDAP_CA_FILE ?? null,
			bindDn: data.LDAP_BIND_DN,
			bindPassword: data.LDAP_BIND_PASSWORD,
			userBaseDn: data.LDAP_USER_BASE_DN,
			userFilter: data.LDAP_USER_FILTER,
			loginAttribute: data.LDAP_LOGIN_ATTRIBUTE,
			idAttribute: data.LDAP_ID_ATTRIBUTE,
			emailAttribute: data.LDAP_EMAIL_ATTRIBUTE,
			nameAttribute: data.LDAP_NAME_ATTRIBUTE,
			groupBaseDn: data.LDAP_GROUP_BASE_DN ?? data.LDAP_USER_BASE_DN,
			groupFilter: data.LDAP_GROUP_FILTER,
			groupNameAttribute: data.LDAP_GROUP_NAME_ATTRIBUTE,
			groupMemberFilter: data.LDAP_GROUP_MEMBER_FILTER,
			syncSchedule:
				data.LDAP_SYNC_SCHEDULE.toLowerCase() === 'off' ? null : data.LDAP_SYNC_SCHEDULE,
			syncTimezone: data.LDAP_SYNC_TIMEZONE ?? null,
		}
	}
	return {
		nodeEnv: base.data.NODE_ENV,
		databaseUrl: base.data.DATABASE_URL,
		nextAuthSecret: base.data.NEXTAUTH_SECRET,
		smtp,
		ldap,
	}
}

let cached: ServerEnv | undefined

/**
 * The server environment, parsed on first use and kept for the process. Nothing calls it at module load, so
 * `next build` (which has no DATABASE_URL in the image build) never trips it; the first request does, with the
 * variable's name in the error. The only place in lib/ that reads process.env (charter §4.3 rules).
 */
export const env = (): ServerEnv => (cached ??= parseEnv(process.env))

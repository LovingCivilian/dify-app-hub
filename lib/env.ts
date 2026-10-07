import 'server-only'

import * as z from 'zod'

const flag = z.enum(['true', 'false'])

const baseSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	DATABASE_URL: z.string().min(1),
	NEXTAUTH_SECRET: z.string().min(1),
	SMTP_ENABLED: flag.default('false'),
})

/** Required together once SMTP_ENABLED is true (charter §4.5: an all-or-nothing block). */
const smtpSchema = z.object({
	SMTP_SERVER: z.string().min(1),
	SMTP_PORT: z.coerce.number().int().positive(),
	SMTP_USERNAME: z.string().min(1),
	SMTP_PASSWORD: z.string().min(1),
	SMTP_USE_TLS: flag.default('true'),
	MAIL_DEFAULT_SEND_FROM: z.string().min(1),
	APP_URL: z.url(),
})

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
	return {
		nodeEnv: base.data.NODE_ENV,
		databaseUrl: base.data.DATABASE_URL,
		nextAuthSecret: base.data.NEXTAUTH_SECRET,
		smtp,
	}
}

let cached: ServerEnv | undefined

/**
 * The server environment, parsed on first use and kept for the process. Nothing calls it at module load, so
 * `next build` (which has no DATABASE_URL in the image build) never trips it; the first request does, with the
 * variable's name in the error. The only place in lib/ that reads process.env (charter §4.3 rules).
 */
export const env = (): ServerEnv => (cached ??= parseEnv(process.env))

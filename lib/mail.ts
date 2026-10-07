import 'server-only'

import nodemailer from 'nodemailer'

import { env } from '@/lib/env'

function maskEmail(email: string) {
	const [localPart, domain] = email.split('@')
	if (!localPart || !domain) return '[invalid-email]'
	return `${localPart.slice(0, 2)}***@${domain}`
}

/** The SMTP block of the environment parsed (charter §4.5): the forgot-password page offers the form only then. */
export function isMailConfigured() {
	return env().smtp !== null
}

export async function sendPasswordResetEmail(email: string, token: string) {
	const smtp = env().smtp
	if (!smtp) throw new Error('Mail is not configured')

	const secure = smtp.useTls && smtp.port === 465
	const transport = nodemailer.createTransport({
		host: smtp.host,
		port: smtp.port,
		secure,
		requireTLS: smtp.useTls && smtp.port !== 465,
		tls: { minVersion: 'TLSv1.2' },
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 30_000,
		auth: { user: smtp.username, pass: smtp.password },
	})

	try {
		const result = await transport.sendMail({
			from: smtp.from,
			to: email,
			subject: 'Reset your password',
			text: `Open this link within 15 minutes to reset your password:\n${smtp.appUrl}/reset-password?token=${token}`,
		})
		console.info('Password reset email accepted by SMTP', {
			to: maskEmail(email),
			messageId: result.messageId,
			accepted: result.accepted.length,
			rejected: result.rejected.length,
			response: result.response,
		})
	} catch (error) {
		console.error('SMTP failed to send the password reset email', {
			to: maskEmail(email),
			error: error instanceof Error ? error.message : String(error),
		})
		throw error
	}
}

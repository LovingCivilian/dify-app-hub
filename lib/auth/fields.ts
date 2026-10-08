import * as z from 'zod'

/**
 * Account fields shared by the action schemas and the antd form rules (client-safe). Eight characters minimum, as
 * every form had. The maximum is bcrypt's input: it reads only the first 72 bytes (bcryptjs README), so a longer
 * password is refused rather than truncated (OWASP Password Storage Cheat Sheet, "Input Limits of bcrypt": "enforce
 * a maximum password length of 72 bytes"). That is 72 Latin letters, above NIST SP 800-63B's 64 characters, and
 * fewer characters in other scripts (ADR-0024 decision f).
 */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX_BYTES = 72

const utf8 = new TextEncoder()

/** The password's UTF-8 encoding fits bcrypt's input (MDN `TextEncoder.encode`: the UTF-8 bytes as a Uint8Array). */
const fitsBcrypt = (value: string) => utf8.encode(value).length <= PASSWORD_MAX_BYTES

export const passwordField = z
	.string()
	.min(PASSWORD_MIN)
	.refine(fitsBcrypt, { error: `At most ${PASSWORD_MAX_BYTES} bytes in UTF-8` })
export const emailField = z.email().max(255)
export const nameField = z.string().trim().min(1).max(255)

/**
 * An antd Form rule running one of these checks (antd Form Rule `validator`), so the form and the action agree by
 * construction. An empty value passes and the `required` rule alone reports it (antd Form "register" demo).
 */
const ruleFor = (check: (value: string) => boolean) => (message: string) => ({
	validator: (_rule: unknown, value: unknown) =>
		typeof value !== 'string' || value === '' || check(value)
			? Promise.resolve()
			: Promise.reject(new Error(message)),
})

/** The password fields' maximum: the same byte check as `passwordField`. */
export const passwordBytesRule = ruleFor(fitsBcrypt)

/** The email fields of the forms that post to a zod-validated action: `emailField` itself (ADR-0024 decision k). */
export const emailRule = ruleFor(value => emailField.safeParse(value).success)

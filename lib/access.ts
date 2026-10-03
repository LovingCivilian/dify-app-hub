// Pages and APIs reachable without a session. Everything else needs one
// (enforced in proxy.ts); /api/* routes outside /api/client check themselves.
const PUBLIC_PREFIXES = [
	'/login',
	'/forgot-password',
	'/reset-password',
	'/init',
	'/api/auth',
	'/api/init',
	'/api/health',
	'/_next',
	'/favicon.ico',
]

const startsWithSegment = (pathname: string, prefix: string) =>
	pathname === prefix || pathname.startsWith(`${prefix}/`)

export const isPublicPath = (pathname: string): boolean =>
	PUBLIC_PREFIXES.some(prefix => startsWithSegment(pathname, prefix))

export const isClientApiPath = (pathname: string): boolean =>
	startsWithSegment(pathname, '/api/client')

/**
 * The callbackUrl the login page may navigate to: a same-site path, else "/".
 * Browsers strip tab, LF and CR from anywhere in a URL before parsing it, so
 * "/\t/evil.example" would become the protocol-relative "//evil.example".
 * The prefix checks alone miss that, so the origin is checked after parsing.
 */
export const getSafeCallbackUrl = (value: string | null | undefined): string => {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
		return '/'
	}
	const base = 'http://localhost'
	try {
		if (new URL(value, base).origin !== base) return '/'
	} catch {
		return '/'
	}
	return value
}

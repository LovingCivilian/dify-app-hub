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
 */
export const getSafeCallbackUrl = (value: string | null | undefined): string => {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
		return '/'
	}
	return value
}

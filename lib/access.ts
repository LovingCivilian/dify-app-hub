// Pages and APIs reachable without a session. Everything else needs one,
// enforced in proxy.ts on the decoded pathname: pages redirect to /login and
// every other /api path answers 401. The /api/dify handlers also check the
// session themselves.

// Public pages still go through the init-status check in proxy.ts.
const PUBLIC_PAGES = ['/login', '/forgot-password', '/reset-password']

// Passed through by proxy.ts untouched, with no session or init-status check:
// the init page and its API, auth, health and Next's own assets.
const UNGATED_PREFIXES = [
	'/init',
	'/api/auth',
	'/api/init',
	'/api/health',
	'/_next',
	'/favicon.ico',
]

const startsWithSegment = (pathname: string, prefix: string) =>
	pathname === prefix || pathname.startsWith(`${prefix}/`)

export const isUngatedPath = (pathname: string): boolean =>
	UNGATED_PREFIXES.some(prefix => startsWithSegment(pathname, prefix))

export const isPublicPath = (pathname: string): boolean =>
	isUngatedPath(pathname) || PUBLIC_PAGES.some(prefix => startsWithSegment(pathname, prefix))

export const isApiPath = (pathname: string): boolean => startsWithSegment(pathname, '/api')

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

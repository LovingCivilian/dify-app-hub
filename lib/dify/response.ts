import 'server-only'

/**
 * `Response.json` for every JSON answer of the Dify routes, the app's envelopes included: one user's data behind the
 * session cookie, with `Cache-Control: private, no-store`. Next adds no Cache-Control to a dynamic Route Handler's
 * answer (its app-route handler sends the handler's own headers), and without one a cache may store an answer
 * heuristically (MDN Cache-Control, "Up-to-date contents always"); `no-store` keeps it out of every cache (ADR-0023).
 */
export const difyJson = (body: unknown, init: ResponseInit = {}): Response => {
	const headers = new Headers(init.headers)
	headers.set('cache-control', 'private, no-store')
	return Response.json(body, { ...init, headers })
}

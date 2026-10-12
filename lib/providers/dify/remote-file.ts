/**
 * A file link Dify handed out (a message file's `url`, a generated image, a `source_url`) as a URL the app may
 * fetch on the user's behalf: the Dify origin only (scheme, host and port of the app's API base), under `/files/`
 * or `<base path>/files/`, with no traversal (the URL parser normalises `..`, so the check runs on the final
 * path). Anything else is null and the route answers 400 (Review Focus 5).
 *
 * The parser keeps `%2F`, `%5C` and `%25` encoded, so `/files/..%2fconversations` keeps its literal prefix; a reverse
 * proxy in front of Dify that decodes and normalises before forwarding would turn it into another endpoint called
 * with the app's key. Dify's file links never carry those escapes in their path, so they are refused outright, as
 * is userinfo in the link (fetch would reject it later, as a 502 instead of a 400).
 */
export const resolveRemoteFileUrl = (raw: string, apiBase: string): URL | null => {
	if (!raw) return null
	let base: URL
	let url: URL
	try {
		base = new URL(apiBase)
		url = new URL(raw, base.origin)
	} catch {
		return null
	}
	if (url.origin !== base.origin) return null
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
	if (url.username || url.password) return null
	if (/%(2f|5c|25)/i.test(url.pathname)) return null
	const basePath = base.pathname.replace(/\/+$/, '')
	const allowed =
		url.pathname.startsWith('/files/') || url.pathname.startsWith(`${basePath}/files/`)
	return allowed ? url : null
}

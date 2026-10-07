import type { DifyApi } from '@/lib/dify/browser'

/**
 * A file link Dify handed out (a message file's url, a generated image) as the browser may load it: through the
 * app's remote-file route, which fetches it on the user's behalf (charter §4.1: the Dify host never reaches the
 * browser, and need not be reachable from it). An empty link stays empty.
 */
export const fileLink = (url: string, difyApi: Pick<DifyApi, 'remoteFileUrl'>): string =>
	url ? difyApi.remoteFileUrl(url) : ''

/**
 * antd's Upload reports the list it was given, whose urls are the proxied links the list shows (`fileLink`); stored
 * in the form value they would be proxied again on the next render. This puts the link Dify gave back on each item
 * the value already held (matched by `uid`); items it did not hold (new uploads) are kept as reported.
 */
export const withGivenLinks = <T extends { uid: string; url?: string }>(
	reported: T[],
	held: ReadonlyArray<{ uid: string; url?: string }>,
): T[] => {
	const given = new Map(held.map(item => [item.uid, item.url]))
	return reported.map(item => (given.has(item.uid) ? { ...item, url: given.get(item.uid) } : item))
}

const SIGNATURE_PARAMS = ['timestamp', 'nonce', 'sign']

/**
 * Whether a link in an answer's text is one Dify wrote for a file it holds. Dify's `File.markdown` (graphon) puts the
 * signed url into the answer (`![name](url)` for an image, `[name](url)` otherwise); `api/core/tools/signature.py`
 * shapes it as `/files/tools/<id><ext>?timestamp=&nonce=&sign=` or `/files/<id>/image-preview?timestamp=&nonce=&sign=`,
 * on FILES_URL (its path may carry a prefix). Taken: a relative link under `/files/`, and an absolute http(s) link
 * whose path contains `/files/` and whose query carries all three signature parameters. Everything else (links an
 * author wrote, `data:` URLs, anchors) is not Dify's and stays as written.
 */
export const isDifyFileLink = (url: string): boolean => {
	if (url.startsWith('/files/')) return true
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return false
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
	return (
		parsed.pathname.includes('/files/') &&
		SIGNATURE_PARAMS.every(name => Boolean(parsed.searchParams.get(name)))
	)
}

/**
 * A link in an answer's Markdown or HTML (image, video or source `src`, anchor `href`) as the browser may load it: a
 * Dify file link goes through the remote-file route (charter §4.1), anything else is returned as written. A link the
 * route refuses is never loaded from its original host instead.
 */
export const answerLink = (
	url: string | undefined,
	difyApi: Pick<DifyApi, 'remoteFileUrl'>,
): string | undefined => (url && isDifyFileLink(url) ? fileLink(url, difyApi) : url)

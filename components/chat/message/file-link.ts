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

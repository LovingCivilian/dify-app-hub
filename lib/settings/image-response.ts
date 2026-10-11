import { difyErrorResponse } from '@/lib/dify/errors'

import type { BrandImageKind } from './branding-rules'
import { readBrandImage, readBrandImageVersion } from './branding'

/**
 * A brand image answer (settings spec §4.5), shaped like the app-icon route (app/api/apps/[appId]/icon/route.ts): public,
 * since the brand is, and revalidated on every use (RFC 9111 §5.2.2.4 no-cache), so a new logo shows at once and an
 * unchanged one costs a 304 through its ETag (RFC 9110 §13.1.2). The hub only serves PNGs it produced; nosniff and the
 * sandboxing CSP keep the answer inert if opened on its own.
 *
 * Version first: a conditional request needs only the validator (RFC 9110 §13.1.2), so the stored hash answers a matching
 * `If-None-Match` and the bytes are read only for a 200. That body is tagged with its own hash, so it always matches its
 * ETag even when a save lands between the two reads.
 */
export const brandImageResponse = async (
	request: Request,
	kind: BrandImageKind,
): Promise<Response> => {
	const version = await readBrandImageVersion(kind)
	if (!version) return notFound()
	const headers = (sha256: string) => ({
		etag: `"${sha256.slice(0, 32)}"`,
		'cache-control': 'public, no-cache',
		'x-content-type-options': 'nosniff',
		'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
	})
	const known = headers(version)
	if (request.headers.get('if-none-match') === known.etag)
		return new Response(null, { status: 304, headers: known })
	const image = await readBrandImage(kind)
	if (!image) return notFound()
	return new Response(new Uint8Array(image.bytes), {
		headers: {
			...headers(image.sha256),
			'content-type': 'image/png',
			'content-length': String(image.bytes.length),
		},
	})
}

const notFound = () => difyErrorResponse('not_found', 'No custom image is set.', 404)

import Image from 'next/image'

import {
	BRAND_FAVICON_PATH,
	BRAND_LOGO_PATH,
	type BrandImageSource,
} from '@/lib/settings/branding-rules'

/** The width that keeps the image's proportions at the display height (next/image needs both, image.md:105-113). */
export const scaledWidth = (image: BrandImageSource, height: number): number =>
	Math.max(1, Math.round((image.width * height) / image.height))

/** A custom image: one of the hub's two image routes (spec §4.5), with or without its `?v=` query. */
export const isCustomImage = (image: BrandImageSource): boolean =>
	[BRAND_LOGO_PATH, BRAND_FAVICON_PATH].some(
		path => image.src === path || image.src.startsWith(`${path}?`),
	)

/**
 * The brand image (settings spec §4.6). The built-in image goes through Next's optimizer from its static import, as
 * before. A custom image is `unoptimized`, "served as-is from the `src`" (image.md:391-412): the hub already decoded and
 * re-encoded it to a PNG (lib/settings/images.ts), and its `?v=` URL is a local source with a query string, which the
 * optimizer takes only with `images.localPatterns.search` configured (upgrading/version-16.md:664). No
 * 'use client': the header, the login card and the settings page bring it into the client graph
 * (server-and-client-components.md:180). The header and the login card place the name.
 */
export default function BrandLogo({
	image,
	height,
	alt,
}: {
	image: BrandImageSource
	height: number
	alt: string
}) {
	return (
		<Image
			src={image.src}
			width={scaledWidth(image, height)}
			height={height}
			alt={alt}
			loading="eager"
			unoptimized={isCustomImage(image)}
		/>
	)
}

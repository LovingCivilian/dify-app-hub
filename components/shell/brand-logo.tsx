'use client'

import Image from 'next/image'

import type { BrandImageSource } from '@/lib/settings/branding-rules'

/** The width that keeps the image's proportions at the display height (next/image needs both, image.md:105-113). */
export const scaledWidth = (image: BrandImageSource, height: number): number =>
	Math.max(1, Math.round((image.width * height) / image.height))

/**
 * The brand image (settings spec §4.6), drawn as the hub stored it: `unoptimized` (image.md:391-412), since a custom image
 * is already a small PNG the hub produced and the built-in one is tiny. The header and the login card place the name.
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
			unoptimized
		/>
	)
}

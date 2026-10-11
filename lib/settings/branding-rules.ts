import * as z from 'zod'

/** The brand the hub ships with (settings spec §4.1). */
export const BUILT_IN_BRAND_NAME = 'Dify App Hub'

/** Spec §4.1: trimmed, 1–64 characters (zod 4.5 and later count Unicode code points, not UTF-16 units: zod docs, "Zod 4.5" release notes and the `z.string()` API page). One name for every language: it is a proper name. */
export const BRAND_NAME_MAX = 64
export const brandNameSchema = z.string().trim().min(1).max(BRAND_NAME_MAX)

export const BRAND_IMAGE_KINDS = ['logo', 'favicon'] as const
export type BrandImageKind = (typeof BRAND_IMAGE_KINDS)[number]

/** Spec §2 #11: one save stays under Next's default 1 MB Server Action body (serverActions.md:29-45). */
export const BRAND_IMAGE_MAX_BYTES: Readonly<Record<BrandImageKind, number>> = {
	logo: 512 * 1024,
	favicon: 256 * 1024,
}

/** What the file picker offers and the browser's quick check takes; the server decides (OWASP File Upload Cheat Sheet). */
export const BRAND_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

/** Why the server refused an image (spec §4.4): over the byte limit, or not a PNG, JPEG or WebP that decodes. */
export const BRAND_IMAGE_ERROR_CODES = ['too_large', 'not_allowed'] as const
export type BrandImageErrorCode = (typeof BRAND_IMAGE_ERROR_CODES)[number]

/** The two public image routes (spec §4.5). */
export const BRAND_LOGO_PATH = '/api/branding/logo'
export const BRAND_FAVICON_PATH = '/api/branding/favicon'

/** An image the browser draws: a URL and its intrinsic size (next/image needs both, image.md:105-113). */
export interface BrandImageSource {
	src: string
	width: number
	height: number
}

/** The brand as the shell draws it (spec §4.6), trimmed for the client (ADR-0020). */
export interface BrandingView {
	name: string
	/** Already effective: true whenever there is no logo. */
	showName: boolean
	/** null: the name only. */
	logo: BrandImageSource | null
	faviconSrc: string
}

/** Spec §4.2: the name shows whenever no logo can be drawn, so the header and the login card are never empty. */
export const effectiveShowName = (showName: boolean, hasLogo: boolean): boolean =>
	showName || !hasLogo

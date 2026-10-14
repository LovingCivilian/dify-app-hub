/*
 * The image upload rules every kind shares (settings spec §4.4; Part 1 spec §4.4), client-safe so the pickers' quick
 * check reads the same values as the server. The server decodes and decides (OWASP File Upload Cheat Sheet).
 */

/** What a file picker offers and the browser's quick check takes. */
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

/** Why the server refused an image: over the byte limit, or not a PNG, JPEG or WebP that decodes. */
export const IMAGE_ERROR_CODES = ['too_large', 'not_allowed'] as const
export type ImageErrorCode = (typeof IMAGE_ERROR_CODES)[number]

/**
 * An app icon's input cap (512 KB, as the logo's; owner, 2026-10-12): with the form's other fields a save stays under
 * Next's default Server Action body limit (Next docs, next.config.js options: "By default, the maximum size of the
 * request body sent to a Server Action is 1MB"; the limit "applies to the raw HTTP request body").
 */
export const APP_ICON_MAX_BYTES = 512 * 1024

/** Spec §4.4: the stored icon is at most this many pixels on its longer side. */
export const APP_ICON_SIZE = 256

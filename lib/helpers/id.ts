/**
 * Whether the ID is a temporary one
 */
export const isTempId = (id: string | undefined) => {
	if (!id) {
		return false
	}
	return id.startsWith('temp')
}

/**
 * Generates an RFC 4122 UUID v4
 * Works in the browser and in Node.js, with no third-party library
 */
export const generateUuidV4 = (): string => {
	// Check for crypto.getRandomValues (browser) or crypto.randomBytes (Node.js)
	let randomBytes: (size: number) => Uint8Array

	if (typeof crypto !== 'undefined') {
		if (crypto.getRandomValues) {
			// Browser environment
			randomBytes = (size: number) => {
				const array = new Uint8Array(size)
				crypto.getRandomValues(array)
				return array
			}
		} else if ('randomBytes' in crypto) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			randomBytes = (crypto as any).randomBytes
		} else {
			// Fall back to Math.random (not recommended, but a last resort)
			randomBytes = (size: number) => {
				const array = new Uint8Array(size)
				for (let i = 0; i < size; i++) {
					array[i] = Math.floor(Math.random() * 256)
				}
				return array
			}
		}
	} else {
		// Fall back to Math.random
		randomBytes = (size: number) => {
			const array = new Uint8Array(size)
			for (let i = 0; i < size; i++) {
				array[i] = Math.floor(Math.random() * 256)
			}
			return array
		}
	}

	// Generate 16 random bytes
	const bytes = randomBytes(16)

	// Set the version (4) and variant bits
	bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
	bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 1

	// Convert to a hexadecimal string
	const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

	// Format as a UUID: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20, 32),
	].join('-')
}

/**
 * Checks that a string is a well-formed UUID
 * @param uuid the UUID string to check
 * @returns whether it is a valid UUID
 */
export const isValidUuid = (uuid: string): boolean => {
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
	return uuidRegex.test(uuid)
}

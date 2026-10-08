import pako from 'pako'

/**
 * Decompresses a gzip string
 * @param encodedStr the gzip-compressed string (Base64-encoded)
 */
export const unParseGzipString = (encodedStr: string) => {
	try {
		// Base64 decode
		const binaryString = atob(encodedStr)
		const bytes = new Uint8Array(binaryString.length)
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i)
		}
		// gzip decompress
		const decompressedData = pako.inflate(bytes, { to: 'string' })
		return {
			error: false,
			data: decompressedData,
		}
	} catch (error) {
		console.error('Error during decompression:', error)
		return {
			error: error,
			data: '',
		}
	}
}

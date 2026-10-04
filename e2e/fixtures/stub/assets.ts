/** 1×1 transparent PNG and a 44-byte silent WAV header: enough for <img>, Image preview and <audio>. */
export const STUB_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64',
)

export const STUB_WAV = (() => {
	const header = Buffer.alloc(44)
	header.write('RIFF', 0)
	header.writeUInt32LE(36, 4)
	header.write('WAVE', 8)
	header.write('fmt ', 12)
	header.writeUInt32LE(16, 16)
	header.writeUInt16LE(1, 20)
	header.writeUInt16LE(1, 22)
	header.writeUInt32LE(8000, 24)
	header.writeUInt32LE(8000, 28)
	header.writeUInt16LE(1, 32)
	header.writeUInt16LE(8, 34)
	header.write('data', 36)
	header.writeUInt32LE(0, 40)
	return header
})()

/**
 * 1×1 transparent PNG and a silent WAV (8 kHz, 8-bit mono, 3 s: 24 KB): enough for <img>, Image preview and
 * <audio>; the clip plays long enough for a test to see text-to-speech running and to stop it.
 */
export const STUB_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64',
)

/** Samples per second (and bytes, at 8 bits mono) and the clip's length. */
const WAV_RATE = 8000
const WAV_SECONDS = 3

export const STUB_WAV = (() => {
	const samples = WAV_RATE * WAV_SECONDS
	const wav = Buffer.alloc(44 + samples)
	wav.write('RIFF', 0)
	wav.writeUInt32LE(36 + samples, 4)
	wav.write('WAVE', 8)
	wav.write('fmt ', 12)
	wav.writeUInt32LE(16, 16)
	wav.writeUInt16LE(1, 20)
	wav.writeUInt16LE(1, 22)
	wav.writeUInt32LE(WAV_RATE, 24)
	wav.writeUInt32LE(WAV_RATE, 28)
	wav.writeUInt16LE(1, 32)
	wav.writeUInt16LE(8, 34)
	wav.write('data', 36)
	wav.writeUInt32LE(samples, 40)
	// Unsigned 8-bit PCM: 128 is silence.
	wav.fill(128, 44)
	return wav
})()

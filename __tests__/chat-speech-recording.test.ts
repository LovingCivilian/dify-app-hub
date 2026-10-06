import { describe, expect, it } from 'vitest'

import {
	recordingFile,
	speechAction,
	type SpeechPhase,
} from '@/components/chat/hooks/speech-recording'

// X Sender's SpeechConfig: the speech button calls onRecordingChange(!recording); the hook decides what that
// means in each phase of the capture.
describe('speechAction', () => {
	const phases: SpeechPhase[] = ['idle', 'requesting', 'recording', 'transcribing']

	it('starts only from idle and stops only a running recording', () => {
		expect(phases.map(phase => speechAction(phase, true))).toEqual([
			'start',
			undefined,
			undefined,
			undefined,
		])
		expect(phases.map(phase => speechAction(phase, false))).toEqual([
			undefined,
			undefined,
			'stop',
			undefined,
		])
	})
})

// MDN, MediaRecorder dataavailable/stop: the chunks are joined into one Blob of the recorder's mimeType.
describe('recordingFile', () => {
	it("joins the chunks into one file of the recorder's type, named after it", async () => {
		const file = recordingFile([new Blob(['ab']), new Blob(['cd'])], 'audio/webm;codecs=opus')
		expect(file).toBeInstanceOf(File)
		expect(file?.name).toBe('speech.webm')
		expect(file?.type).toBe('audio/webm;codecs=opus')
		expect(file?.size).toBe(4)
		expect(await file?.text()).toBe('abcd')
	})
	it('falls back to webm when the recorder names no type', () => {
		expect(recordingFile([new Blob(['x'])], '')).toMatchObject({
			name: 'speech.webm',
			type: 'audio/webm',
		})
		expect(recordingFile([new Blob(['x'])], 'audio/mp4')?.name).toBe('speech.mp4')
	})
	it('gives nothing to send for an empty recording', () => {
		expect(recordingFile([], 'audio/webm')).toBeUndefined()
		expect(recordingFile([new Blob([])], 'audio/webm')).toBeUndefined()
	})
})

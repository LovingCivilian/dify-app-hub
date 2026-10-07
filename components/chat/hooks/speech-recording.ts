/**
 * The capture behind the Sender's speech button (spec §4.7): asking for the microphone, recording with
 * MediaRecorder, then transcribing through POST /audio2text. X's SpeechConfig reports only the recording
 * state the button asks for (`onRecordingChange(!recording)`); the phase decides what that means.
 */
export type SpeechPhase = 'idle' | 'requesting' | 'recording' | 'transcribing'

/**
 * What a press of the speech button does in a phase: start from idle, stop a running recording, and
 * nothing while the microphone is being asked for or the audio is being transcribed.
 */
export const speechAction = (
	phase: SpeechPhase,
	wantRecording: boolean,
): 'start' | 'stop' | undefined => {
	if (wantRecording) return phase === 'idle' ? 'start' : undefined
	return phase === 'recording' ? 'stop' : undefined
}

/** MediaRecorder picks its own format when given none; Chromium and Firefox record WebM. */
const FALLBACK_TYPE = 'audio/webm'

/**
 * The recorded audio as the file POST /audio-to-text takes (MDN, MediaRecorder `dataavailable` and `stop`:
 * the chunks joined into one Blob of the recorder's `mimeType`); undefined when nothing was recorded. The
 * app's route forwards it to Dify under its real type and name (app/api/dify/[appId]/audio-to-text).
 */
export const recordingFile = (chunks: Blob[], mimeType: string): File | undefined => {
	const type = mimeType || FALLBACK_TYPE
	const blob = new Blob(chunks, { type })
	if (blob.size === 0) return undefined
	const subtype = type.split(';')[0].split('/')[1] || 'webm'
	return new File([blob], `speech.${subtype}`, { type })
}

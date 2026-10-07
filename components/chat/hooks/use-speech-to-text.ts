'use client'

import type { SenderProps } from '@ant-design/x'
import { App } from 'antd'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../app-context'
import { failureText } from './dify-errors'
import { recordingFile, speechAction, type SpeechPhase } from './speech-recording'

const stopTracks = (stream: MediaStream) => {
	for (const track of stream.getTracks()) track.stop()
}

/**
 * Speech to text for the Sender (spec §4.7): X's documented `SpeechConfig` (`allowSpeech={{ recording,
 * onRecordingChange }}`; a set `recording` turns X's built-in browser recognition off) around a
 * MediaRecorder capture (MDN: getUserMedia, MediaRecorder `dataavailable`/`stop`) and POST /audio-to-text. The
 * transcript goes to `onText`. The microphone is released when a recording stops and when the view
 * unmounts; a transcript that arrives after that is dropped. `transcribing` is true while the audio is
 * with Dify. Off (`allowSpeech: false`) unless the app enables `parameters.speech_to_text`.
 */
export const useSpeechToText = ({
	enabled,
	onText,
}: {
	enabled: boolean
	onText: (text: string) => void
}): { allowSpeech: SenderProps['allowSpeech']; transcribing: boolean } => {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { difyApi } = useAppContext()
	const [phase, setPhaseState] = useState<SpeechPhase>('idle')
	// The phase as the next press sees it, before React renders it.
	const phaseRef = useRef<SpeechPhase>('idle')
	const capture = useRef<{ stream: MediaStream; recorder: MediaRecorder } | null>(null)
	const mounted = useRef(false)
	// Read when a press or an answer arrives (React: refs are written in effects, read in event handlers).
	const latest = useRef({ onText, difyApi, t, message })
	useLayoutEffect(() => {
		latest.current = { onText, difyApi, t, message }
	})

	const setPhase = useCallback((next: SpeechPhase) => {
		phaseRef.current = next
		if (mounted.current) setPhaseState(next)
	}, [])

	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			phaseRef.current = 'idle'
			const current = capture.current
			capture.current = null
			if (!current) return
			current.recorder.onstop = null
			if (current.recorder.state !== 'inactive') current.recorder.stop()
			stopTracks(current.stream)
		}
	}, [])

	const transcribe = useCallback(
		async (file: File) => {
			const { difyApi: api, t: translate, message: toast, onText: insert } = latest.current
			try {
				const { text } = await api.audioToText(file)
				if (mounted.current && text) insert(text)
			} catch (error) {
				if (mounted.current) {
					const reason = failureText(error, translate, translate('common.request_failed_retry'))
					toast.error(translate('sender.speech_to_text_error', { error: reason }))
				}
			} finally {
				setPhase('idle')
			}
		},
		[setPhase],
	)

	const start = useCallback(async () => {
		setPhase('requesting')
		let stream: MediaStream
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true })
		} catch {
			// Refused, no microphone, or no access outside a secure context (MDN: getUserMedia exceptions).
			setPhase('idle')
			if (mounted.current)
				latest.current.message.error(latest.current.t('sender.microphone_unavailable'))
			return
		}
		if (!mounted.current) {
			stopTracks(stream)
			return
		}
		const chunks: Blob[] = []
		try {
			const recorder = new MediaRecorder(stream)
			recorder.ondataavailable = event => {
				if (event.data.size > 0) chunks.push(event.data)
			}
			recorder.onstop = () => {
				stopTracks(stream)
				capture.current = null
				const file = recordingFile(chunks, recorder.mimeType)
				if (file) void transcribe(file)
				else setPhase('idle')
			}
			recorder.start()
			capture.current = { stream, recorder }
			setPhase('recording')
		} catch {
			// No MediaRecorder, or none for this stream (MDN: MediaRecorder() and start() exceptions).
			stopTracks(stream)
			setPhase('idle')
			latest.current.message.error(latest.current.t('sender.microphone_unavailable'))
		}
	}, [setPhase, transcribe])

	const onRecordingChange = useCallback(
		(recording: boolean) => {
			const action = speechAction(phaseRef.current, recording)
			if (action === 'start') void start()
			else if (action === 'stop') {
				const current = capture.current
				if (!current) return setPhase('idle')
				// The recorder's `stop` event hands the audio over (MDN, MediaRecorder.stop()).
				setPhase('transcribing')
				current.recorder.stop()
			}
		},
		[setPhase, start],
	)

	const allowSpeech = useMemo<SenderProps['allowSpeech']>(
		() => (enabled ? { recording: phase === 'recording', onRecordingChange } : false),
		[enabled, onRecordingChange, phase],
	)
	return { allowSpeech, transcribing: phase === 'transcribing' }
}

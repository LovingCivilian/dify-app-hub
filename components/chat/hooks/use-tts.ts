'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { DifyApi } from '@/lib/dify-client'

import type { DifyRequestError } from '../provider/dify-fetch'
import { audioAnswerError, toDifyError } from './dify-errors'

/** X's Actions.Audio statuses (x-components API: `status`). */
export type TtsStatus = 'default' | 'loading' | 'running' | 'error'

interface Clip {
	audio: HTMLAudioElement
	url: string
}

/** The clip playing on the page: starting another one pauses it, and its hook hears the `pause` event. */
let playing: HTMLAudioElement | null = null

/**
 * Text-to-speech for one answer (spec §4.7): POST /text2audio, the audio as a Blob behind an object URL,
 * played by an `HTMLAudioElement` (MDN: `URL.createObjectURL`, `HTMLMediaElement.play()`). The status runs
 * `loading` → `running` → `default`, `error` on a failure (reported through `onError` with Dify's text or
 * ''). A click while loading or playing stops it; the object URL is revoked whenever a clip stops, ends,
 * fails or its bubble unmounts (a conversation switch remounts the list).
 */
export const useTts = (difyApi: DifyApi, onError?: (error: DifyRequestError) => void) => {
	const [status, setStatus] = useState<TtsStatus>('default')
	const clip = useRef<Clip | null>(null)
	/** True from a start until the clip stops, ends or fails. */
	const busy = useRef(false)
	/** Bumped by every start, stop and unmount: the answer to an older start is dropped. */
	const generation = useRef(0)

	const release = useCallback(() => {
		const current = clip.current
		clip.current = null
		busy.current = false
		if (!current) return
		current.audio.pause()
		URL.revokeObjectURL(current.url)
		if (playing === current.audio) playing = null
	}, [])

	useEffect(
		() => () => {
			generation.current += 1
			release()
		},
		[release],
	)

	const toggle = useCallback(
		async (text: string) => {
			const id = ++generation.current
			if (busy.current) {
				release()
				setStatus('default')
				return
			}
			busy.current = true
			setStatus('loading')
			let audio: HTMLAudioElement | undefined
			try {
				// DifyApi.text2Audio resolves the proxy's Response whatever its status.
				const response: Response = await difyApi.text2Audio({ text })
				const failed = await audioAnswerError(response)
				if (failed) throw failed
				const blob = await response.blob()
				if (id !== generation.current) return
				const url = URL.createObjectURL(blob)
				const element = new Audio(url)
				audio = element
				clip.current = { audio: element, url }
				// `pause` also fires when another clip starts or the clip ends (HTML: ended playback pauses).
				const finish = () => {
					if (clip.current?.audio !== element) return
					release()
					setStatus('default')
				}
				element.addEventListener('ended', finish)
				element.addEventListener('pause', finish)
				if (playing && playing !== element) playing.pause()
				playing = element
				await element.play()
				// Stopped, or already over, while play() was pending.
				if (id !== generation.current || clip.current?.audio !== element) return
				setStatus('running')
			} catch (error) {
				// A stop, an unmount or another clip ended this one first: nothing failed.
				if (id !== generation.current || (audio && clip.current?.audio !== audio)) return
				release()
				setStatus('error')
				onError?.(toDifyError(error))
			}
		},
		[difyApi, onError, release],
	)

	return { status, toggle }
}

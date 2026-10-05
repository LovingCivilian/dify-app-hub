import type { MessageInfo } from '@ant-design/x-sdk'

import type { IFile, IFileType } from '@/lib/api'

import type { DifyChatMessage } from '../provider/message'

/** What an assistant bubble's footer offers (spec §5.2). */
export interface FooterActions {
	regenerate: boolean
	copy: boolean
	annotate: boolean
	feedback: boolean
	tts: boolean
	time: boolean
}

/** What the footer depends on beyond the message: the app's switches and the answer's place in the list. */
export interface FooterContext {
	/** `extConfig.annotation.enabled` */
	annotation: boolean
	/** `parameters.text_to_speech.enabled` */
	tts: boolean
	/** A user turn precedes the answer (see `unansweredKeys`). */
	hasQuestion: boolean
}

/**
 * The footer of an assistant bubble (spec §5.2, §4.7, §10): none while the reply is a placeholder or still
 * streams. Feedback needs Dify's message id and is never offered on an answer that failed (PRs #7/#8);
 * copy, annotation and text-to-speech need text, and the last two the app's switch. Regenerate asks the
 * question again, so it needs a user turn before the answer, and it stays on a failed answer.
 */
export const footerActions = (
	message: DifyChatMessage,
	status: string | undefined,
	context: FooterContext,
): FooterActions | undefined => {
	if (message.role !== 'assistant' || status === 'loading' || status === 'updating') return
	const hasText = Boolean(message.content)
	return {
		regenerate: context.hasQuestion,
		copy: hasText,
		annotate: context.annotation && hasText,
		feedback: Boolean(message.ids.messageId) && !message.error,
		tts: context.tts && hasText,
		time: message.createdAt !== undefined,
	}
}

/** A user message's files as the request carries them again: by upload id, else by URL. */
const resendFiles = (message: DifyChatMessage): IFile[] =>
	(message.files ?? []).flatMap((file): IFile[] => {
		const type = file.type as IFileType
		if (file.uploadFileId) {
			return [{ type, transfer_method: 'local_file', upload_file_id: file.uploadFileId }]
		}
		return file.url ? [{ type, transfer_method: 'remote_url', url: file.url }] : []
	})

/**
 * The answers no user turn precedes: those before the first user message (Dify pages whole turns and a
 * send adds the question first, so in practice there are none). Keys as strings, comparable with
 * `String(info.key)`.
 */
export const unansweredKeys = (messages: MessageInfo<DifyChatMessage>[]): string[] => {
	const first = messages.findIndex(m => m.message.role === 'user')
	return (first < 0 ? messages : messages.slice(0, first))
		.filter(m => m.message.role === 'assistant')
		.map(m => String(m.id))
}

/** The user turn the answer `key` replies to: the closest user message before it. */
export const questionOf = (
	messages: MessageInfo<DifyChatMessage>[],
	key: string | number,
): DifyChatMessage | undefined => {
	const index = messages.findIndex(m => m.id === key)
	if (index < 0) return
	return messages.slice(0, index).findLast(m => m.message.role === 'user')?.message
}

/**
 * Regenerate (spec §4.7): the text and files of the user turn the answer `key` replies to, sent as a new
 * turn, since Dify's /chat-messages has no parent id (the current inputs are the caller's).
 */
export const regenerateRequest = (
	messages: MessageInfo<DifyChatMessage>[],
	key: string | number,
): { query: string; files: IFile[] } | undefined => {
	const question = questionOf(messages, key)
	return question && { query: question.content, files: resendFiles(question) }
}

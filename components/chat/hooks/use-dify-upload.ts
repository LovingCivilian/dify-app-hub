'use client'

import { App, Upload, type UploadProps } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../app-context'
import {
	acceptFormatOf,
	extensionOf,
	fileTypeFor,
	withinLimit,
	type FileRules,
} from '../chat-view/file-types'
import { formatCount } from '../message/workflow-summary'
import { failureText, toDifyError } from './dify-errors'

export interface UploadRules extends FileRules {
	/** The most files the list may hold; none for a single file, which antd's `maxCount: 1` replaces. */
	limit?: number
}

/** One message for every file of a batch that went past the limit (antd message `key`). */
const TOO_MANY_KEY = 'dify-upload-too-many-files'

/**
 * antd Upload props that upload through the app's Dify proxy (POST /files/upload) under the app's file rules
 * (spec §4.7), shared by the Sender's attachments and the file inputs:
 * - `beforeUpload` refuses a file of another type, or one past the limit, with a message; `Upload.LIST_IGNORE`
 *   keeps it out of the list (antd Upload, beforeUpload);
 * - `customRequest` uploads it and reports the answer to the list: Dify's file as the item's `response`, or
 *   the failure with Dify's text (the item shows it) — the browser client rejects with Dify's text;
 * - `accept` narrows the browser's file picker; `filter: 'native'` leaves dropped and pasted files to
 *   `beforeUpload`, which explains a refusal (antd Upload, AcceptObject).
 * `count` is the number of files the list holds now.
 */
export const useDifyUpload = ({ types, extensions, limit }: UploadRules, count: number) => {
	const { t, i18n } = useTranslation()
	const { message } = App.useApp()
	const { difyApi } = useAppContext()

	const accept = useMemo(() => {
		const format = acceptFormatOf({ types, extensions })
		return format ? { format, filter: 'native' as const } : undefined
	}, [types, extensions])

	const beforeUpload: NonNullable<UploadProps['beforeUpload']> = (file, batch) => {
		const rules = { types, extensions }
		if (!fileTypeFor(file.name, rules)) {
			message.error(t('common.unsupported_file_type', { ext: extensionOf(file.name) }))
			return Upload.LIST_IGNORE
		}
		// A batch is counted in order, the files of other types left out.
		const typed = batch.filter(item => fileTypeFor(item.name, rules))
		if (!withinLimit(typed, count, limit).accepted.includes(file)) {
			message.error({
				key: TOO_MANY_KEY,
				content: t('sender.too_many_files', {
					limit: formatCount(limit ?? 0, i18n.resolvedLanguage),
				}),
			})
			return Upload.LIST_IGNORE
		}
		return true
	}

	const customRequest: NonNullable<UploadProps['customRequest']> = ({
		file,
		onSuccess,
		onError,
	}) => {
		const fail = (error: unknown) => {
			const failure = toDifyError(error)
			// The list shows a string `response` as the failed item's text.
			onError?.(failure, failureText(failure, t, t('common.request_failed_retry')))
		}
		difyApi.uploadFile(file as File).then(answer => onSuccess?.(answer), fail)
	}

	return { accept, beforeUpload, customRequest }
}

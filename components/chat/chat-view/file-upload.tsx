'use client'

import { UploadOutlined } from '@ant-design/icons'
import { Alert, Button, Upload, type UploadFile, type UploadProps } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { FileType } from '@/lib/dify/types'

import { useDifyUpload } from '../hooks/use-dify-upload'
import { completeFileUrl } from '../utils-index'
import { allowsLocalUpload, fileTypeFor, type FileRules } from './file-types'

export interface IUploadFileItem extends UploadFile {
	type?: string
	transfer_method?: 'local_file' | 'remote_url'
	upload_file_id?: string
	related_id?: string
	remote_url?: string
	filename?: string
}

interface IFileUploadCommonProps {
	/** Dify's file categories (none: any file). */
	allowed_file_types: FileType[]
	/** The extensions a `custom` file may have ("with the leading `.`"). */
	allowed_file_extensions?: string[]
	/** The upload methods the input takes; this control uploads local files only. */
	allowed_file_upload_methods?: Array<'local_file' | 'remote_url'>
	disabled?: boolean
	/** The most files a list input takes (Dify's `max_length` / `number_limits`). */
	maxCount?: number
	/** The input must be filled: without local uploads it then blocks the app (the hint says so). */
	required?: boolean
}

interface IFileUploadSingleProps extends IFileUploadCommonProps {
	value?: IUploadFileItem
	onChange?: (file?: IUploadFileItem) => void
	mode: 'single'
}

interface IFileUploadMultipleProps extends IFileUploadCommonProps {
	value?: IUploadFileItem[]
	onChange?: (files: IUploadFileItem[]) => void
	mode?: 'multiple'
}

type IFileUploadProps = IFileUploadSingleProps | IFileUploadMultipleProps

const NO_EXTENSIONS: string[] = []

/**
 * A file input's control (antd Form value: one item, or a list): antd Upload with the upload through the
 * Dify proxy and the input's restrictions (useDifyUpload): its types and custom extensions, its count
 * (`maxCount`; a single file is replaced), and local uploads only when the input takes them (otherwise a
 * hint replaces the control). An uploaded item carries Dify's type, `local_file` and the `upload_file_id`
 * (spec §4.7); stored files keep theirs.
 */
export default function FileUpload(props: IFileUploadProps) {
	const {
		mode = 'multiple',
		maxCount,
		disabled,
		allowed_file_types,
		allowed_file_extensions = NO_EXTENSIONS,
		allowed_file_upload_methods,
		required,
		value,
	} = props
	const { t } = useTranslation()
	const single = mode === 'single'
	const items = useMemo(
		() =>
			single ? (value ? [value as IUploadFileItem] : []) : ((value as IUploadFileItem[]) ?? []),
		[single, value],
	)
	const rules: FileRules = useMemo(
		() => ({ types: allowed_file_types ?? [], extensions: allowed_file_extensions }),
		[allowed_file_types, allowed_file_extensions],
	)
	const { accept, beforeUpload, customRequest } = useDifyUpload(
		{ ...rules, limit: single ? undefined : maxCount },
		items.length,
	)
	const local = allowsLocalUpload(allowed_file_upload_methods)

	// Stored files link to Dify's file preview; the DTO carries no API base, so the links stay relative
	// until they go through the proxy (Task 15).
	const apiBase = ''
	const fileList = useMemo(
		() =>
			items.map(item => ({ ...item, url: completeFileUrl(item.url || '', apiBase) || undefined })),
		[items, apiBase],
	)

	const handleChange: NonNullable<UploadProps['onChange']> = ({ fileList: next }) => {
		const files = next.map((item): IUploadFileItem => {
			const id = (item.response as { id?: unknown } | undefined)?.id
			return item.status === 'done' && typeof id === 'string'
				? {
						...item,
						type: fileTypeFor(item.name, rules) ?? 'custom',
						transfer_method: 'local_file',
						upload_file_id: id,
					}
				: item
		})
		if (single) (props as IFileUploadSingleProps).onChange?.(files.at(-1))
		else (props as IFileUploadMultipleProps).onChange?.(files)
	}

	// An input that takes files by URL only: this control uploads local files, so it explains instead.
	if (!local) {
		return (
			<Alert
				type={required ? 'warning' : 'info'}
				showIcon
				title={t(required ? 'sender.remote_only_required' : 'sender.remote_only_unsupported')}
			/>
		)
	}

	return (
		<Upload
			maxCount={single ? 1 : maxCount}
			multiple={!single}
			disabled={disabled}
			fileList={fileList}
			accept={accept}
			beforeUpload={beforeUpload}
			customRequest={customRequest}
			onChange={handleChange}
		>
			<Button
				disabled={disabled}
				icon={<UploadOutlined />}
			>
				{t('form.upload_placeholder')}
			</Button>
		</Upload>
	)
}

'use client'

import { CloudUploadOutlined, LinkOutlined } from '@ant-design/icons'
import { Attachments, Sender, type AttachmentsProps } from '@ant-design/x'
import { App, Badge, Button, type GetProp, type GetRef } from 'antd'
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../app-context'
import { useDifyUpload } from '../hooks/use-dify-upload'
import { formatCount } from '../message/workflow-summary'
import type { DifyChatFile } from '../provider/message'
import type { SenderRef } from './chat-sender'
import { acceptedExtensions, fileTypeFor, withinLimit } from './file-types'

type Item = GetProp<AttachmentsProps, 'items'>[number]

const TOO_MANY_KEY = 'sender-too-many-files'

/**
 * Files for the next message (spec §4.7, §5.2), the X pattern "paste-image" (Sender docs): an `Attachments`
 * list in a `Sender.Header` (`forceRender`, so pasted files can be handed to it while it is closed),
 * uploads through the Dify proxy under the app's `parameters.file_upload` rules (useDifyUpload), the
 * prefix button that opens it with the count on a `Badge`, files pasted into the box, and drops anywhere
 * on the Sender. `files` are the uploaded ones as Dify's `local_file` objects; `ready` is false while one
 * uploads (`uploading`) or one failed; `reset` empties the list after a send.
 */
export const useSenderAttachments = ({
	enabled,
	senderRef,
}: {
	enabled: boolean
	senderRef: RefObject<SenderRef | null>
}) => {
	const { t, i18n } = useTranslation()
	const { message } = App.useApp()
	const { parameters } = useAppContext()
	const [open, setOpen] = useState(false)
	const [items, setItems] = useState<Item[]>([])
	// A sent list starts afresh as a new instance (React: "resetting state with a key"): emptied in place,
	// X's FileCard.List would animate its cards out inside the closing header, whose `display: none` never
	// lets the leave motion end, and keep them.
	const [listKey, setListKey] = useState(0)
	const attachmentsRef = useRef<GetRef<typeof Attachments>>(null)

	const upload = parameters.file_upload
	const rules = useMemo(
		() => ({
			types: upload?.allowed_file_types ?? [],
			extensions: upload?.allowed_file_extensions ?? [],
		}),
		[upload],
	)
	const limit = upload?.number_limits || undefined
	const { accept, beforeUpload, customRequest } = useDifyUpload({ ...rules, limit }, items.length)
	const extensions = useMemo(() => acceptedExtensions(rules), [rules])

	// X shows an uploading item's progress in its description; the proxy upload reports none, so the item
	// says that it uploads instead (Attachment `description`). Any other item carries no description of its
	// own, since X spreads the item over the text it computes: a failed one then shows its `response` text.
	// A file added while the panel is closed (dropped on the Sender) opens it.
	const onChange: NonNullable<AttachmentsProps['onChange']> = ({ fileList }) => {
		if (fileList.length > items.length) setOpen(true)
		setItems(
			(fileList as Item[]).map(({ description: _previous, ...item }) =>
				item.status === 'uploading' ? { ...item, description: t('sender.uploading') } : item,
			),
		)
	}

	// Pasted files go through the list's own upload (AttachmentsRef.upload), within the limit.
	const count = items.length
	const onPasteFile = useCallback(
		(files: FileList) => {
			const pasted = Array.from(files)
			const typed = pasted.filter(file => fileTypeFor(file.name, rules))
			const { accepted, refused } = withinLimit(typed, count, limit)
			if (refused) {
				message.error({
					key: TOO_MANY_KEY,
					content: t('sender.too_many_files', {
						limit: formatCount(limit ?? 0, i18n.resolvedLanguage),
					}),
				})
			}
			setOpen(true)
			// Files of other types go too: the list refuses them with its message.
			for (const file of [...accepted, ...pasted.filter(file => !typed.includes(file))]) {
				attachmentsRef.current?.upload(file)
			}
		},
		[count, i18n.resolvedLanguage, limit, message, rules, t],
	)

	const files = useMemo<DifyChatFile[]>(
		() =>
			items.flatMap(item => {
				const id = (item.response as { id?: unknown } | undefined)?.id
				const type = fileTypeFor(item.name, rules)
				return item.status === 'done' && typeof id === 'string' && type
					? [
							{
								type,
								transfer_method: 'local_file' as const,
								upload_file_id: id,
								filename: item.name,
							},
						]
					: []
			}),
		[items, rules],
	)
	const uploading = items.some(item => item.status === 'uploading')
	const failed = items.some(item => item.status === 'error')

	const reset = useCallback(() => {
		setItems([])
		setListKey(key => key + 1)
		setOpen(false)
	}, [])

	if (!enabled) {
		return {
			header: undefined,
			prefix: undefined,
			onPasteFile: undefined,
			files,
			ready: true,
			uploading: false,
			reset,
		}
	}

	const label = t('sender.attach')
	const header = (
		<Sender.Header
			title={t('sender.upload_file')}
			open={open}
			onOpenChange={setOpen}
			forceRender
			// X's own demo: the list's drop area fills the panel.
			styles={{ content: { padding: 0 } }}
		>
			<Attachments
				key={listKey}
				ref={attachmentsRef}
				items={items}
				maxCount={limit}
				multiple
				accept={accept}
				beforeUpload={beforeUpload}
				customRequest={customRequest}
				onChange={onChange}
				getDropContainer={() => senderRef.current?.nativeElement}
				placeholder={type =>
					type === 'drop'
						? { title: t('sender.drop_hint') }
						: {
								icon: <CloudUploadOutlined />,
								title: t('sender.upload_hint'),
								description: extensions.length
									? t('sender.supported_types', { types: extensions.join(', ') })
									: undefined,
							}
				}
			/>
		</Sender.Header>
	)
	const prefix = (
		// The count of attached files while the panel is closed (antd Badge hides a zero count).
		<Badge
			size="small"
			count={open || !count ? 0 : formatCount(count, i18n.resolvedLanguage)}
		>
			<Button
				type="text"
				icon={<LinkOutlined />}
				aria-label={label}
				title={label}
				aria-expanded={open}
				onClick={() => setOpen(current => !current)}
			/>
		</Badge>
	)
	return { header, prefix, onPasteFile, files, ready: !uploading && !failed, uploading, reset }
}

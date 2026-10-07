'use client'

import { FileCard, type FileCardProps } from '@ant-design/x'
import { App, Flex, Image, theme } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../app-context'
import type { MessageFile } from '../provider/message'
import { completeFileUrl } from '../utils-index'
import styles from './message-files.module.css'

const IMAGE_CLASS_NAMES = { image: styles.image }

/** The name a download is saved under: Content-Disposition's `filename*` (UTF-8), then `filename`. */
const filenameFromDisposition = (header: string | null, fallback: string) => {
	const match = header?.match(/filename\*=UTF-8''([^;\n]+)|filename="?([^";\n]+)"?/i)
	try {
		return match?.[1] ? decodeURIComponent(match[1]) : match?.[2] || fallback
	} catch {
		return fallback
	}
}

const saveBlob = (blob: Blob, filename: string) => {
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = filename
	document.body.append(a)
	a.click()
	a.remove()
	URL.revokeObjectURL(url)
}

/** FileCard's kinds: audio and video play in the card; anything else is a file to download. */
const cardType = (type: string): NonNullable<FileCardProps['type']> =>
	type === 'audio' || type === 'video' ? type : 'file'

/**
 * A message's files (spec §5.3): images in an antd Image.PreviewGroup, other files as X FileCards. An
 * assistant's file opens its URL; a user's file downloads through the preview proxy (spec §4.7: Dify's
 * file preview endpoint serves only files a user uploaded).
 */
export default function MessageFiles({ files }: { files?: MessageFile[] }) {
	const { t } = useTranslation()
	const { message: toast } = App.useApp()
	const { token } = theme.useToken()
	const { difyApi } = useAppContext()
	// Thumbnails three control heights square. antd sizes an Image through its width/height props: its own
	// rule for the <img> outranks a class on the `image` slot.
	const thumbnail = token.controlHeight * 3
	// The DTO carries no API base: stored file links stay relative until they go through the proxy (Task 15).
	const apiBase = ''

	const { images, others } = useMemo(() => {
		const withUrls = (files ?? []).map(file => ({
			...file,
			url: completeFileUrl(file.url, apiBase),
		}))
		return {
			images: withUrls.filter(file => file.type === 'image' && file.url),
			others: withUrls.filter(file => !(file.type === 'image' && file.url)),
		}
	}, [files, apiBase])

	if (!images.length && !others.length) return null

	const download = async (file: MessageFile) => {
		if (file.belongsTo === 'assistant' || !file.uploadFileId) {
			window.open(file.url, '_blank', 'noreferrer')
			return
		}
		try {
			const response = await difyApi.filePreview(file.uploadFileId, { asAttachment: true })
			saveBlob(
				await response.blob(),
				filenameFromDisposition(
					response.headers.get('content-disposition'),
					file.filename || file.id,
				),
			)
		} catch {
			toast.error(t('common.request_failed_retry'))
		}
	}

	return (
		<Flex
			vertical
			gap="small"
			role="group"
			aria-label={t('message.files_title')}
		>
			{images.length > 0 && (
				<Image.PreviewGroup>
					<div className={styles.images}>
						{images.map(image => (
							<Image
								key={image.id}
								src={image.url}
								alt={image.filename || t('message.image_alt')}
								width={thumbnail}
								height={thumbnail}
								classNames={IMAGE_CLASS_NAMES}
							/>
						))}
					</div>
				</Image.PreviewGroup>
			)}
			{others.map(file => {
				const type = cardType(file.type)
				// Audio and video play in the card; a file card is a button that downloads (FileCard renders a
				// plain div, so it gets the button role, focus and keys through its HTML attributes).
				const downloadProps =
					type === 'file'
						? {
								onClick: () => void download(file),
								role: 'button',
								tabIndex: 0,
								title: t('message.download_file'),
								onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
									if (event.key !== 'Enter' && event.key !== ' ') return
									event.preventDefault()
									void download(file)
								},
							}
						: {}
				return (
					<FileCard
						key={file.id}
						name={file.filename || file.id}
						byte={file.size}
						type={type}
						src={file.url || undefined}
						{...downloadProps}
					/>
				)
			})}
		</Flex>
	)
}

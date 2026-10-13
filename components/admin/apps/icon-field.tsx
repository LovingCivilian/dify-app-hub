'use client'

import { DeleteOutlined, UploadOutlined } from '@ant-design/icons'
import { App, Avatar, Button, Flex, Form, Upload } from 'antd'
import { useEffect, useId } from 'react'
import { useTranslation } from 'react-i18next'

import { providerIcon } from '@/components/provider-ui/registry'
import { APP_ICON_MAX_BYTES, IMAGE_MIME_TYPES } from '@/lib/settings/image-rules'

import type { IconDraft } from './app-form-values'

/**
 * E4 (owner's pick): the branding page's image field, an Upload with a Button and no list, with a square Avatar preview
 * at the gallery card's size and a separate Remove button, a default one as on the branding page (owner, 2026-10-12).
 * The picker's check is a convenience; the server decodes and decides (OWASP File Upload Cheat Sheet; Task 8's
 * pipeline). Without an image the preview is the provider's fallback icon, as the card will show it (E11).
 */
export default function IconField({
	provider,
	savedSrc,
	draft,
	onChange,
	error,
}: {
	provider: string
	/** The stored image's URL, or null when the app has none. */
	savedSrc: string | null
	draft: IconDraft
	onChange: (draft: IconDraft) => void
	error?: string
}) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	// react.dev `useId`: "generating unique IDs that can be passed to accessibility attributes".
	const labelId = useId()
	// MDN URL.revokeObjectURL: a replaced draft's object URL is let go when it changes or the field unmounts.
	useEffect(
		() => () => {
			if (draft.intent === 'replace') URL.revokeObjectURL(draft.url)
		},
		[draft],
	)
	const src = draft.intent === 'replace' ? draft.url : draft.intent === 'keep' ? savedSrc : null
	const Fallback = providerIcon(provider)
	const label = t('app_setting.icon')
	return (
		<Form.Item
			// The label names the group, not one control (the branding page's field; WCAG 2.2 SC 2.5.3).
			label={<span id={labelId}>{label}</span>}
			extra={t('app_setting.icon_help')}
			validateStatus={error ? 'error' : undefined}
			help={error}
		>
			<Flex
				role="group"
				aria-labelledby={labelId}
				wrap
				align="center"
				gap="small"
			>
				{src ? (
					<Avatar
						shape="square"
						size="large"
						src={src}
						alt={label}
					/>
				) : (
					<Avatar
						shape="square"
						size="large"
						icon={<Fallback />}
					/>
				)}
				<Upload
					accept={IMAGE_MIME_TYPES.join(',')}
					showUploadList={false}
					// antd demos "Upload manually" and "Upload png file only": keep the file in the browser (return false) or
					// drop it (Upload.LIST_IGNORE).
					beforeUpload={file => {
						if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
							message.error(t('app_setting.icon_not_allowed'))
							return Upload.LIST_IGNORE
						}
						if (file.size > APP_ICON_MAX_BYTES) {
							message.error(t('app_setting.icon_too_large'))
							return Upload.LIST_IGNORE
						}
						onChange({ intent: 'replace', file, url: URL.createObjectURL(file) })
						return false
					}}
				>
					<Button icon={<UploadOutlined />}>{t('app_setting.icon_choose')}</Button>
				</Upload>
				{src && (
					<Button
						icon={<DeleteOutlined />}
						onClick={() => onChange({ intent: 'remove' })}
					>
						{t('app_setting.icon_remove')}
					</Button>
				)}
			</Flex>
		</Form.Item>
	)
}

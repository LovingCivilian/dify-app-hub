'use client'

import { Sender, type SenderProps } from '@ant-design/x'
import type { GetRef } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export type SenderRef = GetRef<typeof Sender>

export interface ChatSenderProps {
	loading: boolean
	disabled?: boolean
	initialValue?: string
	senderRef: React.RefObject<SenderRef | null>
	/** Resolves false when the message was not taken (the text then stays in the box). */
	onSend: (text: string) => Promise<boolean> | boolean
	onStop: () => void
	header?: SenderProps['header']
	prefix?: SenderProps['prefix']
	allowSpeech?: SenderProps['allowSpeech']
	onPasteFile?: SenderProps['onPasteFile']
}

/** X Sender, controlled: the text is cleared only once the send was taken; cancel stops the reply. */
export default function ChatSender({
	loading,
	disabled,
	initialValue = '',
	senderRef,
	onSend,
	onStop,
	header,
	prefix,
	allowSpeech,
	onPasteFile,
}: ChatSenderProps) {
	const { t } = useTranslation()
	const [value, setValue] = useState(initialValue)
	return (
		<Sender
			ref={senderRef}
			value={value}
			onChange={setValue}
			placeholder={t('chat.send_placeholder')}
			loading={loading}
			disabled={disabled}
			header={header}
			prefix={prefix}
			allowSpeech={allowSpeech}
			onPasteFile={onPasteFile}
			autoSize={{ minRows: 1, maxRows: 8 }}
			onSubmit={async text => {
				if (!text.trim()) return
				if (await onSend(text)) setValue('')
			}}
			onCancel={onStop}
		/>
	)
}

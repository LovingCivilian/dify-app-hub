'use client'

import { Sender, type SenderProps } from '@ant-design/x'
import { Flex, type GetRef } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export type SenderRef = GetRef<typeof Sender>

export interface ChatSenderProps {
	loading: boolean
	disabled?: boolean
	/** Replaces the usual placeholder (`chat.send_placeholder`), e.g. to say why the box is disabled. */
	placeholder?: string
	initialValue?: string
	senderRef: React.RefObject<SenderRef | null>
	/** Resolves false when the message was not taken (the text then stays in the box). */
	onSend: (text: string) => Promise<boolean> | boolean
	onStop: () => void
	header?: SenderProps['header']
	prefix?: SenderProps['prefix']
	allowSpeech?: SenderProps['allowSpeech']
	/** The recorded speech is being transcribed: the speech button waits meanwhile. */
	transcribing?: boolean
	onPasteFile?: SenderProps['onPasteFile']
}

/** X Sender, controlled: the text is cleared only once the send was taken; cancel stops the reply. */
export default function ChatSender({
	loading,
	disabled,
	placeholder,
	initialValue = '',
	senderRef,
	onSend,
	onStop,
	header,
	prefix,
	allowSpeech,
	transcribing = false,
	onPasteFile,
}: ChatSenderProps) {
	const { t } = useTranslation()
	const [value, setValue] = useState(initialValue)
	// X names its speech button by the icon alone ("audio"); the documented `suffix` render takes X's own
	// action buttons (`info.components`, ButtonProps) and gives it a name from the locale (ADR-0014), as a
	// toggle (`aria-pressed`) while it records. The send and stop buttons stay X's.
	const recording = typeof allowSpeech === 'object' && Boolean(allowSpeech.recording)
	const speechLabel = transcribing ? t('sender.recognizing') : t('sender.voice_input')
	const suffix: SenderProps['suffix'] = allowSpeech
		? (_actions, { components: { SpeechButton, SendButton, LoadingButton } }) => (
				<Flex
					gap="small"
					align="center"
				>
					<SpeechButton
						aria-label={speechLabel}
						title={speechLabel}
						aria-pressed={recording}
						loading={transcribing}
					/>
					{loading ? <LoadingButton /> : <SendButton />}
				</Flex>
			)
		: undefined
	return (
		<Sender
			ref={senderRef}
			value={value}
			onChange={setValue}
			placeholder={placeholder ?? t('chat.send_placeholder')}
			loading={loading}
			disabled={disabled}
			header={header}
			prefix={prefix}
			suffix={suffix}
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

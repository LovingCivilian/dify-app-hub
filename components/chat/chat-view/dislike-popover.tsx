'use client'

import { Button, Flex, Input, Popover } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface DislikePopoverProps {
	open: boolean
	/** The reason as typed, '' when left empty (Dify's feedback `content` is optional). */
	onSubmit: (reason: string) => void
	onCancel: () => void
	/** The dislike button: an element that takes the trigger's ref and events (antd Button does). */
	children: React.ReactElement
}

/**
 * Asks why an answer was disliked before the rating is sent (spec §8.2). antd Popover, controlled through
 * `open`; a click outside or Cancel closes it without sending. Its content is rebuilt on every opening
 * (`destroyOnHidden`), so the box takes the focus each time (`autoFocus`) and keyboard users land in it.
 */
export default function DislikePopover({
	open,
	onSubmit,
	onCancel,
	children,
}: DislikePopoverProps) {
	const { t } = useTranslation()
	const [reason, setReason] = useState('')
	const close = (send: boolean) => {
		if (send) onSubmit(reason.trim())
		else onCancel()
		setReason('')
	}
	return (
		<Popover
			open={open}
			trigger="click"
			destroyOnHidden
			// Opening is the caller's (the dislike click); a click outside closes it like Cancel.
			onOpenChange={visible => {
				if (!visible && open) close(false)
			}}
			content={
				<Flex
					vertical
					gap="small"
				>
					<Input.TextArea
						autoFocus
						autoSize={{ minRows: 3, maxRows: 6 }}
						value={reason}
						onChange={e => setReason(e.target.value)}
						placeholder={t('message.dislike_reason')}
						aria-label={t('message.dislike_reason')}
					/>
					<Flex
						gap="small"
						justify="flex-end"
					>
						<Button
							size="small"
							onClick={() => close(false)}
						>
							{t('common.cancel')}
						</Button>
						<Button
							size="small"
							type="primary"
							onClick={() => close(true)}
						>
							{t('message.send_feedback')}
						</Button>
					</Flex>
				</Flex>
			}
		>
			{children}
		</Popover>
	)
}

import { IRating } from '@/lib/api'
import { Input, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import LucideIcon from '@/components/shared/lucide-icon'

/**
 * 点踩确认
 */
export default function DislikeConfirm(props: {
	isDisLiked: boolean
	runFeedback: (type: IRating, reason?: string) => void
}) {
	const { t } = useTranslation()
	const { isDisLiked, runFeedback } = props
	const [dislikeReason, setDislikeReason] = useState('')
	const [modalOpen, setModalOpen] = useState(false)
	const [confirmLoading, setConfirmLoading] = useState(false)

	return (
		<>
			<LucideIcon
				name="thumbs-down"
				className={
					isDisLiked ? 'text-[var(--theme-primary-color)]' : 'text-[var(--theme-text-color)]'
				}
				onClick={() => {
					if (isDisLiked) {
						return
					}
					setModalOpen(true)
				}}
			/>

			<Modal
				width={360}
				title={t('message.feedback_thanks')}
				open={modalOpen}
				centered
				onOk={async () => {
					setConfirmLoading(true)
					await runFeedback(isDisLiked ? null : 'dislike', dislikeReason)
					setConfirmLoading(false)
					setDislikeReason('')
					setModalOpen(false)
				}}
				onCancel={() => {
					setDislikeReason('')
					setModalOpen(false)
				}}
				confirmLoading={confirmLoading}
			>
				<div>
					<div className="text-desc mb-2">{t('message.feedback_prompt')}</div>
					<Input.TextArea
						autoSize={{
							minRows: 3,
							maxRows: 5,
						}}
						value={dislikeReason}
						onChange={e => {
							setDislikeReason(e.target.value)
						}}
						placeholder={t('form.input_placeholder')}
						className="box-border h-12 w-full rounded-md border border-solid border-[var(--theme-border-color)] px-3 py-2"
					/>
				</div>
			</Modal>
		</>
	)
}

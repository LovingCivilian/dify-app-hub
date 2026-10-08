'use client'

import { Form, Input, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AnnotationItem } from '@/lib/dify/types'

export interface AnnotationFormValues {
	question: string
	answer: string
}

/**
 * Add or edit an annotation (spec §5.5) in antd's form-in-modal shape: the Form wraps the modal's content through
 * `modalRender`, so the OK button (`htmlType: 'submit'`) submits it. The Form is not given an instance: antd creates
 * one automatically, and with `destroyOnHidden` the Form unmounts on close, so every opening starts from
 * `initialValues`.
 */
export default function AnnotationFormModal({
	open,
	initial,
	onSubmit,
	onCancel,
}: {
	open: boolean
	initial?: Pick<AnnotationItem, 'question' | 'answer'>
	onSubmit: (values: AnnotationFormValues) => Promise<void>
	onCancel: () => void
}) {
	const { t } = useTranslation()
	const [saving, setSaving] = useState(false)

	const submit = async (values: AnnotationFormValues) => {
		setSaving(true)
		try {
			await onSubmit(values)
		} finally {
			setSaving(false)
		}
	}

	return (
		<Modal
			open={open}
			title={initial ? t('annotation.edit') : t('annotation.add')}
			okText={t('common.ok')}
			cancelText={t('common.cancel')}
			okButtonProps={{ htmlType: 'submit' }}
			confirmLoading={saving}
			onCancel={onCancel}
			destroyOnHidden
			modalRender={dom => (
				<Form
					layout="vertical"
					initialValues={initial}
					onFinish={submit}
				>
					{dom}
				</Form>
			)}
		>
			<Form.Item
				name="question"
				label={t('annotation.question')}
				rules={[{ required: true, message: t('annotation.question_required') }]}
			>
				<Input.TextArea rows={3} />
			</Form.Item>
			<Form.Item
				name="answer"
				label={t('annotation.answer')}
				rules={[{ required: true, message: t('annotation.answer_required') }]}
			>
				<Input.TextArea autoSize={{ minRows: 3, maxRows: 15 }} />
			</Form.Item>
		</Modal>
	)
}

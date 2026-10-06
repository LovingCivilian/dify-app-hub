'use client'

import { App, Button, Drawer, Form, Input, Space } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../app-context'
import { annotationError, toDifyError } from '../hooks/dify-errors'

export interface AnnotationDrawerProps {
	open: boolean
	/** The user turn the answer replies to, and the answer: the form's starting values. */
	question: string
	answer: string
	onClose: () => void
}

interface AnnotationValues {
	question: string
	answer: string
}

/**
 * Saves a question and answer pair as a Dify annotation (POST /annotations, spec §4.7), when the app
 * enables annotation. antd Drawer + Form (the Drawer "form in drawer" demo): the Form is destroyed with
 * the closed Drawer (`destroyOnHidden`) and keeps no values (`preserve={false}`), so each opening starts
 * from the message's question and answer.
 */
export default function AnnotationDrawer({
	open,
	question,
	answer,
	onClose,
}: AnnotationDrawerProps) {
	const { t } = useTranslation()
	const { difyApi } = useAppContext()
	const { message: toast } = App.useApp()
	const [form] = Form.useForm<AnnotationValues>()
	const [saving, setSaving] = useState(false)

	const save = async () => {
		let values: AnnotationValues
		try {
			values = await form.validateFields()
		} catch {
			// The form shows what is missing.
			return
		}
		setSaving(true)
		try {
			// DifyApi resolves the proxy's answer whatever the status.
			const saved: unknown = await difyApi.createAnnotation(values)
			const failed = annotationError(saved)
			if (failed) throw failed
			toast.success(t('annotation.create_success'))
			onClose()
		} catch (error) {
			toast.error(toDifyError(error).message || t('common.request_failed_retry'))
		} finally {
			setSaving(false)
		}
	}

	return (
		<Drawer
			open={open}
			onClose={onClose}
			title={t('annotation.create_title')}
			destroyOnHidden
			extra={
				<Space>
					<Button onClick={onClose}>{t('common.cancel')}</Button>
					<Button
						type="primary"
						loading={saving}
						onClick={() => void save()}
					>
						{t('common.confirm')}
					</Button>
				</Space>
			}
		>
			<Form
				form={form}
				// Field ids become `annotation_question` and `annotation_answer`, unique on the page.
				name="annotation"
				layout="vertical"
				preserve={false}
				initialValues={{ question, answer }}
			>
				<Form.Item
					name="question"
					label={t('annotation.question')}
					rules={[{ required: true, whitespace: true, message: t('annotation.question_required') }]}
				>
					<Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
				</Form.Item>
				<Form.Item
					name="answer"
					label={t('annotation.answer')}
					rules={[{ required: true, whitespace: true, message: t('annotation.answer_required') }]}
				>
					<Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} />
				</Form.Item>
			</Form>
		</Drawer>
	)
}

'use client'

import { Alert, Button, Flex, Form, Input, Select, Statistic, Typography, theme } from 'antd'
import type { FormRule } from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import FileUpload from '@/components/chat/chatbox/form-controls/file-upload'

import type { HumanInputField, HumanInputState } from '../provider/message'
import styles from './human-input-form.module.css'
import { humanInputInitialValues, humanInputPhase, humanInputSubmission } from './human-input-phase'
import MessageMarkdown from './message-markdown'

export interface HumanInputFormProps {
	humanInput: HumanInputState
	/** This form's submission, or the continuation it started, is on its way. */
	submitting: boolean
	/**
	 * Submits the values (OpenAPI, POST /form/human_input `inputs`) with the chosen action. It reports a
	 * failure itself and settles either way; the form is submittable again afterwards.
	 */
	onSubmit: (inputs: Record<string, unknown>, actionId: string) => Promise<void>
}

/** Every input must be answered, as in Dify's own form (a blank paragraph or an empty file list counts as empty). */
const fieldRules = (field: HumanInputField, message: string): FormRule[] => {
	if (field.type === 'paragraph') return [{ required: true, whitespace: true, message }]
	if (field.type === 'file-list') return [{ required: true, type: 'array', message }]
	return [{ required: true, message }]
}

/** Dify's Human Input node form inside the bubble flow, on antd primitives (spec §4.6, §5.3). */
export default function HumanInputForm({ humanInput, submitting, onSubmit }: HumanInputFormProps) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const [form] = Form.useForm<Record<string, unknown>>()
	// antd Form reads `initialValues` once; a new form gets a new instance (the caller keys it per form).
	const [initialValues] = useState(() => humanInputInitialValues(humanInput))
	const [expiredNow, setExpiredNow] = useState(false)
	const [action, setAction] = useState<string>()
	// Set at once on a click: `submitting` only arrives with a re-render, after the validation's microtasks,
	// so a double click could otherwise post the form twice.
	const inFlight = useRef(false)
	// The clock is read while rendering so that a form already past its expiry renders expired from its
	// first paint, never as a countdown (Review Focus 5); the phase only moves from pending to expired.
	const phase =
		humanInput.state === 'pending' && expiredNow
			? 'expired'
			: humanInputPhase(humanInput, Math.floor(Date.now() / 1000))
	// A form delivered by email or to the console has no token (OpenAPI: `form_token` is null then).
	const noToken = !humanInput.formToken
	const disabled = phase !== 'pending' || noToken || submitting

	const submit = async (actionId: string) => {
		if (inFlight.current) return
		inFlight.current = true
		try {
			let values: Record<string, unknown>
			try {
				values = await form.validateFields()
			} catch {
				// antd Form shows the message under each field that failed.
				return
			}
			setAction(actionId)
			await onSubmit(humanInputSubmission(humanInput.inputs, values), actionId)
		} finally {
			inFlight.current = false
		}
	}

	// The box sits on a wrapper: antd's Flex resets its own padding (`.ant-flex { padding: 0 }`).
	if (phase === 'filled') {
		return (
			<div className={`${styles.root} ${styles.filled}`}>
				<Flex
					vertical
					gap="small"
				>
					<Typography.Text strong>{t('hitl.title')}</Typography.Text>
					<MessageMarkdown content={humanInput.renderedContent || humanInput.formContent} />
					<Typography.Text type="secondary">
						{t('hitl.submitted', { action: humanInput.actionText ?? '' })}
					</Typography.Text>
				</Flex>
			</div>
		)
	}

	return (
		<div className={styles.root}>
			<Flex
				vertical
				gap="small"
			>
				<Flex
					justify="space-between"
					align="center"
					wrap
					gap="small"
				>
					<Typography.Text strong>{t('hitl.title')}</Typography.Text>
					{phase === 'pending' && humanInput.expiresAt > 0 && (
						// antd 6: Statistic.Countdown is deprecated in favour of Statistic.Timer (antd doc "Statistic").
						<Statistic.Timer
							type="countdown"
							value={humanInput.expiresAt * 1000}
							format="HH:mm:ss"
							prefix={t('hitl.time_left')}
							// The semantic `styles.content` replaces the deprecated `valueStyle`; a class would lose to antd's rule.
							styles={{ content: { fontSize: token.fontSize } }}
							onFinish={() => setExpiredNow(true)}
						/>
					)}
				</Flex>
				<MessageMarkdown content={humanInput.formContent} />
				<Form
					form={form}
					layout="vertical"
					size="small"
					initialValues={initialValues}
					disabled={disabled}
				>
					{humanInput.inputs.map(field => (
						<Form.Item
							key={field.output_variable_name}
							name={field.output_variable_name}
							label={field.output_variable_name}
							rules={fieldRules(field, t('hitl.field_required'))}
						>
							{field.type === 'select' ? (
								<Select
									options={(field.option_source?.value ?? []).map(value => ({
										value,
										label: value,
									}))}
								/>
							) : field.type === 'file' ? (
								<FileUpload
									mode="single"
									disabled={disabled}
									allowed_file_types={field.allowed_file_types ?? []}
								/>
							) : field.type === 'file-list' ? (
								<FileUpload
									disabled={disabled}
									maxCount={field.number_limits}
									allowed_file_types={field.allowed_file_types ?? []}
								/>
							) : (
								<Input.TextArea rows={3} />
							)}
						</Form.Item>
					))}
				</Form>
				{phase === 'expired' && (
					<Alert
						type="warning"
						showIcon
						title={t('hitl.expired')}
						description={t('hitl.expired_hint')}
					/>
				)}
				{phase === 'pending' && noToken && (
					<Alert
						type="info"
						showIcon
						title={t('hitl.no_token')}
					/>
				)}
				<Flex
					gap="small"
					wrap
				>
					{humanInput.actions.map(item => (
						<Button
							key={item.id}
							type={item.button_style === 'primary' ? 'primary' : 'default'}
							loading={submitting && action === item.id}
							disabled={disabled}
							onClick={() => void submit(item.id)}
						>
							{item.title}
						</Button>
					))}
				</Flex>
			</Flex>
		</div>
	)
}

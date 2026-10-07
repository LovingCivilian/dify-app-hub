'use client'

import {
	Alert,
	Button,
	Flex,
	Form,
	Input,
	Select,
	Skeleton,
	Statistic,
	Typography,
	theme,
} from 'antd'
import type { FormRule } from 'antd'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { HumanInputForm as HumanInputFormDefinition } from '@/lib/dify/types'

import FileUpload from '../chat-view/file-upload'
import { DifyRequestError } from '../provider/dify-fetch'
import type { HumanInputField, HumanInputState } from '../provider/message'
import { applyFormDefinition } from './human-input-definition'
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
	/**
	 * Reads the form's definition (GET /form/human_input/{form_token}); given for a pending form with a token. Until
	 * it answers the form shows a skeleton; a 412 means the form was submitted or expired meanwhile; any other
	 * failure keeps the stream's fields (the documented fallback).
	 */
	loadForm?: () => Promise<HumanInputFormDefinition>
}

/** Every input must be answered, as in Dify's own form (a blank paragraph or an empty file list counts as empty). */
const fieldRules = (field: HumanInputField, message: string): FormRule[] => {
	if (field.type === 'paragraph') return [{ required: true, whitespace: true, message }]
	if (field.type === 'file-list') return [{ required: true, type: 'array', message }]
	return [{ required: true, message }]
}

/** Dify's Human Input node form inside the bubble flow, on antd primitives (spec §4.6, §5.3). */
export default function HumanInputForm({
	humanInput: given,
	submitting,
	onSubmit,
	loadForm,
}: HumanInputFormProps) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const [form] = Form.useForm<Record<string, unknown>>()
	const [expiredNow, setExpiredNow] = useState(false)
	const [action, setAction] = useState<string>()
	// Set at once on a click: `submitting` only arrives with a re-render, after the validation's microtasks,
	// so a double click could otherwise post the form twice.
	const inFlight = useRef(false)
	// A pending form with a token reads its definition when it mounts: when it arrives, and when it is reopened
	// from the history (the caller keys this component per form, so the token never changes).
	const pendingToken = loadForm && given.state === 'pending' ? given.formToken : ''
	const [definition, setDefinition] = useState<
		| { status: 'loading' }
		| { status: 'ready'; form?: HumanInputFormDefinition }
		| { status: 'submitted' }
	>(() => (pendingToken ? { status: 'loading' } : { status: 'ready' }))
	// The caller passes a new function on every render; the read follows the token only (React: an Effect
	// Event wraps an event handler from the props, so the Effect does not re-run when it changes).
	const readForm = useEffectEvent(() => loadForm?.())
	useEffect(() => {
		if (!pendingToken) return
		let ignore = false
		readForm()?.then(
			loaded => {
				if (!ignore) setDefinition({ status: 'ready', form: loaded })
			},
			(error: unknown) => {
				if (ignore) return
				if (error instanceof DifyRequestError && error.code === 'human_input_form_submitted') {
					setDefinition({ status: 'submitted' })
					return
				}
				if (error instanceof DifyRequestError && error.code === 'human_input_form_expired')
					setExpiredNow(true)
				setDefinition({ status: 'ready' })
			},
		)
		return () => {
			ignore = true
		}
	}, [pendingToken])
	// The definition holds while the form waits; a filled or timed-out form is the stream's (or the history's).
	const humanInput =
		given.state === 'pending' && definition.status === 'ready' && definition.form
			? applyFormDefinition(given, definition.form)
			: given
	// The clock is read while rendering so that a form already past its expiry renders expired from its
	// first paint, never as a countdown (Review Focus 5); the phase only moves from pending to expired.
	const phase =
		humanInput.state === 'pending' && expiredNow
			? 'expired'
			: humanInputPhase(humanInput, Math.floor(Date.now() / 1000))
	// A form delivered by email or to the console has no token (OpenAPI: `form_token` is null then).
	const noToken = !humanInput.formToken
	const disabled = phase !== 'pending' || noToken || submitting
	// antd Form reads `initialValues` when it mounts, which is after the definition has loaded (the skeleton
	// stands in until then); a new form gets a new instance (the caller keys it per form).
	const initialValues = humanInputInitialValues(humanInput)

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

	if (pendingToken && definition.status === 'loading') {
		return (
			<Skeleton
				active
				paragraph={{ rows: 3 }}
			/>
		)
	}
	if (pendingToken && definition.status === 'submitted') {
		return (
			<Alert
				type="info"
				showIcon
				title={t('hitl.title')}
				description={t('hitl.already_submitted')}
			/>
		)
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
									allowed_file_extensions={field.allowed_file_extensions}
									allowed_file_upload_methods={field.allowed_file_upload_methods}
									// Every human input field is required (fieldRules).
									required
								/>
							) : field.type === 'file-list' ? (
								<FileUpload
									disabled={disabled}
									maxCount={field.number_limits}
									allowed_file_types={field.allowed_file_types ?? []}
									allowed_file_extensions={field.allowed_file_extensions}
									allowed_file_upload_methods={field.allowed_file_upload_methods}
									// Every human input field is required (fieldRules).
									required
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

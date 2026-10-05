'use client'

import { Form, Input, InputNumber, Select, type FormInstance } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import FileUpload from './file-upload'

import styles from './inputs-form.module.css'
import { inputFields, type InputDefinition } from './inputs-values'

export type InputsFormInstance = FormInstance<Record<string, unknown>>

export interface InputsFormProps {
	form: InputsFormInstance
	definition: InputDefinition[]
	disabled?: boolean
	onValuesChange?: (values: Record<string, unknown>) => void
}

/** The app's input parameters as an antd Form: one control per Dify control type, required ones validated. */
export default function InputsForm({
	form,
	definition,
	disabled,
	onValuesChange,
}: InputsFormProps) {
	const { t } = useTranslation()
	return (
		<Form
			form={form}
			name="inputs"
			layout="vertical"
			onValuesChange={(_changed, all) => onValuesChange?.(all)}
		>
			{inputFields(definition).map(field => (
				<Form.Item
					key={field.variable}
					name={field.variable}
					label={field.label}
					hidden={field.hide}
					rules={
						field.required
							? [{ required: true, message: t('form.field_required', { label: field.label }) }]
							: []
					}
				>
					{field.type === 'select' ? (
						<Select
							disabled={disabled}
							placeholder={t('form.select_placeholder')}
							options={(field.options ?? []).map(option => ({ value: option, label: option }))}
						/>
					) : field.type === 'paragraph' ? (
						<Input.TextArea
							disabled={disabled}
							placeholder={t('form.input_placeholder')}
							maxLength={field.max_length}
						/>
					) : field.type === 'number' ? (
						<InputNumber
							className={styles.number}
							disabled={disabled}
							placeholder={t('form.input_placeholder')}
						/>
					) : field.type === 'file' ? (
						<FileUpload
							mode="single"
							disabled={disabled}
							allowed_file_types={field.allowed_file_types ?? []}
							allowed_file_extensions={field.allowed_file_extensions}
							allowed_file_upload_methods={field.allowed_file_upload_methods}
							required={field.required}
						/>
					) : field.type === 'file-list' ? (
						<FileUpload
							disabled={disabled}
							maxCount={field.max_length}
							allowed_file_types={field.allowed_file_types ?? []}
							allowed_file_extensions={field.allowed_file_extensions}
							allowed_file_upload_methods={field.allowed_file_upload_methods}
							required={field.required}
						/>
					) : (
						<Input
							disabled={disabled}
							placeholder={t('form.input_placeholder')}
							maxLength={field.max_length}
						/>
					)}
				</Form.Item>
			))}
		</Form>
	)
}

/**
 * Whether the form's required inputs are filled, kept current as it changes. This is antd's documented
 * "validate only" pattern (Form demo "Validate Only": `useWatch([], form)` + `validateFields({ validateOnly })`),
 * which validates without showing messages. `enabled` is false while no mounted Form is connected to
 * `form` (antd warns when a form instance is used unconnected).
 */
export const useInputsValid = (form: InputsFormInstance, enabled: boolean) => {
	const values = Form.useWatch([], form)
	const [valid, setValid] = useState(true)
	useEffect(() => {
		if (!enabled) return
		let current = true
		form.validateFields({ validateOnly: true }).then(
			() => current && setValid(true),
			() => current && setValid(false),
		)
		return () => {
			current = false
		}
	}, [form, enabled, values])
	return !enabled || valid
}

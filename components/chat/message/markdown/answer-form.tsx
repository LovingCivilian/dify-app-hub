'use client'

import { Button, DatePicker, Form, Input, Select } from 'antd'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'

import type { DomNode, MarkdownBlockProps } from './dom-node'
import { textOf } from './dom-node'
import { formFieldName } from './dompurify-config'
import { useMarkdownSend } from './send-context'

const FIELD_TAGS = new Set(['input', 'textarea', 'select'])
const DATE_FORMATS: Record<string, string> = { date: 'YYYY-MM-DD', datetime: 'YYYY-MM-DD HH:mm:ss' }

const elements = (node: DomNode) =>
	(node.children ?? []).filter(child => child.type === 'tag' && child.name)

const selectOptions = (node: DomNode) => {
	try {
		return (JSON.parse(node.attribs?.['data-options'] ?? '[]') as string[]).map(value => ({
			value,
			label: value,
		}))
	} catch {
		return []
	}
}

/**
 * <form data-format="text|json"> inside an answer: labelled fields and a submit that posts back a message. The
 * submit is disabled while there is no send (a reply streams); a disabled default button also stops Enter's
 * implicit submission (HTML, "Implicit submission").
 */
export default function AnswerForm({ domNode }: MarkdownBlockProps) {
	const { t } = useTranslation()
	const send = useMarkdownSend()
	const [form] = Form.useForm<Record<string, string>>()
	const format = domNode.attribs?.['data-format'] === 'json' ? 'json' : 'text'
	const children = elements(domNode)

	const submit = (values: Record<string, string>) => {
		if (format === 'json') {
			send?.(JSON.stringify({ ...values, isFormSubmit: true }))
			return
		}
		send?.(
			Object.entries(values)
				.map(([key, value]) => `${key}: ${value ?? ''}`)
				.join('\n'),
		)
	}

	return (
		<Form
			form={form}
			layout="vertical"
			size="small"
			onFinish={submit}
			autoComplete="off"
		>
			{children.map((child, index) => {
				if (child.name === 'button') {
					return (
						<Form.Item key={`button-${index}`}>
							<Button
								type="primary"
								size="small"
								htmlType="submit"
								disabled={!send}
							>
								{textOf(child) || t('common.confirm')}
							</Button>
						</Form.Item>
					)
				}
				if (!FIELD_TAGS.has(child.name!)) return null
				const name = formFieldName(child.attribs?.name) ?? `field_${index}`
				const label = children.find(other => other.name === 'label' && other.attribs?.for === name)
				const type = child.attribs?.type ?? 'text'
				const dateFormat = DATE_FORMATS[type]
				const control =
					child.name === 'textarea' ? (
						<Input.TextArea rows={3} />
					) : dateFormat ? (
						<DatePicker showTime={type === 'datetime'} />
					) : type === 'select' ? (
						<Select options={selectOptions(child)} />
					) : (
						<Input type={type} />
					)
				return (
					<Form.Item
						key={name}
						name={name}
						label={label ? textOf(label) : undefined}
						hidden={type === 'hidden'}
						initialValue={child.attribs?.value}
						// antd Form demo "getValueProps + normalize": the form keeps a string, the picker gets dayjs.
						getValueProps={
							dateFormat ? value => ({ value: value ? dayjs(value) : undefined }) : undefined
						}
						normalize={
							dateFormat
								? (value?: dayjs.Dayjs | null) => (value ? value.format(dateFormat) : '')
								: undefined
						}
					>
						{control}
					</Form.Item>
				)
			})}
		</Form>
	)
}

'use client'

import { Collapse, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../app-context'
import styles from './chat-view.module.css'
import InputsForm, { type InputsFormInstance } from './inputs-form'
import { inputFields } from './inputs-values'

export interface InputsCollapseProps {
	form: InputsFormInstance
	conversationKey: string
	disabled: boolean
	onValuesChange: (values: Record<string, unknown>) => void
}

const KEY = 'inputs'

/** Conversation parameters above the messages; opens on every conversation switch (spec §5.2). */
export default function InputsCollapse({
	form,
	conversationKey,
	disabled,
	onValuesChange,
}: InputsCollapseProps) {
	const { t } = useTranslation()
	const { parameters, app } = useAppContext()
	// React: "Adjusting some state when a prop changes" — reset the panel while rendering, not in an effect.
	const [panel, setPanel] = useState({ key: conversationKey, active: [KEY] })
	if (panel.key !== conversationKey) setPanel({ key: conversationKey, active: [KEY] })

	const definition = parameters.user_input_form
	const fields = inputFields(definition)
	if (!fields.length) return null
	const formElement = (
		<InputsForm
			form={form}
			definition={definition}
			disabled={disabled}
			onValuesChange={onValuesChange}
		/>
	)
	// Only hidden inputs: nothing to show, but the form stays mounted so their values are sent and validated.
	if (fields.every(field => field.hide)) return formElement
	return (
		<div className={styles.inputs}>
			<Collapse
				size="small"
				activeKey={panel.active}
				onChange={keys => setPanel({ key: conversationKey, active: keys })}
				items={[
					{
						key: KEY,
						label: (
							<>
								<Typography.Text strong>{t('chat.input_params_setting')}</Typography.Text>
								{!app.settings.enableUpdateAfterConversationStarts && (
									<Typography.Text type="secondary">
										{' '}
										{t('chat.input_disabled_between_chats')}
									</Typography.Text>
								)}
							</>
						),
						children: formElement,
					},
				]}
			/>
		</div>
	)
}

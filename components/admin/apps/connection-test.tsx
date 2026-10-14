'use client'

import { Alert, Button, Flex, Form, type FormItemProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { testAppConnectionAction } from '@/app/(admin)/app-management/actions'
import { useActionTransition } from '@/hooks/use-action-transition'
import type { ProviderId } from '@/lib/providers/ids'

import type { AppFormValues } from './app-form-values'
import { connectionOutcome, type ConnectionOutcome } from './connection-outcome'

/**
 * E7 (spec §4.2): a default Button, "Test connection", with `loading` while the test runs, and an Alert under it with
 * `showIcon`, a title and a description: success, warning or error (Alert API: `title` replaces the deprecated
 * `message`). The provider section renders it last in its Connection rows and keys it by the connection fields' values,
 * so a change there clears the result (react.dev "Resetting state with a key"). The connection fields are checked first
 * (Form `validateFields(nameList)`); the action reads a blank secret from the stored app and saves nothing.
 */
export default function ConnectionTest({
	appId,
	provider,
	fields,
	chosenType,
}: {
	appId?: string
	provider: ProviderId
	/** The connection fields' names (antd's own type for a Form.Item `name`). */
	fields: NonNullable<FormItemProps['name']>[]
	chosenType?: string
}) {
	const { t } = useTranslation()
	const form = Form.useFormInstance<AppFormValues>()
	const { pending, run } = useActionTransition()
	const [outcome, setOutcome] = useState<ConnectionOutcome | null>(null)

	const test = () =>
		void run(async () => {
			try {
				await form.validateFields(fields)
			} catch {
				// The fields show their own errors (Form `validateFields` rejects with the error list).
				return
			}
			const values = form.getFieldsValue(true)
			const result = await testAppConnectionAction({
				appId,
				provider,
				settings: values.settings,
				secrets: values.secrets,
			})
			setOutcome(connectionOutcome(t, provider, result, chosenType))
		})

	return (
		<Flex
			vertical
			gap="small"
			align="flex-start"
		>
			<Button
				loading={pending}
				onClick={test}
			>
				{t('app_setting.test_connection')}
			</Button>
			{outcome && (
				<Alert
					type={outcome.type}
					showIcon
					title={outcome.title}
					description={outcome.description}
				/>
			)}
		</Flex>
	)
}

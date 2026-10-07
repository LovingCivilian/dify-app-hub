'use client'

import { Button, Result } from 'antd'
import { useTranslation } from 'react-i18next'

import UserShell from '@/components/shell/user-shell'

/** The chat page of an app that does not exist or is disabled (charter §4.1): a Result with the way back to the list. */
export default function AppUnavailable({ reason }: { reason: 'missing' | 'disabled' }) {
	const { t } = useTranslation()
	return (
		<UserShell>
			<Result
				status={reason === 'missing' ? '404' : 'warning'}
				title={t(reason === 'missing' ? 'app.no_config_default_text' : 'app.disabled')}
				extra={
					<Button
						type="primary"
						href="/apps"
					>
						{t('app.back_to_apps')}
					</Button>
				}
			/>
		</UserShell>
	)
}

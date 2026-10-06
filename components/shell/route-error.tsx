'use client'

import { Button, Result } from 'antd'
import { useTranslation } from 'react-i18next'

/**
 * The error screen of a route segment (spec §3.3), rendered by the error.tsx files. Translated text only: in
 * production a server error's message is replaced by a digest. `retry()` re-fetches and re-renders the segment
 * (Next 16.3, error.md).
 */
export default function RouteError({ retry }: { retry: () => void }) {
	const { t } = useTranslation()
	return (
		<Result
			status="error"
			title={t('common.load_failed')}
			extra={
				<Button
					type="primary"
					onClick={() => retry()}
				>
					{t('common.retry')}
				</Button>
			}
		/>
	)
}

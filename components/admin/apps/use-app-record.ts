'use client'

import { App } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getApp } from '@/app/(admin)/app-management/actions'

import { acceptRecord, dropRecord, type RecordState } from './app-record'

/**
 * The full app (with its real key) for a drawer that needs it — edit and annotations (spec §5.1). The list
 * carries no requestConfig; this is the only place the key reaches the browser.
 */
export function useAppRecord() {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const [state, setState] = useState<RecordState>(null)

	const open = async (appId: string) => {
		setState({ appId })
		try {
			const record = await getApp(appId)
			if (!record) throw new Error(`App ${appId} not found`)
			setState(current => acceptRecord(current, appId, record))
		} catch (error) {
			console.error('Failed to load the app', error)
			message.error(t('admin_apps.not_found'))
			setState(current => dropRecord(current, appId))
		}
	}

	return { state, open, close: () => setState(null) }
}

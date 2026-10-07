'use client'

import { Button, Flex, Result, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import UserShell from '@/components/shell/user-shell'
import type { ChatAppDto } from '@/lib/data/apps'
import { createDifyApi } from '@/lib/dify/browser'

import { DEFAULT_SITE_SETTINGS } from './app-answers'
import { AppContext, type AppContextValue } from './app-context'
import { toDifyError } from './hooks/dify-errors'
import ChatView from './chat-view/chat-view'
import styles from './chat-view/chat-view.module.css'
import { isChatLikeApp, isWorkflowLikeApp } from './utils-index'
import WorkflowView from './workflow-view/workflow-view'

type State =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; value: AppContextValue }

/** Loads the app's parameters and site settings, provides AppContext and picks the view by mode. The app itself arrives from the server page. */
export default function ChatWorkspace({ app }: { app: ChatAppDto }) {
	const { t } = useTranslation()
	const [state, setState] = useState<State>({ status: 'loading' })

	useEffect(() => {
		let cancelled = false
		const difyApi = createDifyApi(app.id)
		;(async () => {
			try {
				const [parameters, site] = await Promise.all([
					difyApi.getParameters(),
					difyApi.getSite().catch(() => DEFAULT_SITE_SETTINGS),
				])
				if (!cancelled) setState({ status: 'ready', value: { app, parameters, site, difyApi } })
			} catch (error) {
				// Dify's text, or '' for anything else (the Result then shows the generic key).
				if (!cancelled) setState({ status: 'error', message: toDifyError(error).message })
			}
		})()
		return () => {
			cancelled = true
		}
	}, [app])

	if (state.status === 'loading') {
		return (
			<UserShell>
				<Flex
					className={styles.fill}
					align="center"
					justify="center"
				>
					<Spin
						size="large"
						description={t('app.loading')}
					/>
				</Flex>
			</UserShell>
		)
	}
	if (state.status === 'error') {
		return (
			<UserShell>
				<Result
					status="500"
					title={t('app.load_failed')}
					subTitle={state.message || t('common.request_failed_retry')}
					extra={
						<Button
							type="primary"
							onClick={() => window.location.reload()}
						>
							{t('app.reload_page')}
						</Button>
					}
				/>
			</UserShell>
		)
	}
	const mode = state.value.app.mode
	return (
		<AppContext.Provider value={state.value}>
			{isChatLikeApp(mode) ? (
				<ChatView />
			) : isWorkflowLikeApp(mode) ? (
				<WorkflowView />
			) : (
				<UserShell>
					<Result
						status="warning"
						title={t('common.unsupported_app_type')}
					/>
				</UserShell>
			)}
		</AppContext.Provider>
	)
}

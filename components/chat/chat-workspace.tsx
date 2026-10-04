'use client'

import { Button, Empty, Flex, Result, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ChatLayoutWrapper from '@/components/chat/chat-layout-wrapper'
import UserShell from '@/components/shell/user-shell'
import { useAuth } from '@/hooks/use-auth'
import { AppModeEnums } from '@/lib/core'
import { createDifyApiInstance, type DifyApi } from '@/lib/dify-client'
import appService from '@/services/app'

import { toAppParameters, toSiteSetting } from './app-answers'
import { AppContext, type AppContextValue } from './app-context'
import { toDifyError } from './hooks/dify-errors'
import ChatView from './chat-view/chat-view'
import styles from './chat-view/chat-view.module.css'
import { isChatLikeApp } from './utils-index'

type State =
	| { status: 'loading' }
	| { status: 'missing' }
	| { status: 'error'; message: string }
	| { status: 'ready'; value: AppContextValue }

/** Loads the app, its parameters and site settings, provides AppContext and picks the view by mode (spec §4.9). */
export default function ChatWorkspace({ appId }: { appId: string }) {
	const { t } = useTranslation()
	const { userId } = useAuth()
	const [state, setState] = useState<State>({ status: 'loading' })

	useEffect(() => {
		if (!userId) return
		let cancelled = false
		;(async () => {
			try {
				const app = await appService.getAppByID(appId)
				if (!app) {
					if (!cancelled) setState({ status: 'missing' })
					return
				}
				const difyApi = createDifyApiInstance({
					appId: app.id,
					user: userId,
					...app.requestConfig,
				}) as DifyApi
				// DifyApi resolves Dify's error bodies as values: the answers are checked for their shape, so a
				// failed /parameters reaches the Result below and a failed /site falls back to the defaults.
				const [parameters, site] = await Promise.all([
					difyApi.getAppParameters().then(toAppParameters),
					difyApi.getAppSiteSetting().then(toSiteSetting, () => toSiteSetting(undefined)),
				])
				if (!cancelled) {
					setState({ status: 'ready', value: { app, parameters, site, difyApi, userId } })
				}
			} catch (error) {
				// Dify's text, or '' for anything else (the Result then shows the generic key).
				if (!cancelled) setState({ status: 'error', message: toDifyError(error).message })
			}
		})()
		return () => {
			cancelled = true
		}
	}, [appId, userId])

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
	if (state.status === 'missing') {
		return (
			<UserShell>
				<Flex
					className={styles.fill}
					align="center"
					justify="center"
				>
					<Empty description={t('app.no_config_default_text')} />
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
	const mode = state.value.app.info.mode ?? AppModeEnums.CHATBOT
	// Workflow and completion apps keep the old page until their views land (Task 17).
	if (!isChatLikeApp(mode)) return <ChatLayoutWrapper />
	return (
		<AppContext.Provider value={state.value}>
			<ChatView />
		</AppContext.Provider>
	)
}

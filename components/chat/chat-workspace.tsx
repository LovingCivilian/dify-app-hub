'use client'

import { Button, Flex, Result, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import UserShell from '@/components/shell/user-shell'
import { createDifyApi } from '@/lib/providers/dify/browser'

import { DEFAULT_SITE_SETTINGS } from './app-answers'
import { AppContext, type AppContextValue, type DifyChatApp } from './app-context'
import { ChatAppInfoContext, type ChatAppInfo } from './chat-view/app-info-context'
import ChatView from './chat-view/chat-view'
import styles from './chat-view/chat-view.module.css'
import { difyChatContexts } from './dify-chat-contexts'
import { failureText } from './hooks/dify-errors'
import { MarkdownLinkContext, type MarkdownLinkRewrite } from './message/markdown/link-context'
import { isChatLikeApp, isWorkflowLikeApp } from './utils-index'
import WorkflowView from './workflow-view/workflow-view'

type State =
	| { status: 'loading' }
	| { status: 'error'; error: unknown }
	| {
			status: 'ready'
			value: AppContextValue
			/** The shared pieces' contexts (Part 2 spec §5.1), built once with the app (difyChatContexts). */
			appInfo: ChatAppInfo
			rewriteLink: MarkdownLinkRewrite
	  }

/** Loads the app's parameters and site settings, provides AppContext and picks the view by mode. The app itself arrives from the server page. */
export default function ChatWorkspace({ app }: { app: DifyChatApp }) {
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
				if (!cancelled) {
					const value = { app, parameters, site, difyApi }
					setState({ status: 'ready', value, ...difyChatContexts(value) })
				}
			} catch (error) {
				// Kept as it is: the Result words it in the current language (failureText).
				if (!cancelled) setState({ status: 'error', error })
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
					subTitle={failureText(state.error, t, t('common.request_failed_retry'))}
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
	const mode = state.value.app.appType
	return (
		<AppContext.Provider value={state.value}>
			{/* React 19 renders a context as its own provider (react.dev createContext; `.Provider` is the legacy form). */}
			<ChatAppInfoContext value={state.appInfo}>
				<MarkdownLinkContext value={state.rewriteLink}>
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
				</MarkdownLinkContext>
			</ChatAppInfoContext>
		</AppContext.Provider>
	)
}

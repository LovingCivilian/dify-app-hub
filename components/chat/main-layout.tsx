import { useDifyChatStore } from '@/lib/core'
import { AppModeEnums, IDifyAppItem } from '@/lib/core'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { isChatLikeApp, isWorkflowLikeApp } from '@/components/chat/utils-index'

import ChatLayout from './chat-layout'
import CommonLayout from './common-layout'
import WorkflowLayout from './workflow-layout'

interface IMainLayoutProps {
	/**
	 * 扩展的 JSX 元素, 如抽屉/弹窗等
	 */
	extComponents?: React.ReactNode
	/**
	 * 自定义中心标题
	 */
	renderCenterTitle?: (appInfo?: IDifyAppItem['info']) => React.ReactNode
	/**
	 * 自定义右侧头部内容
	 */
	renderRightHeader?: () => React.ReactNode
	/**
	 * 是否正在加载应用配置
	 */
	initLoading: boolean
}

/**
 * 应用详情主界面布局
 */
const MainLayout = (props: IMainLayoutProps) => {
	const { t } = useTranslation()
	const currentApp = useDifyChatStore(s => s.currentApp)

	// FIXME: 去掉这里的默认值
	const appMode = currentApp?.config?.info?.mode || AppModeEnums.CHATBOT

	return isChatLikeApp(appMode) ? (
		<ChatLayout {...props} />
	) : (
		<CommonLayout
			initLoading={props.initLoading}
			renderCenterTitle={props.renderCenterTitle}
			extComponents={props.extComponents}
		>
			{isWorkflowLikeApp(appMode) ? (
				<WorkflowLayout />
			) : (
				<div>{t('common.unsupported_app_type')}</div>
			)}
		</CommonLayout>
	)
}

export default MainLayout

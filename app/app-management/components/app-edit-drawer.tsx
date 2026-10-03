'use client'

import { DifyApi } from '@/lib/api'
import { AppModeEnums } from '@/lib/core'
import { generateUuidV4 } from '@/lib/helpers'
import { useRequest } from 'ahooks'
import { Button, Drawer, DrawerProps, Form, message, Space } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { IDifyAppItem } from '@/types'

import { AppDetailDrawerModeEnum } from '../enums'
import SettingForm from './app-setting-form'

interface IAppEditDrawerProps extends DrawerProps {
	detailDrawerMode: AppDetailDrawerModeEnum
	confirmLoading?: boolean
	appItem?: IDifyAppItem
	onClose?: () => void
	confirmCallback?: () => void
	addApi: (appInfo: IDifyAppItem) => Promise<unknown>
	updateApi: (appInfo: IDifyAppItem) => Promise<unknown>
}

/**
 * 应用配置编辑抽屉
 */
export const AppEditDrawer = (props: IAppEditDrawerProps) => {
	const { t } = useTranslation()
	const { detailDrawerMode, appItem, open, onClose, confirmCallback, addApi, updateApi } = props
	const [settingForm] = Form.useForm()
	const [confirmLoading, setConfirmBtnLoading] = useState(false)

	useEffect(() => {
		if (appItem?.info.mode) {
			settingForm.setFieldsValue({
				'info.mode': appItem?.info.mode,
			})
		}
	}, [appItem?.info.mode])

	useEffect(() => {
		if (!open) return
		if (detailDrawerMode === AppDetailDrawerModeEnum.edit) {
			settingForm.setFieldsValue({
				apiBase: appItem?.requestConfig.apiBase,
				apiKey: appItem?.requestConfig.apiKey,
				'info.name': appItem?.info.name,
				'info.description': appItem?.info.description,
				'info.mode': appItem?.info.mode || AppModeEnums.CHATBOT,
				isEnabled: appItem?.isEnabled,
				enableAnswerForm: appItem?.answerForm?.enabled || false,
				'answerForm.feedbackText': appItem?.answerForm?.feedbackText || '',
				enableUpdateInputAfterStarts: appItem?.inputParams?.enableUpdateAfterCvstStarts || false,
				openingStatementDisplayMode:
					appItem?.extConfig?.conversation?.openingStatement?.displayMode || 'default',
				enableAnnotation: appItem?.extConfig?.annotation?.enabled || false,
			})
		} else if (detailDrawerMode === AppDetailDrawerModeEnum.create) {
			settingForm.resetFields()
			settingForm.setFieldsValue({
				'info.mode': AppModeEnums.CHATBOT,
			})
		}
	}, [open])

	const { runAsync: createApp } = useRequest(
		async (appInfo: IDifyAppItem) => {
			return addApi(appInfo)
		},
		{
			manual: true,
			onSuccess: () => {
				onClose?.()
				message.success(t('admin_apps.create_success'))
			},
		},
	)

	const { runAsync: updateApp } = useRequest(
		async (appInfo: IDifyAppItem) => {
			return updateApi(appInfo)
		},
		{
			manual: true,
			onSuccess: () => {
				onClose?.()
				message.success(t('admin_apps.edit_success'))
			},
		},
	)

	return (
		<Drawer
			size={700}
			title={
				detailDrawerMode === AppDetailDrawerModeEnum.create
					? t('admin_apps.create_title')
					: t('admin_apps.edit_title', { name: appItem?.info.name })
			}
			open={open}
			onClose={onClose}
			extra={
				<Space>
					<Button onClick={onClose}>{t('common.cancel')}</Button>
					<Button
						type="primary"
						loading={confirmLoading}
						onClick={async () => {
							await settingForm.validateFields()

							setConfirmBtnLoading(true)
							try {
								const values = settingForm.getFieldsValue()
								const updatingItem = appItem

								// 获取 Dify 应用信息
								const newDifyApiInstance = new DifyApi({
									user: '',
									apiBase: values.apiBase,
									apiKey: values.apiKey,
								})
								const difyAppInfo = await newDifyApiInstance.getAppInfo()
								const commonInfo: Omit<IDifyAppItem, 'id'> = {
									info: {
										...difyAppInfo,
										// 兼容处理，当 Dify API 返回的应用信息中没有 mode 时，使用表单中的 mode
										mode: difyAppInfo.mode || values['info.mode'],
									},
									isEnabled: values['isEnabled'],
									requestConfig: {
										apiBase: values.apiBase,
										apiKey: values.apiKey,
									},
									answerForm: {
										enabled: values['enableAnswerForm'],
										feedbackText: values['answerForm.feedbackText'],
									},
									inputParams: {
										enableUpdateAfterCvstStarts: values['enableUpdateInputAfterStarts'],
									},
									extConfig: {
										conversation: {
											openingStatement: {
												displayMode: values['openingStatementDisplayMode'],
											},
										},
										annotation: {
											enabled: values['enableAnnotation'],
										},
									},
								}
								if (detailDrawerMode === AppDetailDrawerModeEnum.edit) {
									await updateApp({
										id: updatingItem!.id,
										...commonInfo,
									})
								} else {
									await createApp({
										id: generateUuidV4(),
										...commonInfo,
									})
								}
								confirmCallback?.()
							} catch (error) {
								console.error('Failed to save app config', error)
								message.error(t('admin_apps.save_failed', { error }))
							} finally {
								setConfirmBtnLoading(false)
							}
						}}
					>
						{detailDrawerMode === AppDetailDrawerModeEnum.create
							? t('common.ok')
							: t('common.update')}
					</Button>
				</Space>
			}
		>
			<SettingForm
				formInstance={settingForm}
				mode={detailDrawerMode}
				appItem={appItem!}
			/>
		</Drawer>
	)
}

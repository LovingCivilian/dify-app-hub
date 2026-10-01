'use client'

import { DifyApi } from '@/lib/api'
import { AppModeEnums, IDifyAppItem } from '@/lib/core'
import { AppModeNames } from '@/lib/core'
import { useMount, useRequest } from 'ahooks'
import { Button, message, Popconfirm, Space, Spin, Table, Tag } from 'antd'
import Title from 'antd/es/typography/Title'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { addApp } from '@/repository/app'

import { deleteApp, getApp, listApp, updateApp } from './actions'
import { AnnotationManagerDrawer } from './components/annotation-manager-drawer'
import { AppEditDrawer } from './components/app-edit-drawer'
import { AppDetailDrawerModeEnum } from './enums'

export default function AppManagementPage() {
	const { t } = useTranslation()
	const [appEditDrawerOpen, setAppEditDrawerOpen] = useState(false)
	const [appEditDrawerMode, setAppEditDrawerMode] = useState<AppDetailDrawerModeEnum>()
	const [appEditDrawerAppItem, setAppEditDrawerAppItem] = useState<IDifyAppItem>()

	const [annotationDrawerOpen, setAnnotationDrawerOpen] = useState(false)
	const [annotationDrawerAppItem, setAnnotationDrawerAppItem] = useState<IDifyAppItem>()

	const {
		runAsync: getAppList,
		data: list,
		loading: listLoading,
	} = useRequest(
		() => {
			return listApp()
		},
		{
			manual: true,
		},
	)

	useMount(() => {
		getAppList()
	})

	if (listLoading && !list) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<Spin spinning />
			</div>
		)
	}

	return (
		<>
			<div className="h-full flex-1 overflow-auto px-6">
				<div className="mb-3 flex items-center justify-between">
					<div className="flex items-center">
						<Title level={3}>{t('admin_apps.title')}</Title>
					</div>
					<Button
						type="primary"
						onClick={() => {
							setAppEditDrawerMode(AppDetailDrawerModeEnum.create)
							setAppEditDrawerOpen(true)
							setAppEditDrawerAppItem(undefined)
						}}
					>
						{t('common.new')}
					</Button>
				</div>
				<Table
					rowKey="id"
					dataSource={list}
					loading={listLoading}
					scroll={{ x: 1200 }}
					columns={[
						{
							title: t('admin_apps.column_name'),
							dataIndex: 'info.name',
							key: 'info.name',
							width: 180,
							fixed: 'left',
							ellipsis: true,
							render: (_text, record) => {
								return record.info.name
							},
						},
						{
							title: t('admin_apps.column_type'),
							dataIndex: 'info.mode',
							key: 'info.mode',
							width: 200,
							render: (_mode: AppModeEnums, record) => {
								return record.info.mode
									? t(AppModeNames[(record.info.mode || AppModeEnums.CHATBOT) as AppModeEnums])
									: '--'
							},
						},
						{
							title: t('admin_apps.column_description'),
							dataIndex: 'info.description',
							key: 'info.description',
							width: 300,
							ellipsis: true,
							render: (_text, record) => {
								return record.info.description || t('app.no_description')
							},
						},
						{
							title: t('admin_apps.column_tags'),
							dataIndex: 'info.tags',
							key: 'info.tags',
							width: 200,
							render: (_text, record) => {
								return record.info.tags?.length ? (
									<Space>
										{record.info.tags.map((tag: string) => (
											<Tag key={`${record.id}__${tag}`}>{tag}</Tag>
										))}
									</Space>
								) : null
							},
						},
						{
							title: t('common.status'),
							dataIndex: 'isEnabled',
							key: 'isEnabled',
							width: 140,
							render: (_text, record) => {
								return record.isEnabled === 1 ? (
									<Tag color="success">{t('admin_apps.status_enabled')}</Tag>
								) : (
									<Tag color="default">{t('admin_apps.status_disabled')}</Tag>
								)
							},
						},
						{
							title: t('common.actions'),
							key: 'action',
							width: 280,
							fixed: 'right',
							render: (_, record) => (
								<Space size="middle">
									<Button
										className="!px-0"
										type="link"
										onClick={() => window.open(`/chat/${record.id}`, '_blank')}
									>
										{t('admin_apps.user_view')}
									</Button>
									<Button
										className="!px-0"
										type="link"
										onClick={() => {
											setAppEditDrawerMode(AppDetailDrawerModeEnum.edit)
											setAppEditDrawerOpen(true)
											setAppEditDrawerAppItem(record)
										}}
									>
										{t('common.edit')}
									</Button>
									<Button
										className="!px-0"
										type="link"
										onClick={async () => {
											const appItem = await getApp(record.id)
											if (!appItem) {
												message.error(t('admin_apps.not_found'))
												return
											}
											const { info: originalInfo, ...rest } = appItem!
											// 调用获取应用信息接口
											const difyApi = new DifyApi({
												...appItem.requestConfig,
												// TODO: 获取应用信息的 API 其实不用 user，后面处理掉
												user: '',
											})
											const appInfo = await difyApi.getAppInfo()
											try {
												await updateApp({
													...rest,
													info: {
														...originalInfo,
														...appInfo,
													},
												})
												message.success(t('admin_apps.sync_success'))
												getAppList()
											} catch (error) {
												message.error(t('admin_apps.sync_failed'))
												console.error(error)
											}
										}}
									>
										{t('admin_apps.sync_info')}
									</Button>
									<Button
										className="!px-0"
										type="link"
										onClick={() => {
											setAnnotationDrawerAppItem(record)
											setAnnotationDrawerOpen(true)
										}}
									>
										{t('admin_apps.annotations')}
									</Button>
									<Popconfirm
										title={t('admin_apps.delete_confirm_title')}
										description={t('admin_apps.delete_confirm_description')}
										onConfirm={async () => {
											await deleteApp(record.id)
											message.success(t('admin_apps.delete_success'))
											getAppList()
										}}
									>
										<Button
											className="!px-0"
											type="link"
											danger
										>
											{t('common.delete')}
										</Button>
									</Popconfirm>
								</Space>
							),
						},
					]}
				/>
			</div>

			<AppEditDrawer
				detailDrawerMode={appEditDrawerMode!}
				open={appEditDrawerOpen}
				onClose={() => setAppEditDrawerOpen(false)}
				appItem={appEditDrawerAppItem}
				confirmCallback={() => {
					setAppEditDrawerOpen(false)
					getAppList()
				}}
				addApi={addApp}
				updateApi={updateApp}
			/>

			<AnnotationManagerDrawer
				open={annotationDrawerOpen}
				onClose={() => setAnnotationDrawerOpen(false)}
				appItem={annotationDrawerAppItem}
			/>
		</>
	)
}

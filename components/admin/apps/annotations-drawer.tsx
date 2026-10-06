'use client'

import { PlusOutlined } from '@ant-design/icons'
import {
	App,
	Button,
	Drawer,
	Flex,
	Input,
	Popconfirm,
	Result,
	Skeleton,
	Space,
	Table,
	type TableProps,
	Typography,
	theme,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DifyApi, type IAnnotationItem } from '@/lib/api'
import type { IDifyAppItem } from '@/lib/core'
import { formatDateTime } from '@/libs/format-date'

import AnnotationFormModal, { type AnnotationFormValues } from './annotation-form-modal'
import { isAnnotationPage } from './app-record'

const DEFAULT_PAGE_SIZE = 10

type Query = { page: number; limit: number; keyword: string }
type Loaded =
	| { status: 'loading' }
	| { status: 'error' }
	| { status: 'ready'; items: IAnnotationItem[]; total: number }

/** An app's Dify annotations (spec §5.5): server paging, keyword search, add/edit in a modal, confirmed delete. */
export default function AnnotationsDrawer({
	open,
	record,
	onClose,
}: {
	open: boolean
	record?: IDifyAppItem
	onClose: () => void
}) {
	const { t, i18n } = useTranslation()
	const { token } = theme.useToken()
	const { message } = App.useApp()
	const [query, setQuery] = useState<Query>({ page: 1, limit: DEFAULT_PAGE_SIZE, keyword: '' })
	const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
	const [editing, setEditing] = useState<{ item?: IAnnotationItem } | null>(null)
	// The browser calls Dify with the app's key, as the old drawer did; the key arrives through getApp (spec §5.1).
	const difyApi = useMemo(
		() => (record ? new DifyApi({ ...record.requestConfig, user: '' }) : undefined),
		[record],
	)

	const load = useCallback(async () => {
		if (!difyApi) return
		setLoaded({ status: 'loading' })
		try {
			const page = await difyApi.getAnnotationList(query)
			if (!isAnnotationPage(page)) throw new Error('Dify answered without an annotation page')
			setLoaded({ status: 'ready', items: page.data, total: page.total })
		} catch (error) {
			console.error('Failed to load annotations', error)
			setLoaded({ status: 'error' })
		}
	}, [difyApi, query])

	useEffect(() => {
		if (open) void load()
	}, [open, load])

	const save = async (values: AnnotationFormValues) => {
		if (!difyApi) return
		try {
			if (editing?.item) {
				await difyApi.updateAnnotation(editing.item.id, values)
				message.success(t('common.update_success'))
			} else {
				await difyApi.createAnnotation(values)
				message.success(t('common.create_success'))
			}
			setEditing(null)
			await load()
		} catch (error) {
			console.error('Failed to save the annotation', error)
			message.error(t('common.operation_failed'))
		}
	}

	const remove = async (id: string) => {
		if (!difyApi) return
		try {
			await difyApi.deleteAnnotation(id)
			message.success(t('common.delete_success'))
			await load()
		} catch (error) {
			console.error('Failed to delete the annotation', error)
			message.error(t('common.delete_failed'))
		}
	}

	const text = (value: string) => (
		<Typography.Paragraph
			ellipsis={{ rows: 3, expandable: true }}
			style={{ marginBottom: 0 }}
		>
			{value}
		</Typography.Paragraph>
	)
	const columns: TableProps<IAnnotationItem>['columns'] = [
		{ title: t('annotation.question'), dataIndex: 'question', render: text },
		{ title: t('annotation.answer'), dataIndex: 'answer', render: text },
		{ title: t('annotation.hit_count'), dataIndex: 'hit_count' },
		{
			title: t('common.created_at'),
			dataIndex: 'created_at',
			render: (value: number) => formatDateTime(value * 1000, i18n.resolvedLanguage),
		},
		{
			title: t('common.actions'),
			key: 'actions',
			render: (_, item) => (
				<Space>
					<Button
						type="link"
						onClick={() => setEditing({ item })}
					>
						{t('common.edit')}
					</Button>
					<Popconfirm
						title={t('annotation.delete_confirm')}
						okText={t('common.delete')}
						okButtonProps={{ danger: true }}
						cancelText={t('common.cancel')}
						// A Promise keeps the OK button loading until the delete settles (antd Popconfirm, promise demo).
						onConfirm={() => remove(item.id)}
					>
						<Button
							type="link"
							danger
						>
							{t('common.delete')}
						</Button>
					</Popconfirm>
				</Space>
			),
		},
	]

	return (
		<Drawer
			open={open}
			onClose={onClose}
			size="large"
			destroyOnHidden
			title={t('admin_apps.annotations')}
			extra={
				<Button
					type="primary"
					icon={<PlusOutlined />}
					disabled={!record}
					onClick={() => setEditing({})}
				>
					{t('annotation.add')}
				</Button>
			}
		>
			{!record ? (
				<Skeleton
					active
					paragraph={{ rows: 6 }}
				/>
			) : (
				<Flex
					vertical
					gap={token.margin}
				>
					<Input.Search
						allowClear
						placeholder={t('annotation.search_placeholder')}
						aria-label={t('annotation.search_placeholder')}
						onSearch={value =>
							setQuery(current => ({ ...current, page: 1, keyword: value.trim() }))
						}
					/>
					{loaded.status === 'error' ? (
						<Result
							status="error"
							title={t('annotation.load_failed')}
							extra={<Button onClick={() => void load()}>{t('common.retry')}</Button>}
						/>
					) : (
						<Table
							rowKey="id"
							columns={columns}
							loading={loaded.status === 'loading'}
							dataSource={loaded.status === 'ready' ? loaded.items : []}
							scroll={{ x: 'max-content' }}
							pagination={{
								current: query.page,
								pageSize: query.limit,
								total: loaded.status === 'ready' ? loaded.total : 0,
								showSizeChanger: true,
								showTotal: total => t('common.total_items', { total }),
								onChange: (page, limit) => setQuery(current => ({ ...current, page, limit })),
							}}
						/>
					)}
				</Flex>
			)}
			<AnnotationFormModal
				open={editing !== null}
				initial={editing?.item}
				onSubmit={save}
				onCancel={() => setEditing(null)}
			/>
		</Drawer>
	)
}

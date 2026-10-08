'use client'

import { PlusOutlined } from '@ant-design/icons'
import {
	App,
	Button,
	Flex,
	Input,
	Popconfirm,
	Result,
	Space,
	Table,
	type TableProps,
	Typography,
} from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { failureText } from '@/components/chat/hooks/dify-errors'
import { createDifyApi } from '@/lib/dify/browser'
import type { AnnotationItem } from '@/lib/dify/types'
import { formatDateTime } from '@/libs/format-date'

import AnnotationFormModal, { type AnnotationFormValues } from './annotation-form-modal'

const DEFAULT_PAGE_SIZE = 10

type Query = { page: number; limit: number; keyword: string; version: number }
type Loaded =
	| { status: 'loading' }
	| { status: 'error' }
	| { status: 'ready'; items: AnnotationItem[]; total: number }

/**
 * The annotations of one app (spec §5.5): server paging, keyword search, add/edit in a modal, confirmed delete,
 * through the app's annotation routes (charter §4.1). antd's `destroyOnHidden` destroys the Drawer's children on
 * close, and the drawer keys this panel by app id (React, "resetting state with a key"), so every opening starts
 * with a fresh query, list and modal.
 */
export default function AnnotationsPanel({ appId }: { appId: string }) {
	const { t, i18n } = useTranslation()
	const { message } = App.useApp()
	const [query, setQuery] = useState<Query>({
		page: 1,
		limit: DEFAULT_PAGE_SIZE,
		keyword: '',
		version: 0,
	})
	const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
	const [editing, setEditing] = useState<{ item?: AnnotationItem } | null>(null)
	const difyApi = useMemo(() => createDifyApi(appId), [appId])

	// The only fetcher: a newer query or a closed panel makes the older answer ignored (React, useEffect "Fetching data").
	useEffect(() => {
		let ignore = false
		setLoaded({ status: 'loading' })
		difyApi
			.listAnnotations({
				page: query.page,
				limit: query.limit,
				keyword: query.keyword || undefined,
			})
			.then(page => {
				if (ignore) return
				setLoaded({ status: 'ready', items: page.data, total: page.total })
			})
			.catch(error => {
				if (ignore) return
				console.error('Failed to load annotations', error)
				setLoaded({ status: 'error' })
			})
		return () => {
			ignore = true
		}
	}, [difyApi, query])
	const reload = () => setQuery(current => ({ ...current, version: current.version + 1 }))

	// The browser client rejects a non-OK answer with DifyRequestError; failureText words it (charter §4.5).
	const save = async (values: AnnotationFormValues) => {
		try {
			if (editing?.item) await difyApi.updateAnnotation(editing.item.id, values)
			else await difyApi.createAnnotation(values)
			message.success(editing?.item ? t('common.update_success') : t('common.create_success'))
			setEditing(null)
			reload()
		} catch (error) {
			console.error('Failed to save the annotation', error)
			message.error(failureText(error, t, t('common.operation_failed')))
		}
	}

	const remove = async (id: string) => {
		try {
			await difyApi.deleteAnnotation(id)
			message.success(t('common.delete_success'))
			reload()
		} catch (error) {
			console.error('Failed to delete the annotation', error)
			message.error(failureText(error, t, t('common.delete_failed')))
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
	const columns: TableProps<AnnotationItem>['columns'] = [
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
		<Flex
			vertical
			gap="middle"
		>
			<Flex gap="small">
				<Input.Search
					style={{ flex: 1 }}
					allowClear
					placeholder={t('annotation.search_placeholder')}
					aria-label={t('annotation.search_placeholder')}
					onSearch={value => setQuery(current => ({ ...current, page: 1, keyword: value.trim() }))}
				/>
				<Button
					type="primary"
					icon={<PlusOutlined />}
					onClick={() => setEditing({})}
				>
					{t('annotation.add')}
				</Button>
			</Flex>
			{loaded.status === 'error' ? (
				<Result
					status="error"
					title={t('annotation.load_failed')}
					extra={<Button onClick={reload}>{t('common.retry')}</Button>}
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
			<AnnotationFormModal
				open={editing !== null}
				initial={editing?.item}
				onSubmit={save}
				onCancel={() => setEditing(null)}
			/>
		</Flex>
	)
}

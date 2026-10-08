'use client'

import { PlusOutlined } from '@ant-design/icons'
import { Button, Col, Empty, Flex, Row, Table, type TableProps, Tag, Typography, theme } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { tablePagination } from '@/components/admin/table-pagination'
import PageHeader from '@/components/shell/page-header'
import AppIcon from '@/components/apps/app-icon'
import { APP_MODE_NAME_KEYS, APP_MODE_OPTIONS } from '@/components/apps/app-modes'
import SearchInput from '@/components/shell/search-input'
import { matchesQuery } from '@/lib/match-query'

import { type AdminAppRow, supportsAnnotations } from './admin-app-row'
import AnnotationsDrawer from './annotations-drawer'
import AppActions from './app-actions'
import AppFormDrawer from './app-form-drawer'
import styles from './app-management.module.css'

/**
 * The app table (spec §5.2): search above, documented column filters for type and status, horizontal scroll
 * inside the table on narrow screens and no fixed or `responsive` columns (responsive columns are added only
 * after hydration, es/table/InternalTable.js).
 */
export default function AppManagement({ apps }: { apps: AdminAppRow[] }) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const [query, setQuery] = useState('')
	// What a drawer shows stays until its close animation has ended (afterOpenChange(false)); `open` follows the admin's action.
	const [editor, setEditor] = useState<{ open: boolean; record?: AdminAppRow }>({ open: false })
	const [annotations, setAnnotations] = useState<{ open: boolean; appId?: string }>({ open: false })
	const openCreate = () => setEditor({ open: true })
	const openEdit = (app: AdminAppRow) => setEditor({ open: true, record: app })
	const openAnnotations = (appId: string) => setAnnotations({ open: true, appId })
	const shown = apps.filter(app => matchesQuery([app.name, app.description, ...app.tags], query))

	const columns: TableProps<AdminAppRow>['columns'] = [
		{
			title: t('admin_apps.column_name'),
			key: 'name',
			ellipsis: true,
			render: (_, app) => (
				<Flex
					align="center"
					gap="small"
				>
					<AppIcon
						appId={app.id}
						icon={app.icon}
						mode={app.mode}
						size="small"
					/>
					<span>{app.name || t('common.none')}</span>
				</Flex>
			),
		},
		{
			title: t('admin_apps.column_type'),
			key: 'mode',
			filters: APP_MODE_OPTIONS.map(mode => ({ text: t(APP_MODE_NAME_KEYS[mode]), value: mode })),
			onFilter: (value, app) => app.mode === value,
			render: (_, app) => (app.mode ? t(APP_MODE_NAME_KEYS[app.mode]) : t('common.none')),
		},
		{
			title: t('admin_apps.column_description'),
			key: 'description',
			render: (_, app) => (
				<Typography.Paragraph
					className={styles.description}
					style={{ marginBottom: 0 }}
					ellipsis={{ rows: 2, tooltip: app.description }}
				>
					{app.description || t('app.no_description')}
				</Typography.Paragraph>
			),
		},
		{
			title: t('admin_apps.column_tags'),
			key: 'tags',
			render: (_, app) =>
				app.tags.length > 0 ? (
					<Flex
						wrap
						gap="small"
					>
						{app.tags.map(tag => (
							<Tag key={tag}>{tag}</Tag>
						))}
					</Flex>
				) : null,
		},
		{
			title: t('common.status'),
			key: 'status',
			filters: [
				{ text: t('admin_apps.status_enabled'), value: true },
				{ text: t('admin_apps.status_disabled'), value: false },
			],
			onFilter: (value, app) => app.enabled === value,
			render: (_, app) =>
				app.enabled ? (
					<Tag color="success">{t('admin_apps.status_enabled')}</Tag>
				) : (
					<Tag>{t('admin_apps.status_disabled')}</Tag>
				),
		},
		{
			title: t('common.actions'),
			key: 'actions',
			render: (_, app) => (
				<AppActions
					app={app}
					onEdit={() => openEdit(app)}
					onAnnotations={supportsAnnotations(app.mode) ? () => openAnnotations(app.id) : undefined}
				/>
			),
		},
	]

	return (
		<Flex
			vertical
			gap={token.margin}
		>
			<PageHeader
				title={t('admin_apps.title')}
				subtitle={t('admin_apps.subtitle')}
				action={
					<Button
						type="primary"
						icon={<PlusOutlined />}
						onClick={openCreate}
					>
						{t('common.new')}
					</Button>
				}
			/>
			<Row>
				<Col
					xs={24}
					md={12}
					lg={8}
				>
					<SearchInput
						placeholder={t('app.search_placeholder')}
						value={query}
						onChange={setQuery}
					/>
				</Col>
			</Row>
			<Table
				rowKey="id"
				columns={columns}
				dataSource={shown}
				scroll={{ x: 'max-content' }}
				pagination={tablePagination(total => t('admin_apps.total', { total }))}
				locale={
					query.trim()
						? {
								emptyText: (
									<Empty
										image={Empty.PRESENTED_IMAGE_SIMPLE}
										description={t('app.no_match')}
									/>
								),
							}
						: undefined
				}
			/>
			<AppFormDrawer
				open={editor.open}
				record={editor.record}
				onClose={() => setEditor(current => ({ ...current, open: false }))}
				onClosed={() => setEditor({ open: false })}
			/>
			<AnnotationsDrawer
				open={annotations.open}
				appId={annotations.appId}
				onClose={() => setAnnotations(current => ({ ...current, open: false }))}
				onClosed={() => setAnnotations({ open: false })}
			/>
		</Flex>
	)
}

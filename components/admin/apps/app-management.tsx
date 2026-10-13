'use client'

import { PlusOutlined } from '@ant-design/icons'
import { Button, Col, Empty, Flex, Row, Table, type TableProps, Tag, Typography, theme } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { tablePagination } from '@/components/admin/table-pagination'
import PageHeader from '@/components/shell/page-header'
import AppIcon from '@/components/apps/app-icon'
import { adminAppType, PROVIDER_UI, providerLine } from '@/components/provider-ui/registry'
import SearchInput from '@/components/shell/search-input'
import type { GroupOption } from '@/lib/data/groups'
import type { UserOption } from '@/lib/data/users'
import { matchesQuery } from '@/lib/match-query'
import { PROVIDER_IDS } from '@/lib/providers/ids'

import { accessSummary, type AdminAppRow } from './admin-app-row'
import AppActions from './app-actions'
import AppFormDrawer from './app-form-drawer'
import styles from './app-management.module.css'

/**
 * The app table (spec §5.2; Part 1 E9): search above, documented column filters for provider and status, horizontal scroll
 * inside the table on narrow screens and no fixed or `responsive` columns (responsive columns are added only
 * after hydration, es/table/InternalTable.js).
 */
export default function AppManagement({
	apps,
	groups,
	users,
}: {
	apps: AdminAppRow[]
	/** The access pickers' options (B3 spec §4.4). */
	groups: GroupOption[]
	users: UserOption[]
}) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const [query, setQuery] = useState('')
	// What a drawer shows stays until its close animation has ended (afterOpenChange(false)); `open` follows the admin's action.
	const [editor, setEditor] = useState<{ open: boolean; record?: AdminAppRow }>({ open: false })
	const openCreate = () => setEditor({ open: true })
	const openEdit = (app: AdminAppRow) => setEditor({ open: true, record: app })
	const shown = apps.filter(app => matchesQuery([app.name, app.description, ...app.tags], query))
	// E5: every tag the apps use, once, as the tag field's suggestions.
	const tagOptions = [...new Set(apps.flatMap(app => app.tags))].sort()

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
						provider={app.provider}
						hasIcon={app.hasIcon}
						size="small"
					/>
					<span>{app.name || t('common.none')}</span>
				</Flex>
			),
		},
		{
			// E9: plain text, "Dify · Chatflow"; the built-in filters list the providers with their types nested
			// (antd Table column `filters` with `children`; the default filterMode "menu" shows them as a submenu).
			title: t('admin_apps.column_provider'),
			key: 'provider',
			filters: PROVIDER_IDS.map(id => {
				const ui = PROVIDER_UI[id]
				return ui.types.length
					? {
							text: t(ui.labelKey),
							value: id,
							children: ui.types.map(type => ({
								text: t(ui.typeLabelKeys[type]),
								value: `${id}:${type}`,
							})),
						}
					: { text: t(ui.labelKey), value: id }
			}),
			onFilter: (value, app) =>
				value === app.provider || value === `${app.provider}:${adminAppType(app)}`,
			render: (_, app) => providerLine(t, app.provider, adminAppType(app)),
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
			// Spec §2.3: a row whose documents fail cannot be used; it says so, and Edit opens on the provider's defaults.
			render: (_, app) =>
				app.invalid ? (
					<Tag color="error">{t('admin_apps.status_invalid')}</Tag>
				) : app.enabled ? (
					<Tag color="success">{t('admin_apps.status_enabled')}</Tag>
				) : (
					<Tag>{t('admin_apps.status_disabled')}</Tag>
				),
		},
		{
			title: t('admin_apps.column_access'),
			key: 'access',
			render: (_, app) => {
				const summary = accessSummary(app.access)
				if (summary.kind === 'everyone')
					return <Tag color="green">{t('admin_apps.access_everyone')}</Tag>
				if (summary.kind === 'admins_only')
					return <Tag color="warning">{t('admin_apps.access_admins_only')}</Tag>
				return (
					<Tag color="blue">
						{t('admin_apps.access_restricted', { groups: summary.groups, people: summary.people })}
					</Tag>
				)
			},
		},
		{
			title: t('common.actions'),
			key: 'actions',
			render: (_, app) => (
				<AppActions
					app={app}
					onEdit={() => openEdit(app)}
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
				groups={groups}
				users={users}
				tagOptions={tagOptions}
				onClose={() => setEditor(current => ({ ...current, open: false }))}
				onClosed={() => setEditor({ open: false })}
			/>
		</Flex>
	)
}

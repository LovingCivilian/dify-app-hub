'use client'

import { Col, Flex, Row, Table, type TableProps, Tag, Typography, theme } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import AdminPageHeader from '@/components/admin/admin-page-header'
import AppIcon from '@/components/apps/app-icon'
import SearchInput from '@/components/shell/search-input'
import { AppModeNames, AppModeOptions, EIsEnabled } from '@/lib/core'
import { matchesQuery } from '@/lib/match-query'

import type { AdminAppRow } from './admin-app-row'
import AppActions from './app-actions'
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
	const shown = apps.filter(app => matchesQuery([app.name, app.description, ...app.tags], query))

	const columns: TableProps<AdminAppRow>['columns'] = [
		{
			title: t('admin_apps.column_name'),
			key: 'name',
			render: (_, app) => (
				<Flex
					align="center"
					gap="small"
				>
					<AppIcon
						appId={app.id}
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
			filters: AppModeOptions.map(option => ({ text: t(option.label), value: option.value })),
			onFilter: (value, app) => app.mode === value,
			render: (_, app) => (app.mode ? t(AppModeNames[app.mode]) : t('common.none')),
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
				{ text: t('admin_apps.status_enabled'), value: EIsEnabled.enabled },
				{ text: t('admin_apps.status_disabled'), value: EIsEnabled.disabled },
			],
			onFilter: (value, app) => app.isEnabled === value,
			render: (_, app) =>
				app.isEnabled === EIsEnabled.disabled ? (
					<Tag>{t('admin_apps.status_disabled')}</Tag>
				) : (
					<Tag color="success">{t('admin_apps.status_enabled')}</Tag>
				),
		},
		{
			title: t('common.actions'),
			key: 'actions',
			render: (_, app) => <AppActions app={app} />,
		},
	]

	return (
		<Flex
			vertical
			gap={token.margin}
		>
			<AdminPageHeader title={t('admin_apps.title')} />
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
			/>
		</Flex>
	)
}

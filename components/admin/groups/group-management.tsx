'use client'

import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import {
	App,
	Button,
	Col,
	Empty,
	Flex,
	Popconfirm,
	Row,
	Space,
	Table,
	type TableProps,
	Tag,
	Typography,
	theme,
} from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { deleteGroupAction } from '@/app/(admin)/group-management/actions'
import ClientDateTime from '@/components/admin/client-date-time'
import { tablePagination } from '@/components/admin/table-pagination'
import PageHeader from '@/components/shell/page-header'
import SearchInput from '@/components/shell/search-input'
import { useActionTransition } from '@/hooks/use-action-transition'
import type { GroupDto } from '@/lib/data/groups'
import type { UserOption } from '@/lib/data/users'
import { matchesQuery } from '@/lib/match-query'

import { groupErrorKey } from './group-errors'
import GroupFormDrawer from './group-form-drawer'

/**
 * The groups table (B3 spec §4.3): search, member and app counts, the linked directory groups while the directory is
 * configured (spec §6.5), Server Actions for every write.
 */
export default function GroupManagement({
	groups,
	users,
	directoryEnabled,
}: {
	groups: GroupDto[]
	users: UserOption[]
	/** Whether the `LDAP_*` block is set: the directory groups column and field show only then. */
	directoryEnabled: boolean
}) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { message } = App.useApp()
	const [query, setQuery] = useState('')
	// The drawer's `open` follows the admin's action; the group it edits stays until the close animation has ended.
	const [drawerOpen, setDrawerOpen] = useState(false)
	const [editing, setEditing] = useState<GroupDto>()
	const openDrawer = (group?: GroupDto) => {
		setEditing(group)
		setDrawerOpen(true)
	}
	const shown = groups.filter(group => matchesQuery([group.name, group.description ?? ''], query))

	const { run } = useActionTransition()
	const remove = (group: GroupDto) =>
		run(async () => {
			const result = await deleteGroupAction(group.id)
			if (result.ok) message.success(t('admin_groups.delete_success'))
			else message.error(t(groupErrorKey(result.code)))
		})

	const columns: TableProps<GroupDto>['columns'] = [
		{
			title: t('admin_groups.column_group'),
			key: 'group',
			render: (_, group) => (
				<div>
					<div>{group.name}</div>
					{group.description && (
						<Typography.Text type="secondary">{group.description}</Typography.Text>
					)}
				</div>
			),
		},
		{
			title: t('admin_groups.column_members'),
			key: 'members',
			// Distinct accounts: from B3b a person can be a manual and a directory member of one group.
			render: (_, group) => new Set(group.members.map(member => member.userId)).size,
		},
		...(directoryEnabled
			? [
					{
						title: t('admin_groups.column_directory_groups'),
						key: 'directoryGroups',
						render: (_: unknown, group: GroupDto) =>
							group.directoryLinks.length ? (
								<Flex
									wrap
									gap="small"
								>
									{group.directoryLinks.map(link => (
										<Tag
											key={link.id}
											color={link.missingSince ? 'warning' : 'blue'}
										>
											{link.missingSince
												? t('admin_groups.directory_group_missing', { name: link.name })
												: link.name}
										</Tag>
									))}
								</Flex>
							) : null,
					},
				]
			: []),
		{ title: t('admin_groups.column_apps'), key: 'apps', render: (_, group) => group.appCount },
		{
			title: t('common.created_at'),
			key: 'createdAt',
			render: (_, group) => <ClientDateTime value={group.createdAt} />,
		},
		{
			title: t('common.actions'),
			key: 'actions',
			render: (_, group) => (
				<Space>
					<Button
						type="text"
						icon={<EditOutlined />}
						onClick={() => openDrawer(group)}
					>
						{t('common.edit')}
					</Button>
					<Popconfirm
						title={t('admin_groups.delete_confirm_title')}
						description={t('admin_groups.delete_confirm_description')}
						okText={t('common.delete')}
						okButtonProps={{ danger: true }}
						cancelText={t('common.cancel')}
						onConfirm={() => remove(group)}
					>
						<Button
							type="text"
							danger
							icon={<DeleteOutlined />}
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
			gap={token.margin}
		>
			<PageHeader
				title={t('admin.menu_groups')}
				subtitle={t('admin_groups.subtitle')}
				action={
					<Button
						type="primary"
						icon={<PlusOutlined />}
						onClick={() => openDrawer()}
					>
						{t('admin_groups.add_group')}
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
						placeholder={t('admin_groups.search_placeholder')}
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
				locale={
					query.trim()
						? {
								emptyText: (
									<Empty
										image={Empty.PRESENTED_IMAGE_SIMPLE}
										description={t('admin_groups.no_match')}
									/>
								),
							}
						: undefined
				}
				pagination={tablePagination(total => t('admin_groups.total', { total }))}
			/>
			<GroupFormDrawer
				open={drawerOpen}
				group={editing}
				users={users}
				directoryEnabled={directoryEnabled}
				onClose={() => setDrawerOpen(false)}
				onClosed={() => setEditing(undefined)}
			/>
		</Flex>
	)
}

'use client'

import { useDebounceFn, useUnmount } from 'ahooks'
import {
	App,
	Button,
	Drawer,
	Flex,
	Form,
	type FormInstance,
	Input,
	Select,
	Space,
	Spin,
	Tag,
	Typography,
	theme,
} from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { createGroupAction, updateGroupAction } from '@/app/(admin)/group-management/actions'
import {
	DIRECTORY_SEARCH_MIN,
	GROUP_DESCRIPTION_MAX,
	GROUP_NAME_MAX,
	type GroupFormInput,
} from '@/app/(admin)/group-management/schemas'
import { accountOptionLabel } from '@/components/admin/account-option'
import { drawerPopupContainer } from '@/components/admin/drawer-popup-container'
import { useActionTransition } from '@/hooks/use-action-transition'
import type { GroupDto } from '@/lib/data/groups'
import type { UserOption } from '@/lib/data/users'
import { readDifyError } from '@/lib/dify/browser'
import type { DirectoryGroupOption } from '@/lib/directory/admin'
import { DIRECTORY_GROUP_SEARCH_LIMIT } from '@/lib/directory-status'

import { directorySearchErrorKey, groupErrorKey } from './group-errors'

const GROUP_FORM_ID = 'group-form'

/** A picked directory group as the Select holds it (antd Select `labelInValue`: the value is `{ value, label }`). */
type DirectoryGroupValue = { value: string; label: string }

/** The form's values: the schema's input, with the directory groups as the Select holds them (decision am). */
type GroupFormValues = Omit<GroupFormInput, 'directoryGroups'> & {
	directoryGroups?: DirectoryGroupValue[]
}

/**
 * The directory groups field (spec §6.5): a debounced remote search of GET /api/directory/groups (decision al), after
 * antd's "Search and Select Users" demo, which fetches its options the same way. Each search aborts the one before it
 * (MDN AbortController), so only the latest answer is shown, and leaving the drawer aborts the last one (ahooks
 * `useUnmount`). Form.Item hands its control an `id`, which the label's `for` and `scrollToField` need (antd Form FAQ:
 * "Make sure that it hasn't been ignored in your custom form control").
 */
function DirectoryGroupSelect({
	id,
	value,
	onChange,
}: {
	id?: string
	value?: DirectoryGroupValue[]
	onChange?: (value: DirectoryGroupValue[]) => void
}) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const [options, setOptions] = useState<DirectoryGroupValue[]>([])
	const [fetching, setFetching] = useState(false)
	const [limited, setLimited] = useState(false)
	const [tooShort, setTooShort] = useState(true)
	const { token } = theme.useToken()
	const request = useRef<AbortController | null>(null)
	useUnmount(() => request.current?.abort())
	const { run: search } = useDebounceFn(
		async (text: string) => {
			request.current?.abort()
			request.current = null
			setOptions([])
			setLimited(false)
			// Counted in code points, as the route's zod `min` counts them (Zod 4.5, "String length counts code points").
			const short = Array.from(text.trim()).length < DIRECTORY_SEARCH_MIN
			setTooShort(short)
			setFetching(!short)
			// Decision al: a text under two characters never reaches the directory (the route refuses it too).
			if (short) return
			const controller = new AbortController()
			request.current = controller
			try {
				const response = await fetch(`/api/directory/groups?${new URLSearchParams({ q: text })}`, {
					signal: controller.signal,
				})
				if (!response.ok) {
					// The envelope's code, never its English message (charter §4.5).
					const { code } = await readDifyError(response)
					if (!controller.signal.aborted) message.error(t(directorySearchErrorKey(code)))
					return
				}
				const groups = (await response.json()) as DirectoryGroupOption[]
				if (controller.signal.aborted) return
				setOptions(groups.map(group => ({ value: group.key, label: group.name })))
				setLimited(groups.length >= DIRECTORY_GROUP_SEARCH_LIMIT)
			} catch {
				// An aborted search was replaced or left; anything else is a network failure.
				if (!controller.signal.aborted) message.error(t(directorySearchErrorKey(undefined)))
			} finally {
				if (request.current === controller) {
					request.current = null
					setFetching(false)
				}
			}
		},
		{ wait: 300 },
	)
	return (
		<Select
			id={id}
			mode="multiple"
			labelInValue
			value={value}
			onChange={onChange}
			options={options}
			getPopupContainer={drawerPopupContainer}
			showSearch={{ filterOption: false, onSearch: search, autoClearSearchValue: false }}
			notFoundContent={
				fetching ? (
					<Spin size="small" />
				) : (
					t(
						tooShort
							? 'admin_groups.directory_groups_placeholder'
							: 'admin_groups.directory_groups_none',
					)
				)
			}
			// Decision al: twenty answers may not be all; the list says so (antd Select `popupRender`, 5.25.0).
			popupRender={menu => (
				<>
					{menu}
					{limited && (
						<Typography.Paragraph
							type="secondary"
							style={{ margin: 0, padding: `${token.paddingXS}px ${token.paddingSM}px` }}
						>
							{t('admin_groups.directory_groups_limited', { limit: DIRECTORY_GROUP_SEARCH_LIMIT })}
						</Typography.Paragraph>
					)}
				</>
			)}
			placeholder={t('admin_groups.directory_groups_placeholder')}
		/>
	)
}

/**
 * The form inside the drawer. It owns its instance through `Form.useForm()` here, in a component that mounts with the
 * drawer's content (`destroyOnHidden`), so each opening starts from its own `initialValues` (the users drawer's
 * reason for not holding the instance in the drawer); the instance is needed for `setFields` on the member picker.
 */
function GroupForm({
	group,
	users,
	directoryEnabled,
	onSave,
}: {
	group?: GroupDto
	users: UserOption[]
	directoryEnabled: boolean
	onSave: (values: GroupFormInput, form: FormInstance<GroupFormValues>) => void
}) {
	const { t } = useTranslation()
	const [form] = Form.useForm<GroupFormValues>()
	// Spec §4.3: the directory members, which the sync and the directory sign-in own, are listed read-only.
	const usersById = new Map(users.map(user => [user.id, user]))
	const directoryMembers = (group?.members ?? [])
		.filter(member => member.source === 'directory')
		.flatMap(member => usersById.get(member.userId) ?? [])
	return (
		<Form<GroupFormValues>
			form={form}
			id={GROUP_FORM_ID}
			layout="vertical"
			initialValues={
				group
					? {
							name: group.name,
							description: group.description ?? '',
							memberIds: group.members
								.filter(member => member.source === 'manual')
								.map(member => member.userId),
							directoryGroups: group.directoryLinks.map(link => ({
								value: link.id,
								label: link.name,
							})),
						}
					: { name: '', description: '', memberIds: [], directoryGroups: [] }
			}
			onFinish={values =>
				onSave(
					{
						...values,
						directoryGroups: (values.directoryGroups ?? []).map(({ value, label }) => ({
							id: value,
							name: String(label),
						})),
					},
					form,
				)
			}
			// A field without `rules` is never re-validated, so the server's error on the picker is cleared by hand
			// when the pick changes (@rc-component/form Field: validation runs only for fields with rules).
			onValuesChange={changed => {
				if ('memberIds' in changed) form.setFields([{ name: 'memberIds', errors: [] }])
			}}
		>
			<Form.Item
				name="name"
				label={t('admin_groups.name')}
				rules={[
					{ required: true, whitespace: true, message: t('admin_groups.name_required') },
					{ max: GROUP_NAME_MAX, message: t('admin_groups.name_too_long') },
				]}
			>
				<Input placeholder={t('admin_groups.name_placeholder')} />
			</Form.Item>
			<Form.Item
				name="description"
				label={t('admin_groups.description')}
				rules={[{ max: GROUP_DESCRIPTION_MAX, message: t('admin_groups.description_too_long') }]}
			>
				<Input.TextArea
					autoSize={{ minRows: 2, maxRows: 6 }}
					placeholder={t('admin_groups.description_placeholder')}
				/>
			</Form.Item>
			<Form.Item
				name="memberIds"
				label={t('admin_groups.members')}
				extra={t('admin_groups.members_hint')}
			>
				<Select
					mode="multiple"
					getPopupContainer={drawerPopupContainer}
					allowClear
					showSearch={{ optionFilterProp: 'label' }}
					placeholder={t('admin_groups.members_placeholder')}
					options={users.map(user => ({
						value: user.id,
						label: accountOptionLabel(user, t('admin_users.status_deactivated')),
					}))}
				/>
			</Form.Item>
			{directoryMembers.length > 0 && (
				<Form.Item
					label={t('admin_groups.directory_members')}
					extra={t('admin_groups.directory_members_hint')}
				>
					<Flex
						wrap
						gap="small"
					>
						{directoryMembers.map(user => (
							<Tag
								key={user.id}
								color="blue"
							>
								{accountOptionLabel(user, t('admin_users.status_deactivated'))}
							</Tag>
						))}
					</Flex>
				</Form.Item>
			)}
			{/*
			 * Hidden, not left out, while the directory is off: onFinish carries the registered fields only, so a form
			 * without the field would save no link and delete the group's links and directory members (decision am).
			 * antd Form.Item `hidden`: "Whether to hide Form.Item (still collect and validate value)".
			 */}
			<Form.Item
				name="directoryGroups"
				label={t('admin_groups.directory_groups')}
				extra={t('admin_groups.directory_groups_hint')}
				hidden={!directoryEnabled}
			>
				<DirectoryGroupSelect />
			</Form.Item>
		</Form>
	)
}

/**
 * Add or edit a group (B3 spec §4.3). The Server Actions run through startTransition from onFinish (ADR-0023 "Admin
 * actions"); the form is keyed by the group it edits. The member picker edits the manual members only (spec §2 #8);
 * the directory groups field, while the directory is configured, edits the links (spec §6.5). Its search is a fetch of
 * GET /api/directory/groups outside any transition, as a read is (decision al).
 */
export default function GroupFormDrawer({
	open,
	group,
	users,
	directoryEnabled,
	onClose,
	onClosed,
}: {
	open: boolean
	/** The group to edit; absent when adding. */
	group?: GroupDto
	users: UserOption[]
	/** Whether the `LDAP_*` block is set: the directory groups field shows only then. */
	directoryEnabled: boolean
	onClose: () => void
	/** Called once the close animation has ended (Drawer `afterOpenChange(false)`): the parent clears `group`. */
	onClosed: () => void
}) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { pending, run } = useActionTransition()

	const save = (values: GroupFormInput, form: FormInstance<GroupFormValues>) =>
		void run(async () => {
			const result = group
				? await updateGroupAction(group.id, values)
				: await createGroupAction(values)
			if (result.ok) {
				message.success(t(group ? 'admin_groups.update_success' : 'admin_groups.add_success'))
				onClose()
				return
			}
			// A stale pick (an account deleted meanwhile) is the picker's own error (deviation 3).
			if (result.code === 'invalid_input' && result.fieldErrors?.memberIds) {
				form.setFields([{ name: 'memberIds', errors: [t('admin_groups.member_missing')] }])
				return
			}
			message.error(t(groupErrorKey(result.code)))
		})

	return (
		<Drawer
			open={open}
			onClose={onClose}
			afterOpenChange={visible => {
				if (!visible) onClosed()
			}}
			destroyOnHidden
			title={group ? t('admin_groups.edit_group') : t('admin_groups.add_group')}
			extra={
				<Space>
					<Button onClick={onClose}>{t('common.cancel')}</Button>
					<Button
						type="primary"
						htmlType="submit"
						form={GROUP_FORM_ID}
						loading={pending}
					>
						{group ? t('common.update') : t('common.add')}
					</Button>
				</Space>
			}
		>
			<GroupForm
				key={group?.id ?? 'create'}
				group={group}
				users={users}
				directoryEnabled={directoryEnabled}
				onSave={save}
			/>
		</Drawer>
	)
}

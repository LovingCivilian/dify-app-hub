'use client'

import { App, Button, Drawer, Form, type FormInstance, Input, Select, Space } from 'antd'
import { useTranslation } from 'react-i18next'

import { createGroupAction, updateGroupAction } from '@/app/(admin)/group-management/actions'
import {
	GROUP_DESCRIPTION_MAX,
	GROUP_NAME_MAX,
	type GroupFormInput,
} from '@/app/(admin)/group-management/schemas'
import { accountOptionLabel } from '@/components/admin/account-option'
import { drawerPopupContainer } from '@/components/admin/drawer-popup-container'
import { useActionTransition } from '@/hooks/use-action-transition'
import type { GroupDto } from '@/lib/data/groups'
import type { UserOption } from '@/lib/data/users'

import { groupErrorKey } from './group-errors'

const GROUP_FORM_ID = 'group-form'

/**
 * The form inside the drawer. It owns its instance through `Form.useForm()` here, in a component that mounts with the
 * drawer's content (`destroyOnHidden`), so each opening starts from its own `initialValues` (the users drawer's
 * reason for not holding the instance in the drawer); the instance is needed for `setFields` on the member picker.
 */
function GroupForm({
	group,
	users,
	onSave,
}: {
	group?: GroupDto
	users: UserOption[]
	onSave: (values: GroupFormInput, form: FormInstance<GroupFormInput>) => void
}) {
	const { t } = useTranslation()
	const [form] = Form.useForm<GroupFormInput>()
	return (
		<Form<GroupFormInput>
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
						}
					: { name: '', description: '', memberIds: [] }
			}
			onFinish={values => onSave(values, form)}
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
		</Form>
	)
}

/**
 * Add or edit a group (B3 spec §4.3). The Server Actions run through startTransition from onFinish (ADR-0023 "Admin
 * actions"); the form is keyed by the group it edits. The member picker edits the manual members only (spec §2 #8).
 */
export default function GroupFormDrawer({
	open,
	group,
	users,
	onClose,
	onClosed,
}: {
	open: boolean
	/** The group to edit; absent when adding. */
	group?: GroupDto
	users: UserOption[]
	onClose: () => void
	/** Called once the close animation has ended (Drawer `afterOpenChange(false)`): the parent clears `group`. */
	onClosed: () => void
}) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { pending, run } = useActionTransition()

	const save = (values: GroupFormInput, form: FormInstance<GroupFormInput>) =>
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
				onSave={save}
			/>
		</Drawer>
	)
}

'use client'

import { App, Button, Drawer, Form, type FormInstance, Space } from 'antd'
import { useTranslation } from 'react-i18next'

import { createAppAction, updateAppAction } from '@/app/(admin)/app-management/actions'
import { useActionTransition } from '@/hooks/use-action-transition'
import type { AppAccessSettings } from '@/lib/app-access'
import type { GroupOption } from '@/lib/data/groups'
import type { UserOption } from '@/lib/data/users'

import type { AdminAppRow } from './admin-app-row'
import { appErrorKey } from './app-errors'
import { type AppFormValues, DEFAULT_APP_FORM_VALUES, toAppFormValues } from './app-form-values'
import AppSettingsFields from './app-settings-fields'

const APP_FORM_ID = 'app-settings-form'

/** The access pickers' errors: a group or account picked there and deleted meanwhile (deviation 3, ruling M13). */
const accessPickerErrors = (
	errors: string[],
): Parameters<FormInstance<AppFormValues>['setFields']>[0] => [
	{ name: ['access', 'groupIds'], errors },
	{ name: ['access', 'userIds'], errors },
]

/**
 * The form inside the drawer. It owns its instance through `Form.useForm()` here, in a component that mounts with the
 * drawer's content (`destroyOnHidden`), so each opening starts from its own `initialValues`; a drawer-level
 * `Form.useForm()` would keep the last values (and `clearOnDestroy` empties the store under Strict Mode's remount).
 * The instance is needed for `setFields` on the access pickers (the groups drawer's pattern).
 */
function AppForm({
	record,
	groups,
	users,
	onSave,
}: {
	record?: AdminAppRow
	groups: GroupOption[]
	users: UserOption[]
	onSave: (values: AppFormValues, form: FormInstance<AppFormValues>) => void
}) {
	const [form] = Form.useForm<AppFormValues>()
	return (
		<Form<AppFormValues>
			form={form}
			id={APP_FORM_ID}
			layout="vertical"
			autoComplete="off"
			initialValues={record ? toAppFormValues(record) : DEFAULT_APP_FORM_VALUES}
			onFinish={values => onSave(values, form)}
			// A field without `rules` is never re-validated, so the server's error on the pickers is cleared by hand
			// when either pick changes (@rc-component/form Field: validation runs only for fields with rules).
			onValuesChange={(changed: { access?: Partial<AppAccessSettings> }) => {
				if (changed.access && ('groupIds' in changed.access || 'userIds' in changed.access))
					form.setFields(accessPickerErrors([]))
			}}
		>
			<AppSettingsFields
				record={record}
				groups={groups}
				users={users}
			/>
		</Form>
	)
}

export interface AppFormDrawerProps {
	open: boolean
	/** The app to edit; absent means create. */
	record?: AdminAppRow
	/** The options of the access pickers (B3 spec §4.4). */
	groups: GroupOption[]
	users: UserOption[]
	onClose: () => void
	/** Called once the close animation has ended (Drawer `afterOpenChange(false)`): the parent clears the content. */
	onClosed: () => void
}

/**
 * Create or edit an app (spec §5.4): antd's form-in-drawer layout with the actions in `extra`; `destroyOnHidden`
 * unmounts the form on close. The submit button reaches the form through the HTML `form` attribute. The form is keyed
 * by what it edits, so a drawer reopened for other content while it still slides out (no unmount in between) gets a
 * fresh store too.
 */
export default function AppFormDrawer({
	open,
	record,
	groups,
	users,
	onClose,
	onClosed,
}: AppFormDrawerProps) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { pending, run } = useActionTransition()

	const save = (values: AppFormValues, form: FormInstance<AppFormValues>) =>
		void run(async () => {
			const result = record
				? await updateAppAction(record.id, values)
				: await createAppAction(values)
			if (!result.ok) {
				// A stale pick (a group or account deleted meanwhile) is the pickers' own error (deviation 3).
				if (result.code === 'invalid_input' && result.fieldErrors?.access) {
					form.setFields(accessPickerErrors([t('app_setting.access_pick_missing')]))
					return
				}
				// A refused key, an error body or an unreachable base keeps the drawer open.
				message.error(t(appErrorKey(result.code, 'save')))
				return
			}
			message.success(t(record ? 'admin_apps.edit_success' : 'admin_apps.create_success'))
			if (result.data.partial) message.warning(t('admin_apps.icon_not_stored'))
			onClose()
		})

	return (
		<Drawer
			open={open}
			onClose={onClose}
			afterOpenChange={visible => {
				if (!visible) onClosed()
			}}
			size="large"
			destroyOnHidden
			title={
				record ? t('admin_apps.edit_title', { name: record.name }) : t('admin_apps.create_title')
			}
			extra={
				<Space>
					<Button onClick={onClose}>{t('common.cancel')}</Button>
					<Button
						type="primary"
						loading={pending}
						htmlType="submit"
						form={APP_FORM_ID}
					>
						{record ? t('common.update') : t('common.ok')}
					</Button>
				</Space>
			}
		>
			<AppForm
				key={record?.id ?? 'create'}
				record={record}
				groups={groups}
				users={users}
				onSave={save}
			/>
		</Drawer>
	)
}

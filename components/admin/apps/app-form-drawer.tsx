'use client'

import { App, Button, Drawer, Form, type FormInstance, Space } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { createAppAction, updateAppAction } from '@/app/(admin)/app-management/actions'
import ProviderFormSection from '@/components/provider-ui/provider-form-section'
import { useActionTransition } from '@/hooks/use-action-transition'
import type { AppAccessSettings } from '@/lib/app-access'
import type { AdminAppDto } from '@/lib/data/apps'
import type { GroupOption } from '@/lib/data/groups'
import type { UserOption } from '@/lib/data/users'
import type { ProviderId } from '@/lib/providers/ids'

import AppCommonFields from './app-common-fields'
import { appErrorKey } from './app-errors'
import {
	type AppFormValues,
	DEFAULT_APP_FORM_VALUES,
	type IconDraft,
	providerDefaults,
	toAppFormData,
	toAppFormValues,
} from './app-form-values'
import { useRequiredMark } from './required-mark'

const APP_FORM_ID = 'app-settings-form'

/** The access pickers' errors: a group or account picked there and deleted meanwhile (B3a deviation 3, ruling M13). */
const accessPickerErrors = (
	errors: string[],
): Parameters<FormInstance<AppFormValues>['setFields']>[0] => [
	{ name: ['access', 'groupIds'], errors },
	{ name: ['access', 'userIds'], errors },
]

/** What the drawer's save needs from the form: its instance and its icon, whose server refusal it shows. */
interface SaveContext {
	form: FormInstance<AppFormValues>
	icon: IconDraft
	setIconError: (error: string | undefined) => void
}

/**
 * The form inside the drawer. It owns its instance through `Form.useForm()` here, in a component that mounts with the
 * drawer's content (`destroyOnHidden`), so each opening starts from its own `initialValues` and its own icon draft.
 * Layout B (decision 29): `layout="horizontal"` with labels beside the fields, above them on a phone through the grid's
 * responsive spans (Form API `labelCol`: "sm: {span: 3, offset: 12}"; the "basic" demo's 8/16); the requiredMark render
 * (E3). Picking a provider sets its documents to the provider's defaults, so switching before the save resets them.
 */
function AppForm({
	record,
	groups,
	users,
	tagOptions,
	onSave,
}: {
	record?: AdminAppDto
	groups: GroupOption[]
	users: UserOption[]
	tagOptions: string[]
	onSave: (context: SaveContext) => void
}) {
	const [form] = Form.useForm<AppFormValues>()
	const requiredMark = useRequiredMark()
	const [icon, setIcon] = useState<IconDraft>({ intent: 'keep' })
	const [iconError, setIconError] = useState<string | undefined>()
	const provider = Form.useWatch('provider', form)
	return (
		<Form<AppFormValues>
			form={form}
			id={APP_FORM_ID}
			layout="horizontal"
			labelCol={{ xs: { span: 24 }, sm: { span: 8 } }}
			wrapperCol={{ xs: { span: 24 }, sm: { span: 16 } }}
			requiredMark={requiredMark}
			autoComplete="off"
			initialValues={record ? toAppFormValues(record) : DEFAULT_APP_FORM_VALUES}
			onFinish={() => onSave({ form, icon, setIconError })}
			onValuesChange={(changed: { provider?: ProviderId; access?: Partial<AppAccessSettings> }) => {
				if (changed.provider) {
					// Replace the two documents: setFieldsValue deep-merges into the store (@rc-component/form `merge`), while
					// setFieldValue sets the named field's value (spec §4.1: the provider's fields reset to its defaults).
					const defaults = providerDefaults(changed.provider)
					form.setFieldValue('settings', defaults.settings)
					form.setFieldValue('secrets', defaults.secrets)
				}
				// A field without `rules` is never re-validated, so the server's error on the pickers is cleared by hand
				// when either pick changes (@rc-component/form Field: validation runs only for fields with rules).
				if (changed.access && ('groupIds' in changed.access || 'userIds' in changed.access))
					form.setFields(accessPickerErrors([]))
			}}
		>
			<AppCommonFields
				record={record}
				groups={groups}
				users={users}
				tagOptions={tagOptions}
				icon={icon}
				onIconChange={draft => {
					setIcon(draft)
					setIconError(undefined)
				}}
				iconError={iconError}
			/>
			{provider && (
				<ProviderFormSection
					provider={provider}
					appId={record?.id}
					editing={Boolean(record)}
				/>
			)}
		</Form>
	)
}

export interface AppFormDrawerProps {
	open: boolean
	/** The app to edit; absent means create. */
	record?: AdminAppDto
	/** The options of the access pickers (B3 spec §4.4). */
	groups: GroupOption[]
	users: UserOption[]
	/** The tags other apps use, offered as suggestions (E5). */
	tagOptions: string[]
	onClose: () => void
	/** Called once the close animation has ended (Drawer `afterOpenChange(false)`): the parent clears the content. */
	onClosed: () => void
}

/**
 * Create or edit an app (spec §4.1, E2: today's Drawer, right, `size="large"`, Cancel and OK in `extra`);
 * `destroyOnHidden` unmounts the form on close. The submit button reaches the form through the HTML `form` attribute.
 * The form is keyed by what it edits, so a drawer reopened for other content while it still slides out gets a fresh
 * store too.
 */
export default function AppFormDrawer({
	open,
	record,
	groups,
	users,
	tagOptions,
	onClose,
	onClosed,
}: AppFormDrawerProps) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { pending, run } = useActionTransition()

	const save = ({ form, icon, setIconError }: SaveContext) =>
		void run(async () => {
			// The whole store (antd Form: "use `getFieldsValue(true)` to get all values"), not onFinish's values, which
			// hold only the mounted fields: a field shown behind a switch (the form reply's text) would be missing from
			// them, and the server parses whole documents (spec §4.3).
			const data = toAppFormData(form.getFieldsValue(true), icon)
			const result = record ? await updateAppAction(record.id, data) : await createAppAction(data)
			if (result.ok) {
				message.success(t(record ? 'admin_apps.edit_success' : 'admin_apps.create_success'))
				onClose()
				return
			}
			// A stale pick (a group or account deleted meanwhile) is the pickers' own error (B3a deviation 3).
			if (result.code === 'invalid_input' && result.fieldErrors?.access) {
				form.setFields(accessPickerErrors([t('app_setting.access_pick_missing')]))
				return
			}
			// The image the server refused (Task 8's pipeline) is the icon field's own error.
			if (result.code === 'invalid_image') {
				setIconError(
					t(
						result.fieldErrors?.icon?.[0] === 'too_large'
							? 'app_setting.icon_too_large'
							: 'app_setting.icon_not_allowed',
					),
				)
				return
			}
			// A field the server refused (a blank key over a broken stored one, spec §2.3, or a value the browser's rules
			// let through) is marked on its field (formFieldErrors keys them by path). The errors are codes only (review
			// B7), so the field shows one translated text, never a zod message.
			const documentFields = Object.keys(result.fieldErrors ?? {}).filter(key =>
				/^(name|description|tags)$|^tags\.\d+$|^(settings|secrets)\./.test(key),
			)
			// A refused tag comes back as `tags.<index>`; the field is the whole tag list.
			if (documentFields.length)
				form.setFields(
					documentFields.map(key => ({
						name: key.replace(/^tags\.\d+$/, 'tags').split('.'),
						errors: [t('admin_apps.field_invalid')],
					})),
				)
			message.error(t(appErrorKey(result.code, 'save')))
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
				tagOptions={tagOptions}
				onSave={save}
			/>
		</Drawer>
	)
}

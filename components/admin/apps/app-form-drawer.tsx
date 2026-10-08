'use client'

import { App, Button, Drawer, Form, Space } from 'antd'
import { useTranslation } from 'react-i18next'

import { createAppAction, updateAppAction } from '@/app/(admin)/app-management/actions'
import { useActionTransition } from '@/hooks/use-action-transition'
import type { AppDto } from '@/lib/data/apps'

import { appErrorKey } from './app-errors'
import { type AppFormValues, DEFAULT_APP_FORM_VALUES, toAppFormValues } from './app-form-values'
import AppSettingsFields from './app-settings-fields'

const APP_FORM_ID = 'app-settings-form'

export interface AppFormDrawerProps {
	open: boolean
	/** The app to edit; absent means create. */
	record?: AppDto
	onClose: () => void
	/** Called once the close animation has ended (Drawer `afterOpenChange(false)`): the parent clears the content. */
	onClosed: () => void
}

/**
 * Create or edit an app (spec §5.4): antd's form-in-drawer layout with the actions in `extra`; `destroyOnHidden`
 * unmounts the form on close. The Form owns its instance (no `form` prop), so each mounting gets a fresh store
 * seeded from its own `initialValues`; a drawer-level `Form.useForm()` would keep the last values (and
 * `clearOnDestroy` empties the store under Strict Mode's remount). The submit button reaches the form through
 * the HTML `form` attribute. The Form is keyed by what it edits, so a drawer reopened for other content while it
 * still slides out (no unmount in between) gets a fresh store too.
 */
export default function AppFormDrawer({ open, record, onClose, onClosed }: AppFormDrawerProps) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { pending, run } = useActionTransition()

	const save = (values: AppFormValues) =>
		void run(async () => {
			const result = record
				? await updateAppAction(record.id, values)
				: await createAppAction(values)
			if (!result.ok) {
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
			<Form
				key={record?.id ?? 'create'}
				id={APP_FORM_ID}
				layout="vertical"
				autoComplete="off"
				initialValues={record ? toAppFormValues(record) : DEFAULT_APP_FORM_VALUES}
				onFinish={save}
			>
				<AppSettingsFields record={record} />
			</Form>
		</Drawer>
	)
}

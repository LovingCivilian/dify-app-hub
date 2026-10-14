'use client'

import { Divider, Form, Input, Radio, Select, Switch } from 'antd'
import { useTranslation } from 'react-i18next'

import {
	APP_DESCRIPTION_MAX,
	APP_NAME_MAX,
	appTagsSchema,
} from '@/app/(admin)/app-management/schemas'
import { accountOptionLabel } from '@/components/admin/account-option'
import { drawerPopupContainer } from '@/components/admin/drawer-popup-container'
import { appIconUrl } from '@/components/apps/app-icon'
import { PROVIDER_UI } from '@/components/provider-ui/registry'
import type { AdminAppDto } from '@/lib/data/apps'
import type { GroupOption } from '@/lib/data/groups'
import type { UserOption } from '@/lib/data/users'
import { PROVIDER_IDS } from '@/lib/providers/ids'

import type { AppFormValues, IconDraft } from './app-form-values'
import IconField from './icon-field'

/**
 * The fields every provider shares (spec §4.1, layout B): the provider choice first (E1; disabled on an edit, E8), and,
 * once a provider is picked, the rest of Basic (name, description E6, tags E5, icon E4, status) and Access. Until then
 * the provider is the only row. The access pickers show while the app is restricted; hidden, they keep their values in
 * the form store (antd Form `preserve`, default true) and an app open to everyone stores no grant (B3a deviation 4).
 */
export default function AppCommonFields({
	record,
	groups,
	users,
	tagOptions,
	icon,
	onIconChange,
	iconError,
}: {
	record?: AdminAppDto
	groups: GroupOption[]
	users: UserOption[]
	/** The tags other apps use, offered as suggestions (E5). */
	tagOptions: string[]
	icon: IconDraft
	onIconChange: (draft: IconDraft) => void
	iconError?: string
}) {
	const { t } = useTranslation()
	const form = Form.useFormInstance<AppFormValues>()
	const provider = Form.useWatch('provider', form)
	const accessMode = Form.useWatch(['access', 'mode'], form)

	return (
		<>
			<Divider titlePlacement="start">{t('app_setting.section_basic')}</Divider>
			<Form.Item
				label={t('app_setting.provider')}
				name="provider"
				tooltip={t('app_setting.provider_tooltip')}
				rules={[{ required: true, message: t('app_setting.provider_required') }]}
			>
				<Select
					placeholder={t('app_setting.provider_placeholder')}
					disabled={Boolean(record)}
					getPopupContainer={drawerPopupContainer}
					options={PROVIDER_IDS.map(id => ({ value: id, label: t(PROVIDER_UI[id].labelKey) }))}
				/>
			</Form.Item>
			{provider && (
				<>
					<Form.Item
						label={t('app_setting.name')}
						name="name"
						tooltip={t('app_setting.name_tooltip')}
						rules={[
							{ required: true, whitespace: true, message: t('app_setting.name_required') },
							{ max: APP_NAME_MAX },
						]}
					>
						<Input placeholder={t('app_setting.name_placeholder')} />
					</Form.Item>
					<Form.Item
						label={t('app_setting.description')}
						name="description"
						tooltip={t('app_setting.description_tooltip')}
						rules={[{ max: APP_DESCRIPTION_MAX }]}
					>
						<Input.TextArea
							autoSize={{ minRows: 2, maxRows: 6 }}
							placeholder={t('app_setting.description_placeholder')}
						/>
					</Form.Item>
					<Form.Item
						label={t('app_setting.tags')}
						name="tags"
						extra={t('app_setting.tags_help')}
						rules={[
							{
								// The action's own rule (appTagsSchema), so the browser and the server agree.
								validator: (_rule, value) =>
									appTagsSchema.safeParse(value ?? []).success
										? Promise.resolve()
										: Promise.reject(new Error(t('app_setting.tags_help'))),
							},
						]}
					>
						<Select
							mode="tags"
							tokenSeparators={[',']}
							getPopupContainer={drawerPopupContainer}
							placeholder={t('app_setting.tags_placeholder')}
							options={tagOptions.map(tag => ({ value: tag, label: tag }))}
						/>
					</Form.Item>
					<IconField
						provider={provider}
						savedSrc={record?.hasIcon ? appIconUrl(record.id, record.updatedAt) : null}
						draft={icon}
						onChange={onIconChange}
						error={iconError}
					/>
					<Form.Item
						label={t('app_setting.status')}
						name="enabled"
						tooltip={t('app_setting.status_tooltip')}
						valuePropName="checked"
					>
						<Switch />
					</Form.Item>

					<Divider titlePlacement="start">{t('app_setting.section_access')}</Divider>
					<Form.Item
						label={t('app_setting.access')}
						name={['access', 'mode']}
						tooltip={t('app_setting.access_tooltip')}
					>
						<Radio.Group
							optionType="button"
							options={[
								{ value: 'everyone', label: t('app_setting.access_everyone') },
								{ value: 'restricted', label: t('app_setting.access_restricted') },
							]}
						/>
					</Form.Item>
					{accessMode === 'restricted' && (
						<>
							<Form.Item
								label={t('app_setting.access_groups')}
								name={['access', 'groupIds']}
							>
								<Select
									mode="multiple"
									getPopupContainer={drawerPopupContainer}
									allowClear
									showSearch={{ optionFilterProp: 'label' }}
									placeholder={t('app_setting.access_groups_placeholder')}
									options={groups.map(group => ({ value: group.id, label: group.name }))}
								/>
							</Form.Item>
							<Form.Item
								label={t('app_setting.access_people')}
								name={['access', 'userIds']}
								extra={t('app_setting.access_admins_hint')}
							>
								<Select
									mode="multiple"
									getPopupContainer={drawerPopupContainer}
									allowClear
									showSearch={{ optionFilterProp: 'label' }}
									placeholder={t('app_setting.access_people_placeholder')}
									options={users.map(user => ({
										value: user.id,
										label: accountOptionLabel(user, t('admin_users.status_deactivated')),
									}))}
								/>
							</Form.Item>
						</>
					)}
				</>
			)}
		</>
	)
}

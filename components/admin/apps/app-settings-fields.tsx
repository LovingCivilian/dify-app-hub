'use client'

import { Descriptions, Divider, Flex, Form, Input, Radio, Select, Switch, Tag } from 'antd'
import { useTranslation } from 'react-i18next'

import { accountOptionLabel } from '@/components/admin/account-option'
import { APP_MODE_OPTION_KEYS, APP_MODE_OPTIONS } from '@/components/apps/app-modes'
import type { GroupOption } from '@/lib/data/groups'
import type { UserOption } from '@/lib/data/users'

import type { AdminAppRow } from './admin-app-row'
import { validateApiBase } from './api-base-rule'

/** antd Select's documented fix for a popup inside another popup layer: render it in the trigger's parent. */
const popupInDrawer = (trigger: HTMLElement) => trigger.parentElement ?? document.body

/**
 * The settings form's fields; `record` shows the app's Dify info above them when editing. The access pickers show
 * while the app is restricted; hidden, they keep their values in the form store (antd Form `preserve`, default true)
 * but are not submitted (`onFinish` gets the mounted fields), and an app open to everyone stores no grant (deviation 4).
 */
export default function AppSettingsFields({
	record,
	groups,
	users,
}: {
	record?: AdminAppRow
	groups: GroupOption[]
	users: UserOption[]
}) {
	const { t } = useTranslation()
	const form = Form.useFormInstance()
	const replyOn = Form.useWatch(['settings', 'answerForm', 'enabled'], form)
	const accessMode = Form.useWatch(['access', 'mode'], form)

	return (
		<>
			{record && (
				<Descriptions
					column={1}
					size="small"
					items={[
						{ key: 'name', label: t('app_setting.name'), children: record.name },
						{
							key: 'description',
							label: t('app_setting.description'),
							children: record.description || t('common.none'),
						},
						{
							key: 'tags',
							label: t('app_setting.tags'),
							children: record.tags.length ? (
								<Flex
									wrap
									gap="small"
								>
									{record.tags.map(tag => (
										<Tag key={tag}>{tag}</Tag>
									))}
								</Flex>
							) : (
								t('common.none')
							),
						},
					]}
				/>
			)}

			<Divider titlePlacement="start">{t('app_setting.section_request')}</Divider>
			<Form.Item
				label="API Base"
				name="apiBase"
				tooltip={t('app_setting.api_base_tooltip')}
				rules={[
					{ required: true, message: t('app_setting.api_base_required') },
					{ validator: validateApiBase(t('app_setting.api_base_invalid')) },
				]}
			>
				<Input placeholder={t('app_setting.api_base_placeholder')} />
			</Form.Item>
			<Form.Item
				label="API Secret"
				name="apiKey"
				tooltip={t('app_setting.api_secret_tooltip')}
				// The stored key is never sent back to the browser: on edit a blank field keeps it (charter §4.4).
				extra={record ? t('app_setting.api_secret_keep') : undefined}
				rules={record ? [] : [{ required: true, message: t('app_setting.api_secret_required') }]}
			>
				<Input.Password
					autoComplete="new-password"
					placeholder={t('app_setting.api_secret_placeholder')}
				/>
			</Form.Item>

			<Divider titlePlacement="start">{t('app_setting.section_basic')}</Divider>
			<Form.Item
				label={t('app_setting.type')}
				name="mode"
				tooltip={t('app_setting.type_tooltip')}
				rules={[{ required: true, message: t('app_setting.type_required') }]}
			>
				<Select
					placeholder={t('app_setting.type_placeholder')}
					options={APP_MODE_OPTIONS.map(mode => ({
						value: mode,
						label: t(APP_MODE_OPTION_KEYS[mode]),
					}))}
				/>
			</Form.Item>
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
							// The popup stays inside the drawer's body (antd Select `getPopupContainer`, as the groups drawer): on a
							// phone a popup in <body> sat past the screen's edge and shifted the page under the drawer's mask.
							getPopupContainer={popupInDrawer}
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
							getPopupContainer={popupInDrawer}
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

			<Divider titlePlacement="start">{t('app_setting.section_conversation')}</Divider>
			<Form.Item
				label={t('app_setting.update_inputs')}
				name={['settings', 'enableUpdateAfterConversationStarts']}
				tooltip={t('app_setting.update_inputs_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
			<Form.Item
				label={t('app_setting.opening_display')}
				name={['settings', 'openingStatementDisplayMode']}
				tooltip={t('app_setting.opening_display_tooltip')}
			>
				<Select
					options={[
						{ value: 'default', label: t('app_setting.opening_display_default') },
						{ value: 'always', label: t('app_setting.opening_display_always') },
					]}
				/>
			</Form.Item>

			<Divider titlePlacement="start">{t('app_setting.section_more')}</Divider>
			<Form.Item
				label={t('app_setting.allow_annotation')}
				name={['settings', 'annotationEnabled']}
				tooltip={t('app_setting.allow_annotation_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
			<Form.Item
				label={t('app_setting.form_reply')}
				name={['settings', 'answerForm', 'enabled']}
				tooltip={t('app_setting.form_reply_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
			{replyOn && (
				<Form.Item
					label={t('app_setting.submit_text')}
					name={['settings', 'answerForm', 'feedbackText']}
					tooltip={t('app_setting.submit_text_tooltip')}
				>
					<Input placeholder={t('app_setting.submit_text_placeholder')} />
				</Form.Item>
			)}
		</>
	)
}

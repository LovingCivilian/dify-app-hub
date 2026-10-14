'use client'

import { Divider, Form, Input, Select, Switch } from 'antd'
import { useTranslation } from 'react-i18next'

import { drawerPopupContainer } from '@/components/admin/drawer-popup-container'
import ConnectionTest from '@/components/admin/apps/connection-test'

import { validateApiBase } from './api-base-rule'
import { APP_MODE_OPTION_KEYS, APP_MODE_OPTIONS } from './app-types'

/** The connection fields: the test is keyed by their values, so a change clears its result (E7). */
const CONNECTION_FIELDS = [
	['settings', 'apiBase'],
	['secrets', 'apiKey'],
	['settings', 'appType'],
]

/**
 * Dify's sections of the app form (spec §4.1): Connection (API base, API key, app type, Test connection), Conversation
 * (update inputs after the conversation starts; the opening statement's display) and More (form replies and their submit
 * text). The key is write-only (spec §2.3): required on a new app, and on an edit blank by default, which keeps the
 * stored one. The labels are i18n keys now; they were hard-coded English (coupling map §4).
 */
export default function DifyFormSection({ appId, editing }: { appId?: string; editing: boolean }) {
	const { t } = useTranslation()
	const form = Form.useFormInstance()
	const replyOn = Form.useWatch(['settings', 'answerForm', 'enabled'], form)
	const apiBase = Form.useWatch(['settings', 'apiBase'], form)
	const apiKey = Form.useWatch(['secrets', 'apiKey'], form)
	const appType = Form.useWatch(['settings', 'appType'], form)

	return (
		<>
			<Divider titlePlacement="start">{t('app_setting.section_connection')}</Divider>
			<Form.Item
				label={t('app_setting.api_base')}
				name={['settings', 'apiBase']}
				tooltip={t('app_setting.api_base_tooltip')}
				rules={[
					{ required: true, message: t('app_setting.api_base_required') },
					{ validator: validateApiBase(t('app_setting.api_base_invalid')) },
				]}
			>
				<Input placeholder={t('app_setting.api_base_placeholder')} />
			</Form.Item>
			<Form.Item
				label={t('app_setting.api_key')}
				name={['secrets', 'apiKey']}
				tooltip={t('app_setting.api_key_tooltip')}
				rules={editing ? [] : [{ required: true, message: t('app_setting.api_key_required') }]}
			>
				<Input.Password
					autoComplete="new-password"
					placeholder={t(
						editing ? 'app_setting.secret_keep_placeholder' : 'app_setting.api_key_placeholder',
					)}
				/>
			</Form.Item>
			<Form.Item
				label={t('app_setting.type')}
				name={['settings', 'appType']}
				tooltip={t('app_setting.type_tooltip')}
				rules={[{ required: true, message: t('app_setting.type_required') }]}
			>
				<Select
					placeholder={t('app_setting.type_placeholder')}
					getPopupContainer={drawerPopupContainer}
					options={APP_MODE_OPTIONS.map(mode => ({
						value: mode,
						label: t(APP_MODE_OPTION_KEYS[mode]),
					}))}
				/>
			</Form.Item>
			{/*
			 * E7: the last row of Connection, aligned with the fields. Form.Item `label={null}` (since 5.22.0: "When there is
			 * no need for a label but it needs to be aligned with a colon, it can be set to null"; the "basic" demo's submit
			 * row) offsets the control by the Form's own labelCol at each breakpoint (FormItemInput), so the drawer's spans
			 * stay in one place.
			 */}
			<Form.Item label={null}>
				<ConnectionTest
					key={[apiBase, apiKey, appType].join('\n')}
					appId={appId}
					provider="dify"
					fields={CONNECTION_FIELDS}
					chosenType={appType}
				/>
			</Form.Item>

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
					getPopupContainer={drawerPopupContainer}
					options={[
						{ value: 'default', label: t('app_setting.opening_display_default') },
						{ value: 'always', label: t('app_setting.opening_display_always') },
					]}
				/>
			</Form.Item>

			<Divider titlePlacement="start">{t('app_setting.section_more')}</Divider>
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
					rules={[{ max: 255 }]}
				>
					<Input placeholder={t('app_setting.submit_text_placeholder')} />
				</Form.Item>
			)}
		</>
	)
}

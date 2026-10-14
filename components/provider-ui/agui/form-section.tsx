'use client'

import { Divider, Form, Input, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import type * as z from 'zod'

import ConnectionTest from '@/components/admin/apps/connection-test'
import { aguiSecretsSchema, aguiSettingsSchema } from '@/lib/providers/agui/schema'

/** The connection fields: the test is keyed by their values, so a change clears its result (E7). */
const CONNECTION_FIELDS = [
	['settings', 'agentUrl'],
	['settings', 'audience'],
	['secrets', 'jwtSecret'],
]

/**
 * A field's antd Rule `validator` (Form §Rule: "Customize validation rule. Accept Promise as return") from the field's
 * own zod schema (lib/providers/agui/schema.ts), so the browser and the server agree on every value, as Dify's API base
 * rule does. A blank value resolves: the `required` rule words that case, and a blank secret on an edit keeps the stored
 * one (ADR-0032).
 */
const schemaRule = (schema: z.ZodType, message: string) => ({
	validator: (_rule: unknown, value: unknown): Promise<void> =>
		!String(value ?? '').trim() || schema.safeParse(value).success
			? Promise.resolve()
			: Promise.reject(new Error(message)),
})

/**
 * AG-UI's sections of the app form (Part 2 spec §2.1, §2.2): Connection (the agent URL, the JWT audience, the JWT secret,
 * Test connection) and Conversation (the hub's ask_user tool, spec §6.2). The secret is write-only as Dify's key is
 * (ADR-0032): required on a new app, and on an edit blank by default, which keeps the stored one. The server parses the
 * documents again.
 */
export default function AguiFormSection({ appId, editing }: { appId?: string; editing: boolean }) {
	const { t } = useTranslation()
	const form = Form.useFormInstance()
	const agentUrl = Form.useWatch(['settings', 'agentUrl'], form)
	const audience = Form.useWatch(['settings', 'audience'], form)
	const jwtSecret = Form.useWatch(['secrets', 'jwtSecret'], form)

	return (
		<>
			<Divider titlePlacement="start">{t('app_setting.section_connection')}</Divider>
			<Form.Item
				label={t('app_setting.agent_url')}
				name={['settings', 'agentUrl']}
				tooltip={t('app_setting.agent_url_tooltip')}
				rules={[
					{ required: true, whitespace: true, message: t('app_setting.agent_url_required') },
					schemaRule(aguiSettingsSchema.shape.agentUrl, t('app_setting.agent_url_invalid')),
				]}
			>
				<Input placeholder={t('app_setting.agent_url_placeholder')} />
			</Form.Item>
			<Form.Item
				label={t('app_setting.audience')}
				name={['settings', 'audience']}
				tooltip={t('app_setting.audience_tooltip')}
				rules={[
					{ required: true, whitespace: true, message: t('app_setting.audience_required') },
					schemaRule(aguiSettingsSchema.shape.audience, t('app_setting.audience_invalid')),
				]}
			>
				<Input placeholder={t('app_setting.audience_placeholder')} />
			</Form.Item>
			<Form.Item
				label={t('app_setting.jwt_secret')}
				name={['secrets', 'jwtSecret']}
				tooltip={t('app_setting.jwt_secret_tooltip')}
				rules={[
					...(editing ? [] : [{ required: true, message: t('app_setting.jwt_secret_required') }]),
					schemaRule(aguiSecretsSchema.shape.jwtSecret, t('app_setting.jwt_secret_invalid')),
				]}
			>
				<Input.Password
					autoComplete="new-password"
					placeholder={t(
						editing ? 'app_setting.secret_keep_placeholder' : 'app_setting.jwt_secret_placeholder',
					)}
				/>
			</Form.Item>
			{/*
			 * E7: the last row of Connection, aligned with the fields (Form.Item `label={null}`, as Dify's section). AG-UI has
			 * no app type, so the test is given none.
			 */}
			<Form.Item label={null}>
				<ConnectionTest
					key={[agentUrl, audience, jwtSecret].join('\n')}
					appId={appId}
					provider="agui"
					fields={CONNECTION_FIELDS}
				/>
			</Form.Item>

			{/*
			 * 2b's plan call P16: the Dify form's Conversation section and its switch (Form.Item `valuePropName="checked"`:
			 * "the prop of Switch or Checkbox is `checked`", antd 6.6.5 Form). Not a connection field: the test ignores it.
			 */}
			<Divider titlePlacement="start">{t('app_setting.section_conversation')}</Divider>
			<Form.Item
				label={t('app_setting.ask_user')}
				name={['settings', 'askUser']}
				tooltip={t('app_setting.ask_user_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
		</>
	)
}

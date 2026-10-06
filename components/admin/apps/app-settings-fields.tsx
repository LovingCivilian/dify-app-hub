'use client'

import { Descriptions, Divider, Flex, Form, Input, Select, Switch, Tag } from 'antd'
import { useTranslation } from 'react-i18next'

import { AppModeOptions, type IDifyAppItem, OpeningStatementDisplayModeOptions } from '@/lib/core'

import { statusSwitchProps } from './app-form-values'

/** The settings form's fields (spec §5.4); `record` shows the app's Dify info above them when editing. */
export default function AppSettingsFields({ record }: { record?: IDifyAppItem }) {
	const { t } = useTranslation()
	const form = Form.useFormInstance()
	const replyOn = Form.useWatch(['answerForm', 'enabled'], form)

	return (
		<>
			{record && (
				<Descriptions
					column={1}
					size="small"
					items={[
						{ key: 'name', label: t('app_setting.name'), children: record.info.name },
						{
							key: 'description',
							label: t('app_setting.description'),
							children: record.info.description || t('common.none'),
						},
						{
							key: 'tags',
							label: t('app_setting.tags'),
							children: record.info.tags?.length ? (
								<Flex
									wrap
									gap="small"
								>
									{record.info.tags.map(tag => (
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
				name={['requestConfig', 'apiBase']}
				tooltip={t('app_setting.api_base_tooltip')}
				rules={[{ required: true, message: t('app_setting.api_base_required') }]}
			>
				<Input placeholder={t('app_setting.api_base_placeholder')} />
			</Form.Item>
			<Form.Item
				label="API Secret"
				name={['requestConfig', 'apiKey']}
				tooltip={t('app_setting.api_secret_tooltip')}
				rules={[{ required: true, message: t('app_setting.api_secret_required') }]}
			>
				<Input.Password
					autoComplete="new-password"
					placeholder={t('app_setting.api_secret_placeholder')}
				/>
			</Form.Item>

			<Divider titlePlacement="start">{t('app_setting.section_basic')}</Divider>
			<Form.Item
				label={t('app_setting.type')}
				name={['info', 'mode']}
				tooltip={t('app_setting.type_tooltip')}
				rules={[{ required: true, message: t('app_setting.type_required') }]}
			>
				<Select
					placeholder={t('app_setting.type_placeholder')}
					options={AppModeOptions.map(option => ({ value: option.value, label: t(option.label) }))}
				/>
			</Form.Item>
			<Form.Item
				label={t('app_setting.status')}
				name="isEnabled"
				tooltip={t('app_setting.status_tooltip')}
				{...statusSwitchProps}
			>
				<Switch />
			</Form.Item>

			<Divider titlePlacement="start">{t('app_setting.section_conversation')}</Divider>
			<Form.Item
				label={t('app_setting.update_inputs')}
				name={['inputParams', 'enableUpdateAfterCvstStarts']}
				tooltip={t('app_setting.update_inputs_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
			<Form.Item
				label={t('app_setting.opening_display')}
				name={['extConfig', 'conversation', 'openingStatement', 'displayMode']}
				tooltip={t('app_setting.opening_display_tooltip')}
			>
				<Select
					options={OpeningStatementDisplayModeOptions.map(option => ({
						value: option.value,
						label: t(option.label),
					}))}
				/>
			</Form.Item>

			<Divider titlePlacement="start">{t('app_setting.section_more')}</Divider>
			<Form.Item
				label={t('app_setting.allow_annotation')}
				name={['extConfig', 'annotation', 'enabled']}
				tooltip={t('app_setting.allow_annotation_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
			<Form.Item
				label={t('app_setting.form_reply')}
				name={['answerForm', 'enabled']}
				tooltip={t('app_setting.form_reply_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
			{replyOn && (
				<Form.Item
					label={t('app_setting.submit_text')}
					name={['answerForm', 'feedbackText']}
					tooltip={t('app_setting.submit_text_tooltip')}
				>
					<Input placeholder={t('app_setting.submit_text_placeholder')} />
				</Form.Item>
			)}
		</>
	)
}

import { AppModeOptions, OpeningStatementDisplayModeOptions } from '@/lib/core'
import { Form, FormInstance, Input, Select } from 'antd'
import { useTranslation } from 'react-i18next'

import { IDifyAppItem } from '@/types'

import { AppDetailDrawerModeEnum } from '../enums'

interface ISettingFormProps {
	formInstance: FormInstance<Record<string, unknown>>
	mode: AppDetailDrawerModeEnum
	appItem: IDifyAppItem
}

export default function SettingForm(props: ISettingFormProps) {
	const { t } = useTranslation()
	const { formInstance, mode, appItem } = props

	const enableAnswerForm = Form.useWatch('enableAnswerForm', formInstance)

	return (
		<Form
			autoComplete="off"
			form={formInstance}
			labelAlign="left"
			labelCol={{
				span: 5,
			}}
			initialValues={{
				enableAnswerForm: false,
				enableUpdateInputAfterStarts: false,
				openingStatementDisplayMode: 'default',
				isEnabled: 1,
				enableAnnotation: false,
			}}
		>
			<div className="mb-3 flex items-center text-base">
				<div className="h-4 w-1 rounded bg-[#1669ee]"></div>
				<div className="ml-2 font-semibold">{t('app_setting.section_request')}</div>
			</div>

			<Form.Item
				label="API Base"
				name="apiBase"
				rules={[{ required: true, message: t('app_setting.api_base_required') }]}
				tooltip={t('app_setting.api_base_tooltip')}
				required
			>
				<Input
					autoComplete="new-password"
					placeholder={t('app_setting.api_base_placeholder')}
				/>
			</Form.Item>

			<Form.Item
				label="API Secret"
				name="apiKey"
				tooltip={t('app_setting.api_secret_tooltip')}
				rules={[{ required: true, message: t('app_setting.api_secret_required') }]}
				required
			>
				<Input.Password
					autoComplete="new-password"
					placeholder={t('app_setting.api_secret_placeholder')}
				/>
			</Form.Item>

			<div className="mb-3 flex items-center text-base">
				<div className="h-4 w-1 rounded bg-[#1669ee]"></div>
				<div className="ml-2 font-semibold">{t('app_setting.section_basic')}</div>
			</div>
			<Form.Item
				name="info.name"
				label={t('app_setting.name')}
				hidden={mode === AppDetailDrawerModeEnum.create}
			>
				<Input
					disabled
					placeholder={t('app_setting.name_placeholder')}
				/>
			</Form.Item>
			<Form.Item
				name="info.mode"
				label={t('app_setting.type')}
				tooltip={t('app_setting.type_tooltip')}
				required
				rules={[{ required: true, message: t('app_setting.type_required') }]}
			>
				<Select
					// TODO 等 Dify 支持返回 mode 字段后，这里可以做一个判断，大于支持返回 mode 的版本就禁用，直接取接口值
					// disabled
					placeholder={t('app_setting.type_placeholder')}
					options={AppModeOptions.map(item => ({ ...item, label: t(item.label) }))}
				/>
			</Form.Item>
			<Form.Item
				name="info.description"
				label={t('app_setting.description')}
				hidden={mode === AppDetailDrawerModeEnum.create}
			>
				<Input
					disabled
					placeholder={t('app_setting.description_placeholder')}
				/>
			</Form.Item>
			<Form.Item
				name="info.tags"
				label={t('app_setting.tags')}
				hidden={mode === AppDetailDrawerModeEnum.create}
			>
				{appItem?.info.tags?.length ? (
					<div className="text-theme-text">{appItem.info.tags.join(', ')}</div>
				) : (
					<>{t('common.none')}</>
				)}
			</Form.Item>
			<Form.Item
				name="isEnabled"
				label={t('app_setting.status')}
				tooltip={t('app_setting.status_tooltip')}
				rules={[{ required: true, message: t('app_setting.status_required') }]}
				required
			>
				<Select
					placeholder={t('app_setting.status_placeholder')}
					options={[
						{
							label: t('common.enabled'),
							value: 1,
						},
						{
							label: t('common.disabled'),
							value: 2,
						},
					]}
				/>
			</Form.Item>

			<div className="mb-3 flex items-center text-base">
				<div className="h-4 w-1 rounded bg-[#1669ee]"></div>
				<div className="ml-2 font-semibold">{t('app_setting.section_conversation')}</div>
			</div>

			<Form.Item
				label={t('app_setting.update_inputs')}
				name="enableUpdateInputAfterStarts"
				tooltip={t('app_setting.update_inputs_tooltip')}
				rules={[{ required: true }]}
				required
			>
				<Select
					placeholder={t('form.select_placeholder')}
					options={[
						{
							label: t('common.enabled'),
							value: true,
						},
						{
							label: t('common.disabled'),
							value: false,
						},
					]}
				/>
			</Form.Item>

			<Form.Item
				label={t('app_setting.opening_display')}
				name="openingStatementDisplayMode"
				tooltip={t('app_setting.opening_display_tooltip')}
				rules={[{ required: true }]}
				required
			>
				<Select
					placeholder={t('form.select_placeholder')}
					options={OpeningStatementDisplayModeOptions.map(item => ({
						...item,
						label: t(item.label),
					}))}
				/>
			</Form.Item>

			<div className="mb-3 flex items-center text-base">
				<div className="h-4 w-1 rounded bg-[#1669ee]"></div>
				<div className="ml-2 font-semibold">{t('app_setting.section_more')}</div>
			</div>

			<Form.Item
				label={t('app_setting.allow_annotation')}
				name="enableAnnotation"
				tooltip={t('app_setting.allow_annotation_tooltip')}
				rules={[{ required: true }]}
				required
			>
				<Select
					placeholder={t('form.select_placeholder')}
					options={[
						{
							label: t('common.enabled'),
							value: true,
						},
						{
							label: t('common.disabled'),
							value: false,
						},
					]}
				/>
			</Form.Item>

			<Form.Item
				label={t('app_setting.form_reply')}
				name="enableAnswerForm"
				tooltip={t('app_setting.form_reply_tooltip')}
				rules={[{ required: true }]}
				required
			>
				<Select
					placeholder={t('form.select_placeholder')}
					options={[
						{
							label: t('common.enabled'),
							value: true,
						},
						{
							label: t('common.disabled'),
							value: false,
						},
					]}
				/>
			</Form.Item>
			{enableAnswerForm ? (
				<Form.Item
					label={t('app_setting.submit_text')}
					name="answerForm.feedbackText"
					tooltip={t('app_setting.submit_text_tooltip')}
				>
					<Input placeholder={t('app_setting.submit_text_placeholder')} />
				</Form.Item>
			) : null}
		</Form>
	)
}

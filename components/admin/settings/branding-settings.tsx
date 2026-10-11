'use client'

import { DeleteOutlined, UploadOutlined } from '@ant-design/icons'
import {
	Alert,
	App,
	Button,
	Card,
	Descriptions,
	Flex,
	Form,
	Image,
	Input,
	Switch,
	Typography,
	Upload,
	theme,
} from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { saveBrandingAction } from '@/app/(admin)/settings/branding/actions'
import ClientDateTime from '@/components/admin/client-date-time'
import BrandLogo from '@/components/shell/brand-logo'
import PageHeader from '@/components/shell/page-header'
import { useActionTransition } from '@/hooks/use-action-transition'
import type { BrandingSettingsView } from '@/lib/settings/branding'
import {
	BRAND_IMAGE_MAX_BYTES,
	BRAND_IMAGE_MIME_TYPES,
	BRAND_NAME_MAX,
	effectiveShowName,
	type BrandImageKind,
} from '@/lib/settings/branding-rules'

import { brandingErrorKey, imageErrorKey } from './branding-errors'

/** An image's pending change; `url` is the unsaved file's object URL for the preview (File API, URL.createObjectURL). */
type ImageDraft =
	| { intent: 'keep' }
	| { intent: 'remove' }
	| { intent: 'replace'; file: File; url: string }

const KEEP: ImageDraft = { intent: 'keep' }

/** The draft's preview URL: the new file, the saved image, or none. */
const previewOf = (draft: ImageDraft, savedSrc: string | null) =>
	draft.intent === 'replace' ? draft.url : draft.intent === 'keep' ? savedSrc : null

/** Revokes a replaced draft's object URL when it changes or the page unmounts (MDN URL.revokeObjectURL). */
const useRevokeOnChange = (draft: ImageDraft) =>
	useEffect(
		() => () => {
			if (draft.intent === 'replace') URL.revokeObjectURL(draft.url)
		},
		[draft],
	)

function ImageField({
	kind,
	savedSrc,
	draft,
	onChange,
	error,
}: {
	kind: BrandImageKind
	savedSrc: string | null
	draft: ImageDraft
	onChange: (draft: ImageDraft) => void
	error?: string
}) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const src = previewOf(draft, savedSrc)
	return (
		<Form.Item
			label={t(kind === 'logo' ? 'admin_settings.logo' : 'admin_settings.favicon')}
			extra={t(kind === 'logo' ? 'admin_settings.logo_hint' : 'admin_settings.favicon_hint')}
			validateStatus={error ? 'error' : undefined}
			help={error}
		>
			<Flex
				wrap
				align="center"
				gap="small"
			>
				{src && (
					// An unsaved image has no known size, which next/image needs (plan decision e).
					<Image
						src={src}
						height={kind === 'logo' ? 48 : 32}
						preview={false}
						alt=""
					/>
				)}
				<Upload
					accept={BRAND_IMAGE_MIME_TYPES.join(',')}
					showUploadList={false}
					// antd demos "Upload manually" and "Upload png file only": keep the file in the browser (return false)
					// or drop it from the list (Upload.LIST_IGNORE). A convenience only; the server decides (OWASP).
					beforeUpload={file => {
						if (!(BRAND_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
							message.error(t('admin_settings.image_not_allowed'))
							return Upload.LIST_IGNORE
						}
						if (file.size > BRAND_IMAGE_MAX_BYTES[kind]) {
							message.error(t(imageErrorKey(kind, 'too_large')))
							return Upload.LIST_IGNORE
						}
						onChange({ intent: 'replace', file, url: URL.createObjectURL(file) })
						return false
					}}
				>
					<Button icon={<UploadOutlined />}>
						{t(kind === 'logo' ? 'admin_settings.choose_logo' : 'admin_settings.choose_favicon')}
					</Button>
				</Upload>
				{src && (
					<Button
						icon={<DeleteOutlined />}
						onClick={() => onChange({ intent: 'remove' })}
					>
						{t('admin_settings.remove')}
					</Button>
				)}
			</Flex>
		</Form.Item>
	)
}

/** Settings > Branding (settings spec §5.3): the mode first, then the form, the read-only values or the built-in preview. */
export default function BrandingSettings({ settings }: { settings: BrandingSettingsView }) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { message } = App.useApp()
	const [form] = Form.useForm<{ name: string; showName: boolean }>()
	const [logo, setLogo] = useState<ImageDraft>(KEEP)
	const [favicon, setFavicon] = useState<ImageDraft>(KEEP)
	const [errors, setErrors] = useState<Record<string, string[]>>({})
	useRevokeOnChange(logo)
	useRevokeOnChange(favicon)
	const { pending, run } = useActionTransition()

	const savedLogoSrc = settings.hasLogo ? (settings.current.logo?.src ?? null) : null
	const hasLogo = logo.intent === 'replace' || (logo.intent === 'keep' && settings.hasLogo)
	const name = Form.useWatch('name', form) ?? settings.name
	const showName = effectiveShowName(Form.useWatch('showName', form) ?? settings.showName, hasLogo)
	const previewSrc = previewOf(logo, savedLogoSrc)

	// Spec §4.2: the switch cannot hide the name while no logo is left. Only the database mode renders the form.
	useEffect(() => {
		if (settings.mode === 'database' && !hasLogo) form.setFieldValue('showName', true)
	}, [settings.mode, hasLogo, form])

	const submit = (values: { name: string; showName: boolean }) =>
		run(async () => {
			const data = new FormData()
			data.set('name', values.name)
			data.set('showName', String(values.showName))
			for (const [kind, draft] of [
				['logo', logo],
				['favicon', favicon],
			] as const) {
				data.set(`${kind}Intent`, draft.intent)
				if (draft.intent === 'replace') data.set(kind, draft.file)
			}
			const result = await saveBrandingAction(data)
			if (result.ok) {
				setLogo(KEEP)
				setFavicon(KEEP)
				setErrors({})
				message.success(t('admin_settings.save_success'))
				return
			}
			setErrors(result.fieldErrors ?? {})
			message.error(t(brandingErrorKey(result.code)))
		})

	const imageError = (kind: BrandImageKind) => {
		const code = errors[kind]?.[0]
		return code ? t(imageErrorKey(kind, code)) : undefined
	}

	const preview = (
		<Card
			size="small"
			title={t('admin_settings.preview')}
		>
			<Flex
				align="center"
				gap={token.marginSM}
			>
				{/* Database mode previews the draft's image only, never the built-in one (spec §5.3; §2 decision 10). */}
				{settings.mode === 'database'
					? previewSrc && (
							<Image
								src={previewSrc}
								height={28}
								preview={false}
								alt=""
							/>
						)
					: settings.current.logo && (
							<BrandLogo
								image={settings.current.logo}
								height={28}
								alt=""
							/>
						)}
				{(settings.mode === 'database' ? showName : settings.current.showName) && (
					<Typography.Text strong>
						{settings.mode === 'database' ? name : settings.current.name}
					</Typography.Text>
				)}
			</Flex>
		</Card>
	)

	return (
		<Flex
			vertical
			gap={token.marginLG}
		>
			<PageHeader
				title={t('admin_settings.branding_title')}
				subtitle={t('admin_settings.branding_subtitle')}
			/>
			<Alert
				type="info"
				showIcon
				title={t(
					settings.mode === 'disabled'
						? 'admin_settings.mode_disabled'
						: settings.mode === 'env'
							? 'admin_settings.mode_env'
							: 'admin_settings.mode_database',
				)}
			/>
			{preview}
			{settings.mode === 'env' && settings.env && (
				<Descriptions
					bordered
					column={1}
					items={[
						{
							key: 'name',
							label: <Typography.Text code>BRANDING_NAME</Typography.Text>,
							children: settings.name,
						},
						{
							key: 'show',
							label: <Typography.Text code>BRANDING_SHOW_NAME</Typography.Text>,
							children: t(settings.showName ? 'admin_settings.yes' : 'admin_settings.no'),
						},
						...(['logo', 'favicon'] as const).map(kind => {
							const file = kind === 'logo' ? settings.env!.logoFile : settings.env!.faviconFile
							const error = settings.env!.errors[kind]
							return {
								key: kind,
								label: (
									<Typography.Text code>
										{kind === 'logo' ? 'BRANDING_LOGO_FILE' : 'BRANDING_FAVICON_FILE'}
									</Typography.Text>
								),
								children: (
									<Flex
										vertical
										gap="small"
									>
										<span>{file ?? t('admin_settings.not_set')}</span>
										{error && (
											<Typography.Text type="danger">
												{t('admin_settings.file_error', { code: error })}
											</Typography.Text>
										)}
										{kind === 'favicon' && settings.faviconSrc && (
											<Image
												src={settings.faviconSrc}
												height={32}
												preview={false}
												alt=""
											/>
										)}
									</Flex>
								),
							}
						}),
					]}
				/>
			)}
			{settings.mode === 'database' && (
				<Card>
					<Form
						form={form}
						layout="vertical"
						initialValues={{ name: settings.name, showName: settings.showName }}
						onFinish={submit}
					>
						<Form.Item
							name="name"
							label={t('admin_settings.name')}
							rules={[{ required: true, whitespace: true, max: BRAND_NAME_MAX }]}
						>
							<Input
								// antd Input `count` (CountConfig, demo "Custom count logic"): counts code points as zod and the form
								// rule do (MDN String `[Symbol.iterator]()`: "yields the Unicode code points"); the native `maxlength`
								// would not (MDN `maxlength`: "The length is measured in UTF-16 code units").
								count={{
									show: true,
									max: BRAND_NAME_MAX,
									strategy: text => Array.from(text).length,
								}}
							/>
						</Form.Item>
						<Form.Item
							name="showName"
							label={t('admin_settings.show_name')}
							valuePropName="checked"
							extra={hasLogo ? undefined : t('admin_settings.show_name_locked')}
							validateStatus={errors.showName ? 'error' : undefined}
							help={errors.showName ? t('admin_settings.logo_required') : undefined}
						>
							<Switch disabled={!hasLogo} />
						</Form.Item>
						<ImageField
							kind="logo"
							savedSrc={savedLogoSrc}
							draft={logo}
							onChange={setLogo}
							error={imageError('logo')}
						/>
						<ImageField
							kind="favicon"
							savedSrc={settings.faviconSrc}
							draft={favicon}
							onChange={setFavicon}
							error={imageError('favicon')}
						/>
						<Flex
							wrap
							align="center"
							justify="space-between"
							gap="small"
						>
							<Typography.Text type="secondary">
								{settings.updatedAt ? (
									<>
										{settings.updatedByEmail
											? t('admin_settings.last_changed', { email: settings.updatedByEmail })
											: t('admin_settings.last_changed_unknown')}{' '}
										<ClientDateTime value={settings.updatedAt} />
									</>
								) : (
									t('admin_settings.never_saved')
								)}
							</Typography.Text>
							<Button
								type="primary"
								htmlType="submit"
								loading={pending}
							>
								{t('admin_settings.save')}
							</Button>
						</Flex>
					</Form>
				</Card>
			)}
		</Flex>
	)
}

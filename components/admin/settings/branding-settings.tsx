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
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { saveBrandingAction } from '@/app/(admin)/settings/branding/actions'
import ClientDateTime from '@/components/admin/client-date-time'
import BrandLogo from '@/components/shell/brand-logo'
import PageHeader from '@/components/shell/page-header'
import { useActionTransition } from '@/hooks/use-action-transition'
import type { BrandingSettingsView } from '@/lib/settings/branding'
import {
	BRAND_IMAGE_MAX_BYTES,
	BRAND_NAME_MAX,
	effectiveShowName,
	type BrandImageKind,
} from '@/lib/settings/branding-rules'
import { IMAGE_MIME_TYPES } from '@/lib/settings/image-rules'

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
	const label = t(kind === 'logo' ? 'admin_settings.logo' : 'admin_settings.favicon')
	// react.dev `useId`: "generating unique IDs that can be passed to accessibility attributes".
	const labelId = useId()
	return (
		<Form.Item
			// The label names the field's group of controls, not one control: pointed at the Choose button (`htmlFor`), it
			// would become that button's name, "Logo" for "Choose logo" (HTML-AAM §4.1.4: the associated label comes before
			// the button's own text), which WCAG 2.2 SC 2.5.3 Label in Name rules out.
			label={<span id={labelId}>{label}</span>}
			extra={t(kind === 'logo' ? 'admin_settings.logo_hint' : 'admin_settings.favicon_hint')}
			validateStatus={error ? 'error' : undefined}
			help={error}
		>
			<Flex
				// W3C WAI Forms Tutorial, "Grouping Controls": `role=group` marks the preview, Choose and Remove as one group,
				// and `aria-labelledby` names it by the visible label (WAI-ARIA 1.2 `group` role); each button keeps its name.
				role="group"
				aria-labelledby={labelId}
				wrap
				align="center"
				gap="small"
			>
				{src && (
					// An unsaved image has no known size, which next/image needs (plan decision e). The image is what will be
					// saved, so it carries meaning: a short text alternative naming it (W3C WAI Images Tutorial, "Informative
					// images" and the alt decision tree).
					<Image
						src={src}
						height={kind === 'logo' ? 48 : 32}
						preview={false}
						alt={label}
					/>
				)}
				<Upload
					accept={IMAGE_MIME_TYPES.join(',')}
					showUploadList={false}
					// antd demos "Upload manually" and "Upload png file only": keep the file in the browser (return false)
					// or drop it from the list (Upload.LIST_IGNORE). A convenience only; the server decides (OWASP).
					beforeUpload={file => {
						if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
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

	/*
	 * Drops the server's errors on the fields the admin has changed since. They live in this state and reach the fields
	 * through `help`, which no validation replaces (the image items have no `name` or `rules`, and @rc-component/form
	 * validates only fields with rules; the groups drawer clears its picker's server error on change the same way), so a
	 * refusal would otherwise outlive the value it was about. The same state back skips the re-render (react.dev
	 * `useState`: "If the new value you provide is identical to the current state … React will skip re-rendering").
	 */
	const clearErrors = (fields: string[]) =>
		setErrors(previous =>
			fields.some(field => field in previous)
				? Object.fromEntries(Object.entries(previous).filter(([field]) => !fields.includes(field)))
				: previous,
		)

	const savedLogoSrc = settings.hasLogo ? (settings.current.logo?.src ?? null) : null
	const hasLogo = logo.intent === 'replace' || (logo.intent === 'keep' && settings.hasLogo)
	const name = Form.useWatch('name', form) ?? settings.name
	const showName = effectiveShowName(Form.useWatch('showName', form) ?? settings.showName, hasLogo)
	const previewSrc = previewOf(logo, savedLogoSrc)
	// A const binding keeps its narrowing inside the Descriptions items' callback, which `settings.env` would lose
	// (TypeScript 5.4 release notes: narrowing is dropped in a callback when the value may be "mutated elsewhere").
	const env = settings.mode === 'env' ? settings.env : null

	/*
	 * Spec §4.2: the switch cannot hide the name while no logo is left. Only database mode renders the `<Form>`; in the
	 * other modes the guard keeps the write out of a form store that nothing renders. (It is not about rc-field-form's
	 * "not connected" warning, which cannot fire here: the `Form.useWatch` calls above mark the store connected during
	 * render, @rc-component/form useWatch.js → useForm.js `getInternalHooks`.)
	 */
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
				{/*
				 * Database mode previews the draft's image only, never the built-in one (spec §5.3; §2 decision 10). The image
				 * is the logo the header will draw, so its alternative names it (W3C WAI Images Tutorial, "Informative images").
				 */}
				{settings.mode === 'database'
					? previewSrc && (
							<Image
								src={previewSrc}
								height={28}
								preview={false}
								alt={t('admin_settings.logo')}
							/>
						)
					: settings.current.logo && (
							<BrandLogo
								image={settings.current.logo}
								height={28}
								alt={t('admin_settings.logo')}
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
			{env && (
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
							const file = kind === 'logo' ? env.logoFile : env.faviconFile
							const error = env.errors[kind]
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
												alt={t('admin_settings.favicon')}
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
						// A server error on the name or the switch is about the value sent; it goes once the admin changes it.
						onValuesChange={changed => clearErrors(Object.keys(changed))}
					>
						<Form.Item
							name="name"
							label={t('admin_settings.name')}
							// antd Form rules `message`, as the house's forms (components/admin/groups/group-form-drawer.tsx).
							rules={[
								{ required: true, whitespace: true, message: t('admin_settings.name_required') },
								// The length in code points, as zod and the counter below count it (MDN String `[Symbol.iterator]()`:
								// "yields the Unicode code points"), stated through a `validator` (antd Form Rule `validator`, demo
								// "Registration"). Not the `max` rule: async-validator documents it against `length` (its README,
								// "Range"), which counts UTF-16 code units (MDN `String.length`), although 6.0.0 counts a surrogate
								// pair once (lib/rule/range.js); the count should not rest on that.
								{
									validator: (_, value: string | undefined) =>
										Array.from(value ?? '').length > BRAND_NAME_MAX
											? Promise.reject(new Error(t('admin_settings.name_too_long')))
											: Promise.resolve(),
								},
							]}
							// The server's own refusal (zod: trimmed, 1–64 code points), shown on the field the toast points to;
							// its message is the server's, so the field names the rule instead (charter §4.5).
							validateStatus={errors.name ? 'error' : undefined}
							help={errors.name ? t('admin_settings.name_invalid') : undefined}
						>
							<Input
								// antd Input `count` (CountConfig, demo "Custom count logic"): counts code points as zod and the form's
								// `validator` rule above do (MDN String `[Symbol.iterator]()`: "yields the Unicode code points"); the
								// native `maxlength` would not (MDN `maxlength`: "The length is measured in UTF-16 code units").
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
							onChange={draft => {
								setLogo(draft)
								clearErrors(['logo'])
							}}
							error={imageError('logo')}
						/>
						<ImageField
							kind="favicon"
							savedSrc={settings.faviconSrc}
							draft={favicon}
							onChange={draft => {
								setFavicon(draft)
								clearErrors(['favicon'])
							}}
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

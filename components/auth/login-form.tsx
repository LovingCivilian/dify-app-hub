'use client'

import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, App, Button, Form, Input, Tabs, theme, Typography } from 'antd'
import { getSession, signIn } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSafeCallbackUrl } from '@/lib/access'

import { loginFailureKey } from './auth-failure'
import styles from './login-form.module.css'

type Mode = 'directory' | 'local'

/** The submit flow both tabs share: `signIn` without redirect, then the safe callback (spec §7.2 of sub-project 3). */
function useSignIn(callbackUrl: string | undefined) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const router = useRouter()
	const [loading, setLoading] = useState(false)
	const submit = async (mode: Mode, values: Record<string, string>) => {
		setLoading(true)
		try {
			const result = await signIn(mode === 'directory' ? 'ldap' : 'credentials', {
				...values,
				redirect: false,
			})
			if (result?.error) {
				message.error(t(loginFailureKey(result.error, mode)))
				return
			}
			message.success(t('auth.login_success'))
			if (await getSession()) router.push(getSafeCallbackUrl(callbackUrl))
		} catch (error) {
			console.error('Error during login', error)
			message.error(t('auth.login_error'))
		} finally {
			setLoading(false)
		}
	}
	return { loading, submit }
}

function DirectoryForm({
	loading,
	onSubmit,
}: {
	loading: boolean
	onSubmit: (values: Record<string, string>) => void
}) {
	const { t } = useTranslation()
	return (
		<Form
			name="login-directory"
			layout="vertical"
			size="large"
			autoComplete="off"
			onFinish={onSubmit}
		>
			<Form.Item
				name="username"
				label={t('auth.username')}
				rules={[{ required: true, whitespace: true, message: t('auth.username_required') }]}
			>
				<Input
					prefix={<UserOutlined />}
					placeholder={t('auth.username_placeholder')}
					autoComplete="username"
				/>
			</Form.Item>
			<Form.Item
				name="password"
				label={t('auth.password')}
				rules={[{ required: true, message: t('auth.password_required') }]}
			>
				<Input.Password
					prefix={<LockOutlined />}
					placeholder={t('auth.password')}
					autoComplete="current-password"
				/>
			</Form.Item>
			<Form.Item>
				<Button
					type="primary"
					htmlType="submit"
					block
					loading={loading}
				>
					{t('auth.login')}
				</Button>
			</Form.Item>
		</Form>
	)
}

function LocalForm({
	email,
	loading,
	mailConfigured,
	onSubmit,
}: {
	email?: string
	loading: boolean
	mailConfigured: boolean
	onSubmit: (values: Record<string, string>) => void
}) {
	const { t } = useTranslation()
	return (
		<Form
			name="login"
			layout="vertical"
			size="large"
			autoComplete="off"
			initialValues={email ? { email } : undefined}
			onFinish={onSubmit}
		>
			<Form.Item
				name="email"
				label={t('auth.email')}
				rules={[
					{ required: true, message: t('auth.email_required') },
					{ type: 'email', message: t('auth.email_invalid') },
				]}
			>
				<Input
					prefix={<MailOutlined />}
					placeholder={t('auth.email_placeholder')}
				/>
			</Form.Item>
			<Form.Item
				name="password"
				label={t('auth.password')}
				rules={[{ required: true, message: t('auth.password_required') }]}
			>
				<Input.Password
					prefix={<LockOutlined />}
					placeholder={t('auth.password')}
				/>
			</Form.Item>
			<Form.Item>
				<Button
					type="primary"
					htmlType="submit"
					block
					loading={loading}
				>
					{t('auth.login')}
				</Button>
			</Form.Item>
			{mailConfigured && (
				<div className={styles.forgot}>
					<Link href="/forgot-password">{t('auth.forgot_password_link')}</Link>
				</div>
			)}
		</Form>
	)
}

/**
 * The login page's form (spec §6.3). With the directory configured: antd `Tabs centered`, "Directory account" first
 * (decision x), each tab its own form in its own pane (decision y), posting to the `ldap` or the `credentials`
 * provider. Without it: the local form alone, as before. A password change lands here with a notice (charter §4.2);
 * the "Forgot password?" link shows on the local form only when mail is configured (ADR-0024).
 */
export default function LoginForm({
	callbackUrl,
	email,
	notice,
	mailConfigured,
	directoryEnabled,
}: {
	callbackUrl?: string
	email?: string
	notice?: 'password-changed'
	mailConfigured: boolean
	directoryEnabled: boolean
}) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { loading, submit } = useSignIn(callbackUrl)
	const [mode, setMode] = useState<Mode>(
		directoryEnabled && !email && !notice ? 'directory' : 'local',
	)
	const local = (
		<LocalForm
			email={email}
			loading={loading}
			mailConfigured={mailConfigured}
			onSubmit={values => void submit('local', values)}
		/>
	)

	return (
		<>
			{notice === 'password-changed' && (
				<Alert
					type="success"
					showIcon
					title={t('account.password_changed')}
					style={{ marginBottom: token.marginLG }}
				/>
			)}
			<Typography.Paragraph
				className={styles.subtitle}
				style={{ marginBottom: token.marginLG }}
			>
				{t('auth.login_subtitle')}
			</Typography.Paragraph>
			{directoryEnabled ? (
				<Tabs
					centered
					activeKey={mode}
					onChange={key => setMode(key as Mode)}
					destroyOnHidden
					items={[
						{
							key: 'directory',
							label: t('auth.directory_account'),
							children: (
								<DirectoryForm
									loading={loading}
									onSubmit={values => void submit('directory', values)}
								/>
							),
						},
						{ key: 'local', label: t('auth.local_account'), children: local },
					]}
				/>
			) : (
				local
			)}
		</>
	)
}

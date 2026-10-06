'use client'

import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { App, Button, Form, Input, theme, Typography } from 'antd'
import { getSession, signIn } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSafeCallbackUrl } from '@/lib/access'

import styles from './login-form.module.css'

interface LoginValues {
	email: string
	password: string
}

/** Spec §7.2: labels on, placeholders and the flow kept (`signIn` without redirect, then the safe callback). */
export default function LoginForm({
	callbackUrl,
	email,
}: {
	callbackUrl?: string
	email?: string
}) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { token } = theme.useToken()
	const router = useRouter()
	const [loading, setLoading] = useState(false)

	const login = async (values: LoginValues) => {
		setLoading(true)
		try {
			const result = await signIn('credentials', { ...values, redirect: false })
			if (result?.error) {
				message.error(t('auth.login_failed'))
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

	return (
		<>
			<Typography.Paragraph
				className={styles.subtitle}
				style={{ marginBottom: token.marginLG }}
			>
				{t('auth.login_subtitle')}
			</Typography.Paragraph>
			<Form
				name="login"
				layout="vertical"
				size="large"
				autoComplete="off"
				initialValues={email ? { email } : undefined}
				onFinish={login}
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
						prefix={<UserOutlined />}
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
				<div className={styles.forgot}>
					<Link href="/forgot-password">{t('auth.forgot_password_link')}</Link>
				</div>
			</Form>
		</>
	)
}

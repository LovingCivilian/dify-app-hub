'use client'

import { Alert, App, Button, Form, Input, theme, Typography } from 'antd'
import Link from 'next/link'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Spec §7.3: the server page already knows whether mail is configured, so there is no form-then-warning flash. */
export default function ForgotPasswordForm({ mailConfigured }: { mailConfigured: boolean }) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { token } = theme.useToken()
	const [loading, setLoading] = useState(false)
	const [sent, setSent] = useState(false)

	const send = async ({ email }: { email: string }) => {
		setLoading(true)
		try {
			const response = await fetch('/api/auth/forgot-password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email }),
			})
			if (!response.ok) {
				message.error(t('common.request_failed_retry'))
				return
			}
			setSent(true)
		} catch {
			message.error(t('common.request_failed_retry'))
		} finally {
			setLoading(false)
		}
	}

	const backToLogin = (
		<Link href="/login">
			<Button block>{t('auth.back_to_login')}</Button>
		</Link>
	)

	if (!mailConfigured) {
		return (
			<>
				<Alert
					type="warning"
					showIcon
					title={t('auth.mail_not_configured')}
					style={{ marginBottom: token.marginLG }}
				/>
				{backToLogin}
			</>
		)
	}
	if (sent) {
		return (
			<>
				<Typography.Paragraph>{t('auth.reset_link_sent')}</Typography.Paragraph>
				{backToLogin}
			</>
		)
	}
	return (
		<Form
			layout="vertical"
			size="large"
			onFinish={send}
		>
			<Typography.Title level={4}>{t('auth.forgot_title')}</Typography.Title>
			<Form.Item
				name="email"
				label={t('auth.email')}
				rules={[
					{ required: true, message: t('auth.email_required') },
					{ type: 'email', message: t('auth.email_invalid') },
				]}
			>
				<Input placeholder={t('auth.email_placeholder')} />
			</Form.Item>
			<Button
				type="primary"
				htmlType="submit"
				block
				loading={loading}
			>
				{t('auth.send_reset_link')}
			</Button>
		</Form>
	)
}

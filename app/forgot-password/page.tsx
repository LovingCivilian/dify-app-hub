'use client'

import { Alert, Button, Card, Form, Input, message } from 'antd'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function ForgotPasswordPage() {
	const { t } = useTranslation()
	const router = useRouter()
	const [loading, setLoading] = useState(false)
	const [sent, setSent] = useState(false)
	const [mailConfigured, setMailConfigured] = useState<boolean | null>(null)

	useEffect(() => {
		fetch('/api/auth/forgot-password', { cache: 'no-store' })
			.then(response => response.json())
			.then(data => setMailConfigured(data.configured === true))
			.catch(() => setMailConfigured(false))
	}, [])

	const onFinish = async ({ email }: { email: string }) => {
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

	return (
		<div className="bg-theme-bg flex min-h-screen items-center justify-center">
			<Card className="w-full max-w-md dark:bg-gray-700">
				<h1 className="mb-2 text-2xl font-bold">{t('auth.forgot_title')}</h1>
				{mailConfigured === false ? (
					<Alert
						className="mb-4"
						message={t('auth.mail_not_configured')}
						type="warning"
					/>
				) : null}
				{mailConfigured === false ? null : sent ? (
					<>
						<p className="mb-6">{t('auth.reset_link_sent')}</p>
						<Button
							block
							onClick={() => router.replace('/login')}
						>
							{t('auth.back_to_login')}
						</Button>
					</>
				) : (
					<Form
						onFinish={onFinish}
						layout="vertical"
						size="large"
					>
						<Form.Item
							label={t('auth.email')}
							name="email"
							rules={[{ required: true }, { type: 'email', message: t('auth.email_invalid') }]}
						>
							<Input placeholder={t('auth.email_placeholder')} />
						</Form.Item>
						<Button
							type="primary"
							htmlType="submit"
							loading={loading}
							block
						>
							{t('auth.send_reset_link')}
						</Button>
					</Form>
				)}
			</Card>
		</div>
	)
}

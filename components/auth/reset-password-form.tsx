'use client'

import { App, Button, Form, Input, Result, theme, Typography } from 'antd'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { resetFailureKey } from './auth-failure'

const PASSWORD_MIN = 8

interface ResetValues {
	password: string
	confirmPassword: string
}

/** Spec §7.4: no token → the invalid-link Result; otherwise the form; 400 → "invalid or expired" with a way out. */
export default function ResetPasswordForm({ token }: { token?: string }) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { token: designToken } = theme.useToken()
	const router = useRouter()
	const [loading, setLoading] = useState(false)
	const [expired, setExpired] = useState(false)

	if (!token) {
		return (
			<Result
				status="error"
				title={t('auth.reset_link_invalid')}
				extra={
					<Button
						type="primary"
						href="/login"
					>
						{t('auth.back_to_login')}
					</Button>
				}
			/>
		)
	}

	const reset = async (values: ResetValues) => {
		setLoading(true)
		try {
			const response = await fetch('/api/auth/reset-password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token, ...values }),
			})
			if (!response.ok) {
				if (response.status === 400) setExpired(true)
				message.error(t(resetFailureKey(response.status)))
				return
			}
			message.success(t('auth.reset_success'))
			router.replace('/login')
		} catch {
			message.error(t('auth.reset_failed_retry'))
		} finally {
			setLoading(false)
		}
	}

	return (
		<Form
			layout="vertical"
			size="large"
			onFinish={reset}
		>
			<Typography.Title level={4}>{t('auth.reset_title')}</Typography.Title>
			<Form.Item
				name="password"
				label={t('auth.new_password')}
				rules={[
					{ required: true, message: t('auth.password_required') },
					{ min: PASSWORD_MIN, message: t('auth.password_min_8') },
				]}
			>
				<Input.Password autoComplete="new-password" />
			</Form.Item>
			<Form.Item
				name="confirmPassword"
				label={t('auth.confirm_password')}
				dependencies={['password']}
				rules={[
					{ required: true, message: t('auth.password_required') },
					({ getFieldValue }) => ({
						validator: (_, value) =>
							value === getFieldValue('password')
								? Promise.resolve()
								: Promise.reject(new Error(t('auth.password_mismatch'))),
					}),
				]}
			>
				<Input.Password autoComplete="new-password" />
			</Form.Item>
			<Button
				type="primary"
				htmlType="submit"
				block
				loading={loading}
			>
				{t('auth.reset_password')}
			</Button>
			{expired && (
				<Typography.Paragraph style={{ marginTop: designToken.margin }}>
					<Link href="/forgot-password">{t('auth.request_new_link')}</Link>
				</Typography.Paragraph>
			)}
		</Form>
	)
}

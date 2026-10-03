'use client'

import { Button, Card, Form, Input, message, Result } from 'antd'
import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

function ResetPasswordContent() {
	const { t } = useTranslation()
	const token = useSearchParams().get('token') || ''
	const router = useRouter()
	const [loading, setLoading] = useState(false)

	const onFinish = async (values: { password: string; confirmPassword: string }) => {
		setLoading(true)
		try {
			const response = await fetch('/api/auth/reset-password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token, ...values }),
			})
			const data = await response.json()
			if (!response.ok) return message.error(data.message || t('auth.reset_failed'))
			message.success(t('auth.reset_success'))
			router.replace('/login')
		} catch {
			message.error(t('auth.reset_failed_retry'))
		} finally {
			setLoading(false)
		}
	}

	if (!token)
		return (
			<Result
				status="error"
				title={t('auth.reset_link_invalid')}
			/>
		)

	return (
		<div className="bg-theme-bg flex min-h-screen items-center justify-center">
			<Card className="w-full max-w-md dark:bg-gray-700">
				<h1 className="mb-6 text-2xl font-bold">{t('auth.reset_title')}</h1>
				<Form
					onFinish={onFinish}
					layout="vertical"
					size="large"
				>
					<Form.Item
						label={t('auth.new_password')}
						name="password"
						rules={[{ required: true }, { min: 8, message: t('auth.password_min_8') }]}
					>
						<Input.Password />
					</Form.Item>
					<Form.Item
						label={t('auth.confirm_password')}
						name="confirmPassword"
						rules={[
							{ required: true },
							({ getFieldValue }) => ({
								validator: (_, value) =>
									value === getFieldValue('password')
										? Promise.resolve()
										: Promise.reject(new Error(t('auth.password_mismatch'))),
							}),
						]}
					>
						<Input.Password />
					</Form.Item>
					<Button
						type="primary"
						htmlType="submit"
						loading={loading}
						block
					>
						{t('auth.reset_password')}
					</Button>
				</Form>
			</Card>
		</div>
	)
}

export default function ResetPasswordPage() {
	return (
		<Suspense fallback={null}>
			<ResetPasswordContent />
		</Suspense>
	)
}

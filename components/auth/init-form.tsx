'use client'

import { Alert, App, Button, Form, Input, theme, Typography } from 'antd'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { initFailureKey } from './auth-failure'

const PASSWORD_MIN = 8

interface InitValues {
	name: string
	email: string
	password: string
	confirmPassword: string
}

/** Spec §7.5: first-run setup; the match check runs while typing (dependencies), not on submit. */
export default function InitForm() {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { token } = theme.useToken()
	const router = useRouter()
	const [loading, setLoading] = useState(false)

	const create = async ({ name, email, password }: InitValues) => {
		setLoading(true)
		try {
			const response = await fetch('/api/init', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, email, password }),
			})
			if (response.ok) {
				message.success(t('init.admin_created'))
				router.replace(`/login?email=${encodeURIComponent(email)}`)
				return
			}
			message.error(t(initFailureKey(response.status)))
			if (response.status === 400) router.replace('/login')
		} catch (error) {
			console.error('Init failed', error)
			message.error(t('common.network_error_retry'))
		} finally {
			setLoading(false)
		}
	}

	return (
		<>
			<Typography.Title level={4}>{t('init.title')}</Typography.Title>
			<Typography.Paragraph>{t('init.description')}</Typography.Paragraph>
			<Alert
				type="info"
				showIcon
				title={t('init.not_initialized')}
				style={{ marginBottom: token.marginLG }}
			/>
			<Form
				layout="vertical"
				onFinish={create}
			>
				<Form.Item
					name="name"
					label={t('init.admin_name')}
					rules={[{ required: true, message: t('init.admin_name_required') }]}
				>
					<Input placeholder={t('init.admin_name_placeholder')} />
				</Form.Item>
				<Form.Item
					name="email"
					label={t('init.admin_email')}
					rules={[
						{ required: true, message: t('init.admin_email_required') },
						{ type: 'email', message: t('init.email_invalid') },
					]}
				>
					<Input placeholder={t('init.admin_email_placeholder')} />
				</Form.Item>
				<Form.Item
					name="password"
					label={t('init.admin_password')}
					rules={[
						{ required: true, message: t('auth.password_required') },
						{ min: PASSWORD_MIN, message: t('init.password_min_8') },
					]}
				>
					<Input.Password
						autoComplete="new-password"
						placeholder={t('init.password_placeholder')}
					/>
				</Form.Item>
				<Form.Item
					name="confirmPassword"
					label={t('auth.confirm_password')}
					dependencies={['password']}
					rules={[
						{ required: true, message: t('init.confirm_password_required') },
						({ getFieldValue }) => ({
							validator: (_, value) =>
								value === getFieldValue('password')
									? Promise.resolve()
									: Promise.reject(new Error(t('auth.password_mismatch'))),
						}),
					]}
				>
					<Input.Password
						autoComplete="new-password"
						placeholder={t('init.confirm_password_placeholder')}
					/>
				</Form.Item>
				<Button
					type="primary"
					htmlType="submit"
					block
					loading={loading}
				>
					{t('init.submit')}
				</Button>
			</Form>
		</>
	)
}

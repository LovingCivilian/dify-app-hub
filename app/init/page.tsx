'use client'

import { Alert, Button, Form, Input, message, Typography } from 'antd'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AuthCard from '@/components/shell/auth-card'

export default function InitPage() {
	const { t } = useTranslation()
	const router = useRouter()
	const [loading, setLoading] = useState(false)
	const [initialized, setInitialized] = useState<boolean | null>(null)

	useEffect(() => {
		const checkStatus = async () => {
			try {
				const res = await fetch('/api/init/status', { cache: 'no-store' })
				const data = await res.json()
				setInitialized(!!data.initialized)
				if (data.initialized) {
					message.info(t('init.already_initialized'))
					router.replace('/login')
				}
			} catch (e) {
				console.error('Failed to check init status:', e)
				message.error(t('init.status_check_failed'))
			}
		}
		checkStatus()
	}, [router])

	const onFinish = async (values: {
		name: string
		email: string
		password: string
		confirmPassword: string
	}) => {
		if (values.password !== values.confirmPassword) {
			message.warning(t('init.password_mismatch'))
			return
		}

		setLoading(true)
		try {
			const res = await fetch('/api/init', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: values.name, email: values.email, password: values.password }),
			})
			if (res.ok) {
				message.success(t('init.admin_created'))
				router.replace(`/login?email=${encodeURIComponent(values.email)}`)
			} else {
				const data = await res.json().catch(() => ({ message: t('init.failed') }))
				message.error(data.message || t('init.failed'))
			}
		} catch (error) {
			console.error('Init failed:', error)
			message.error(t('common.network_error_retry'))
		} finally {
			setLoading(false)
		}
	}

	return (
		<AuthCard>
			<Typography.Title level={3}>{t('init.title')}</Typography.Title>
			<Typography.Paragraph>{t('init.description')}</Typography.Paragraph>

			{initialized === false && (
				<Alert
					type="info"
					showIcon
					message={t('init.not_initialized')}
					className="mb-4"
				/>
			)}

			<Form
				layout="vertical"
				onFinish={onFinish}
			>
				<Form.Item
					label={t('init.admin_name')}
					name="name"
					rules={[{ required: true, message: t('init.admin_name_required') }]}
				>
					<Input placeholder={t('init.admin_name_placeholder')} />
				</Form.Item>
				<Form.Item
					label={t('init.admin_email')}
					name="email"
					rules={[
						{ required: true, message: t('init.admin_email_required') },
						{ type: 'email', message: t('init.email_invalid') },
					]}
				>
					<Input placeholder={t('init.admin_email_placeholder')} />
				</Form.Item>
				<Form.Item
					label={t('init.admin_password')}
					name="password"
					rules={[
						{ required: true, message: t('auth.password_required') },
						{ min: 8, message: t('init.password_min_8') },
					]}
				>
					<Input.Password placeholder={t('init.password_placeholder')} />
				</Form.Item>
				<Form.Item
					label={t('auth.confirm_password')}
					name="confirmPassword"
					rules={[{ required: true, message: t('init.confirm_password_required') }]}
				>
					<Input.Password placeholder={t('init.confirm_password_placeholder')} />
				</Form.Item>
				<Form.Item>
					<Button
						type="primary"
						htmlType="submit"
						block
						loading={loading}
					>
						{t('init.submit')}
					</Button>
				</Form.Item>
			</Form>
		</AuthCard>
	)
}

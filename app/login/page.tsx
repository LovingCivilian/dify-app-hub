'use client'

import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Button, Card, Form, Input, message } from 'antd'
import { getSession, signIn } from 'next-auth/react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import LogoIcon from '@/assets/images/logo.png'
import { getSafeCallbackUrl } from '@/lib/access'

interface LoginForm {
	email: string
	password: string
}

export default function LoginPage() {
	const { t } = useTranslation()
	const [loading, setLoading] = useState(false)
	const router = useRouter()
	const searchParams = useSearchParams()
	const initEmail = searchParams.get('email') || ''

	const onFinish = async (values: LoginForm) => {
		setLoading(true)
		try {
			const result = await signIn('credentials', {
				email: values.email,
				password: values.password,
				redirect: false,
			})

			if (result?.error) {
				message.error(t('auth.login_failed'))
			} else {
				message.success(t('auth.login_success'))
				// 获取会话信息并跳转
				const session = await getSession()
				if (session) {
					router.push(getSafeCallbackUrl(searchParams.get('callbackUrl')))
				}
			}
		} catch (error) {
			console.error('Error during login', error)
			message.error(t('auth.login_error'))
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className="bg-theme-bg flex min-h-screen items-center justify-center">
			<Card className="w-full max-w-md dark:bg-gray-700">
				<div className="mb-8 text-center">
					<div className="mb-4 flex justify-center">
						<Image
							src={LogoIcon}
							width={64}
							height={64}
							alt="Dify App Hub Platform"
						/>
					</div>
					<h1 className="text-2xl font-bold">Dify App Hub Platform</h1>
					<p className="mt-2">{t('auth.login_subtitle')}</p>
				</div>

				<Form
					name="login"
					onFinish={onFinish}
					autoComplete="off"
					size="large"
					initialValues={initEmail ? { email: initEmail } : undefined}
				>
					<Form.Item
						name="email"
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
							className="w-full"
							loading={loading}
						>
							{t('auth.login')}
						</Button>
					</Form.Item>
					<div className="mb-2 text-right">
						<a href="/forgot-password">{t('auth.forgot_password_link')}</a>
					</div>
				</Form>
			</Card>
		</div>
	)
}

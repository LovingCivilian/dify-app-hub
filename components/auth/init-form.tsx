'use client'

import { Alert, App, Button, Form, Input, theme, Typography } from 'antd'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'

import { createOwnerAction } from '@/app/init/actions'
import { useActionTransition } from '@/hooks/use-action-transition'
import { emailRule, PASSWORD_MIN, passwordBytesRule } from '@/lib/auth/fields'

import { initFailureKey } from './auth-failure'

interface InitValues {
	name: string
	email: string
	password: string
	confirmPassword: string
}

/**
 * Spec §7.5: first-run setup; the match check runs while typing (dependencies), not on submit. The Server Action
 * runs through startTransition from onFinish (ADR-0024).
 */
export default function InitForm() {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { token } = theme.useToken()
	const router = useRouter()
	const { pending, run } = useActionTransition()

	const create = ({ name, email, password }: InitValues) =>
		void run(async () => {
			const result = await createOwnerAction({ name, email, password })
			if (result.ok) {
				message.success(t('init.owner_created'))
				router.replace(`/login?email=${encodeURIComponent(email)}`)
				return
			}
			message.error(t(initFailureKey(result.code)))
			if (result.code === 'forbidden') router.replace('/login')
		})

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
					label={t('init.owner_name')}
					rules={[{ required: true, whitespace: true, message: t('init.owner_name_required') }]}
				>
					<Input placeholder={t('init.owner_name_placeholder')} />
				</Form.Item>
				<Form.Item
					name="email"
					label={t('init.owner_email')}
					rules={[
						{ required: true, message: t('init.owner_email_required') },
						emailRule(t('init.email_invalid')),
					]}
				>
					<Input placeholder={t('init.owner_email_placeholder')} />
				</Form.Item>
				<Form.Item
					name="password"
					label={t('init.owner_password')}
					rules={[
						{ required: true, message: t('auth.password_required') },
						{ min: PASSWORD_MIN, message: t('init.password_min_8') },
						passwordBytesRule(t('auth.password_too_long')),
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
							// An empty field shows only the required message (antd Form "register" demo).
							validator: (_, value) =>
								!value || value === getFieldValue('password')
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
					loading={pending}
				>
					{t('init.submit')}
				</Button>
			</Form>
		</>
	)
}

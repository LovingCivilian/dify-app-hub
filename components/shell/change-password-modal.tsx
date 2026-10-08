'use client'

import { App, Form, Input, Modal } from 'antd'
import { useTranslation } from 'react-i18next'

import { changePasswordAction } from '@/app/actions'
import { useActionTransition } from '@/hooks/use-action-transition'
import { PASSWORD_MIN, passwordBytesRule } from '@/lib/auth/fields'

import { changePasswordFailureKey } from './account-errors'
import { signOutAfterPasswordChange } from './sign-out'

const FORM_ID = 'change-password-form'

interface Values {
	currentPassword: string
	newPassword: string
	confirmPassword: string
}

/**
 * The account menu's password change (charter §4.2). The Modal unmounts its body when closed (`destroyOnHidden`),
 * and the form lives in that body with its own instance, so every opening starts empty (.claude/rules/frontend.md).
 * The OK button submits it through the HTML `form` attribute (.claude/rules/frontend.md: a button outside the
 * `<form>` submits through the native `form` attribute), and `confirmLoading` shows the round trip on it (antd
 * Modal API and its "async" demo, the pattern for submitting a form).
 * The action runs through startTransition from onFinish (ADR-0024).
 */
export default function ChangePasswordModal({
	open,
	onClose,
}: {
	open: boolean
	onClose: () => void
}) {
	const { t } = useTranslation()
	const { pending, run } = useActionTransition()
	return (
		<Modal
			open={open}
			onCancel={onClose}
			destroyOnHidden
			title={t('account.change_password')}
			okText={t('account.change_password')}
			cancelText={t('common.cancel')}
			okButtonProps={{ htmlType: 'submit', form: FORM_ID }}
			confirmLoading={pending}
		>
			<ChangePasswordForm run={run} />
		</Modal>
	)
}

function ChangePasswordForm({ run }: { run: (work: () => Promise<void>) => Promise<void> }) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const [form] = Form.useForm<Values>()

	const submit = ({ currentPassword, newPassword }: Values) =>
		void run(async () => {
			const result = await changePasswordAction({ currentPassword, newPassword })
			if (result.ok) {
				await signOutAfterPasswordChange()
				return
			}
			if (result.code === 'invalid_input' && result.fieldErrors?.currentPassword) {
				form.setFields([{ name: 'currentPassword', errors: [t('account.current_password_wrong')] }])
				return
			}
			message.error(t(changePasswordFailureKey(result.code)))
		})

	return (
		<Form
			form={form}
			id={FORM_ID}
			layout="vertical"
			onFinish={submit}
		>
			<Form.Item
				name="currentPassword"
				label={t('account.current_password')}
				rules={[{ required: true, message: t('account.current_password_required') }]}
			>
				<Input.Password autoComplete="current-password" />
			</Form.Item>
			<Form.Item
				name="newPassword"
				label={t('auth.new_password')}
				rules={[
					{ required: true, message: t('auth.password_required') },
					{ min: PASSWORD_MIN, message: t('auth.password_min_8') },
					passwordBytesRule(t('auth.password_too_long')),
				]}
			>
				<Input.Password autoComplete="new-password" />
			</Form.Item>
			<Form.Item
				name="confirmPassword"
				label={t('auth.confirm_password')}
				dependencies={['newPassword']}
				rules={[
					{ required: true, message: t('auth.password_required') },
					({ getFieldValue }) => ({
						// An empty field shows only the required message (antd Form "register" demo).
						validator: (_, value) =>
							!value || value === getFieldValue('newPassword')
								? Promise.resolve()
								: Promise.reject(new Error(t('auth.password_mismatch'))),
					}),
				]}
			>
				<Input.Password autoComplete="new-password" />
			</Form.Item>
		</Form>
	)
}

import ForgotPasswordForm from '@/components/auth/forgot-password-form'
import { isMailConfigured } from '@/lib/mail'

// Reads env on the server; the forgot-password layout (redirectSignedInUser) stays as it is.
export default async function ForgotPasswordPage() {
	return <ForgotPasswordForm mailConfigured={isMailConfigured()} />
}

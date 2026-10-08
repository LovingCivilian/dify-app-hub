import { redirectSignedInUser } from '@/lib/auth/session'

// Reading the session cookie makes this segment dynamic; no force-dynamic needed.
export default async function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
	await redirectSignedInUser()
	return children
}

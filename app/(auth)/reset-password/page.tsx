import ResetPasswordForm from '@/components/auth/reset-password-form'
import { firstParam, type SearchParams } from '@/lib/search-params'

/** Spec §7.4: the token is read on the server; the Suspense wrapper of the client page goes. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
	const params = await searchParams
	return <ResetPasswordForm token={firstParam(params.token)} />
}

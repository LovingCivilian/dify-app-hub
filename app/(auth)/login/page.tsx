import LoginForm from '@/components/auth/login-form'
import { firstParam, type SearchParams } from '@/lib/search-params'

/** Spec §7.2: the server page reads the query; the login layout keeps redirectSignedInUser(). */
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
	const params = await searchParams
	return (
		<LoginForm
			callbackUrl={firstParam(params.callbackUrl)}
			email={firstParam(params.email)}
		/>
	)
}

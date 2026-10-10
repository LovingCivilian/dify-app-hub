import LoginForm from '@/components/auth/login-form'
import { isDirectoryConfigured } from '@/lib/directory/config'
import { isMailConfigured } from '@/lib/mail'
import { firstParam, type SearchParams } from '@/lib/search-params'

/**
 * Spec §7.2: the server page reads the query; the login layout keeps redirectSignedInUser(); a known ?notice= flag
 * becomes a notice (charter §4.2). The form shows the forgot-password link only when mail is configured, and shows
 * the directory tab when the `LDAP_*` block is set (spec §6.3).
 */
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
	const params = await searchParams
	return (
		<LoginForm
			callbackUrl={firstParam(params.callbackUrl)}
			email={firstParam(params.email)}
			notice={firstParam(params.notice) === 'password-changed' ? 'password-changed' : undefined}
			mailConfigured={isMailConfigured()}
			directoryEnabled={isDirectoryConfigured()}
		/>
	)
}

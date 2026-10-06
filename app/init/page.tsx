import { redirect } from 'next/navigation'

import InitForm from '@/components/auth/init-form'
import AuthCard from '@/components/shell/auth-card'
import { hasUsers } from '@/lib/data/users'

/** Spec §7.5: on an initialised instance the server redirects before any form renders (redirect() throws). */
export default async function InitPage() {
	if (await hasUsers()) redirect('/login')
	return (
		<AuthCard>
			<InitForm />
		</AuthCard>
	)
}

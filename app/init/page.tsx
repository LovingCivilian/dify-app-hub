import { redirect } from 'next/navigation'

import InitForm from '@/components/auth/init-form'
import AuthCard from '@/components/shell/auth-card'
import { hasUsers } from '@/lib/data/users'

// Outside the gated groups and reading the database: skip the build-time prerender attempt (as app/(user)/chat/page.tsx does).
export const dynamic = 'force-dynamic'

/** Spec §7.5: on an initialised instance the server redirects before any form renders (redirect() throws). */
export default async function InitPage() {
	if (await hasUsers()) redirect('/login')
	return (
		<AuthCard>
			<InitForm />
		</AuthCard>
	)
}

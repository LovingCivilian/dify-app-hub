import { redirect } from 'next/navigation'

import InitForm from '@/components/auth/init-form'
import AuthCard from '@/components/shell/auth-card'
import { hasAccounts } from '@/lib/data/setup'

// Outside the gated groups and reading the database: skip the build-time prerender attempt (as app/(user)/chat/page.tsx does).
export const dynamic = 'force-dynamic'

/** Charter §4.2: once any account exists the server redirects before any form renders (redirect() throws). */
export default async function InitPage() {
	if (await hasAccounts()) redirect('/login')
	return (
		<AuthCard>
			<InitForm />
		</AuthCard>
	)
}

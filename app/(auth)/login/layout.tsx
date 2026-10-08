import { redirect } from 'next/navigation'

import { redirectSignedInUser } from '@/lib/auth/session'
import { hasAccounts } from '@/lib/data/setup'

export const dynamic = 'force-dynamic'

/**
 * A fresh install has no account, so setup comes first (charter §4.2; this replaces the proxy's
 * /api/init/status fetch). Then a signed-in visitor is sent on (ADR-0018). redirect() throws, so nothing wraps
 * it in try/catch.
 */
export default async function LoginLayout({ children }: { children: React.ReactNode }) {
	if (!(await hasAccounts())) redirect('/init')
	await redirectSignedInUser()
	return children
}

import { redirect } from 'next/navigation'

import { requireUser } from '@/lib/auth/session'
import { listApps } from '@/lib/data/apps'

export const dynamic = 'force-dynamic'

/** `/chat` opens the gallery's first app (listApps: enabled, and the actor's to use), or the app list when there is none. */
export default async function ChatIndexPage() {
	const actor = await requireUser()
	const [first] = await listApps(actor)
	// redirect() works by throwing (Next `redirect` reference), so it stays outside any try/catch.
	redirect(first ? `/chat/${first.id}` : '/apps')
}

import { redirect } from 'next/navigation'

import { requireUser } from '@/lib/auth/session'
import { listApps } from '@/lib/data/apps'

export const dynamic = 'force-dynamic'

/** `/chat` opens the first enabled app, or the app list when there is none. */
export default async function ChatIndexPage() {
	const actor = await requireUser()
	const first = (await listApps(actor)).find(app => app.enabled)
	// redirect() works by throwing (Next `redirect` reference), so it stays outside any try/catch.
	redirect(first ? `/chat/${first.id}` : '/apps')
}

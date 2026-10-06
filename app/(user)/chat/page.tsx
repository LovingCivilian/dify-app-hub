import { redirect } from 'next/navigation'

import { EIsEnabled } from '@/lib/core'
import { getAppList } from '@/repository/app'

export const dynamic = 'force-dynamic'

/** `/chat` opens the first enabled app, or the app list when there is none (spec §3.5). */
export default async function ChatIndexPage() {
	const apps = await getAppList()
	const first = apps.find(app => app.isEnabled !== EIsEnabled.disabled)
	// redirect() works by throwing (Next `redirect` reference), so it stays outside any try/catch.
	redirect(first ? `/chat/${first.id}` : '/apps')
}

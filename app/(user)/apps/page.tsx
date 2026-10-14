import AppGallery from '@/components/apps/app-gallery'
import UserShell from '@/components/shell/user-shell'
import { requireUser } from '@/lib/auth/session'
import { listApps } from '@/lib/data/apps'

/**
 * The server page checks the session, reads the cards from the DAL (the enabled apps the actor may use, already trimmed
 * to AppSummary) and hands them to the client gallery (ADR-0020).
 */
export default async function AppListPage() {
	const actor = await requireUser()
	const apps = await listApps(actor)
	return (
		<UserShell>
			<AppGallery apps={apps} />
		</UserShell>
	)
}

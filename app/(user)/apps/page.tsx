import AppGallery from '@/components/apps/app-gallery'
import { toAppSummaries } from '@/components/apps/app-summary'
import UserShell from '@/components/shell/user-shell'
import { requireUser } from '@/lib/auth/session'
import { listApps } from '@/lib/data/apps'

/** The server page checks the session, reads the DAL, trims and hands plain props to the client gallery (ADR-0020). */
export default async function AppListPage() {
	const actor = await requireUser()
	const apps = toAppSummaries(await listApps(actor))
	return (
		<UserShell>
			<AppGallery apps={apps} />
		</UserShell>
	)
}

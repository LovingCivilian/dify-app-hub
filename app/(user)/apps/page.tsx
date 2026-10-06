import AppGallery from '@/components/apps/app-gallery'
import { toAppSummaries } from '@/components/apps/app-summary'
import UserShell from '@/components/shell/user-shell'
import { requireSessionUser } from '@/lib/session-user'
import { getAppList } from '@/repository/app'

/**
 * Spec §3.1: the server page checks the session where it reads data (Next authentication guide, "Layouts and
 * auth checks"), loads, trims and hands plain props to the client gallery.
 */
export default async function AppListPage() {
	await requireSessionUser()
	const apps = toAppSummaries(await getAppList())
	return (
		<UserShell>
			<AppGallery apps={apps} />
		</UserShell>
	)
}

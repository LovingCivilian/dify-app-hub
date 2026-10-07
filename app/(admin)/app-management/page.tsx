import AppManagement from '@/components/admin/apps/app-management'
import { requireUser } from '@/lib/auth/session'
import { listApps } from '@/lib/data/apps'

/** The DTO carries no key (charter §4.4), so the rows go to the table as they come. */
export default async function AppManagementPage() {
	const actor = await requireUser()
	return <AppManagement apps={await listApps(actor)} />
}

import { toAdminAppRows } from '@/components/admin/apps/admin-app-row'
import AppManagement from '@/components/admin/apps/app-management'
import { requireSessionUser } from '@/lib/session-user'

import { listApp } from './actions'

/** Spec §5.1: masked list, trimmed rows; the real key is fetched with getApp(id) only when an action needs it. */
export default async function AppManagementPage() {
	await requireSessionUser()
	const apps = toAdminAppRows(await listApp({ isMask: true }))
	return <AppManagement apps={apps} />
}

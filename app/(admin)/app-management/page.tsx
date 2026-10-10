import AppManagement from '@/components/admin/apps/app-management'
import { requireAdminUser } from '@/lib/auth/session'
import { listAdminApps } from '@/lib/data/apps'
import { listGroupOptions } from '@/lib/data/groups'
import { listUserOptions } from '@/lib/data/users'

/** The DTO carries no key (charter §4.4); the admin reads add each app's access and the pickers' options (B3 spec §4.4). */
export default async function AppManagementPage() {
	const actor = await requireAdminUser()
	const [apps, groups, users] = await Promise.all([
		listAdminApps(actor),
		listGroupOptions(actor),
		listUserOptions(actor),
	])
	return (
		<AppManagement
			apps={apps}
			groups={groups}
			users={users}
		/>
	)
}

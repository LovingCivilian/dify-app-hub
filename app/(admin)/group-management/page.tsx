import GroupManagement from '@/components/admin/groups/group-management'
import { requireAdminUser } from '@/lib/auth/session'
import { listGroups } from '@/lib/data/groups'
import { listUserOptions } from '@/lib/data/users'
import { isDirectoryConfigured } from '@/lib/directory/config'

/**
 * The groups page (B3 spec §4.3): the server reads the groups and the accounts the member picker offers (ADR-0020),
 * and whether the directory is configured, which shows the directory groups column and field (spec §6.5).
 */
export default async function GroupManagementPage() {
	const actor = await requireAdminUser()
	const [groups, users] = await Promise.all([listGroups(actor), listUserOptions(actor)])
	return (
		<GroupManagement
			groups={groups}
			users={users}
			directoryEnabled={isDirectoryConfigured()}
		/>
	)
}

import UserManagement from '@/components/admin/users/user-management'
import { requireAdminUser } from '@/lib/auth/session'
import { listUsers } from '@/lib/data/users'
import { getDirectoryStatus } from '@/lib/directory/admin'

/** The users table (charter §4.2): the signed-in account's id and role decide its own row and what its rank may manage. */
export default async function UserManagementPage() {
	const user = await requireAdminUser()
	const [users, directory] = await Promise.all([listUsers(user), getDirectoryStatus(user)])
	return (
		<UserManagement
			users={users}
			directory={directory}
			currentUser={{ id: user.id, role: user.role }}
		/>
	)
}

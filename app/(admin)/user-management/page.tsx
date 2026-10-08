import UserManagement from '@/components/admin/users/user-management'
import { requireAdminUser } from '@/lib/auth/session'
import { listUsers } from '@/lib/data/users'

/** The users table (charter §4.2): the signed-in account's id and role decide its own row and what its rank may manage. */
export default async function UserManagementPage() {
	const user = await requireAdminUser()
	return (
		<UserManagement
			users={await listUsers(user)}
			currentUser={{ id: user.id, role: user.role }}
		/>
	)
}

import UserManagement from '@/components/admin/users/user-management'
import { toUserRows } from '@/components/admin/users/user-row'
import { requireAdminUser } from '@/lib/auth/session'
import { listUsers } from '@/lib/data/users'

/** Spec §6 of sub-project 3: the signed-in user's database id hides their own Delete. */
export default async function UserManagementPage() {
	const user = await requireAdminUser()
	const users = await listUsers()
	return (
		<UserManagement
			users={toUserRows(users)}
			currentUserId={user.id}
		/>
	)
}

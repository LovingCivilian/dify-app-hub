import UserManagement from '@/components/admin/users/user-management'
import { requireAdminUser } from '@/lib/auth/session'
import { listUsers } from '@/lib/data/users'

/** Spec §6 of sub-project 3: the signed-in user's database id hides their own Delete. */
export default async function UserManagementPage() {
	const user = await requireAdminUser()
	return (
		<UserManagement
			users={await listUsers(user)}
			currentUserId={user.id}
		/>
	)
}

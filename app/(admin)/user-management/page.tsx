import UserManagement from '@/components/admin/users/user-management'
import { toUserRows } from '@/components/admin/users/user-row'
import { listUsers } from '@/lib/data/users'
import { getCachedServerSession, requireSessionUser } from '@/lib/session-user'

/** Spec §6: the signed-in user's database id (session.user.id; getSessionUserId() is the email) hides their Delete. */
export default async function UserManagementPage() {
	await requireSessionUser()
	const [session, users] = await Promise.all([getCachedServerSession(), listUsers()])
	return (
		<UserManagement
			users={toUserRows(users)}
			currentUserId={session?.user?.id ?? ''}
		/>
	)
}

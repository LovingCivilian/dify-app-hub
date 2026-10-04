import { requireSessionUser } from '@/lib/session-user'

export const dynamic = 'force-dynamic'

export default async function UserLayout({ children }: { children: React.ReactNode }) {
	await requireSessionUser()
	return children
}

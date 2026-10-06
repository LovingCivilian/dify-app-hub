import AdminShell from '@/components/shell/admin-shell'
import { requireSessionUser } from '@/lib/session-user'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
	await requireSessionUser()
	return <AdminShell>{children}</AdminShell>
}

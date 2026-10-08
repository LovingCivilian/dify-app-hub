import AdminShell from '@/components/shell/admin-shell'
import { requireAdminUser } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
	await requireAdminUser()
	return <AdminShell>{children}</AdminShell>
}

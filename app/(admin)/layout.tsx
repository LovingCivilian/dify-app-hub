import AuthGuard from '@/components/auth/auth-guard'
import AdminShell from '@/components/shell/admin-shell'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
	return (
		<AuthGuard>
			<AdminShell>{children}</AdminShell>
		</AuthGuard>
	)
}

import AuthCard from '@/components/shell/auth-card'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
	return <AuthCard>{children}</AuthCard>
}

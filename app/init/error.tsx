'use client'

import AuthCard from '@/components/shell/auth-card'
import RouteError from '@/components/shell/route-error'

export default function InitError({
	retry,
}: {
	error: Error & { digest?: string }
	retry: () => void
}) {
	return (
		<AuthCard>
			<RouteError retry={retry} />
		</AuthCard>
	)
}

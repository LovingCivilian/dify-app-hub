'use client'

import RouteError from '@/components/shell/route-error'
import UserShell from '@/components/shell/user-shell'

// Error boundaries must be client components; Next 16.3 passes error, reset and retry (error.md).
export default function AppListError({
	retry,
}: {
	error: Error & { digest?: string }
	retry: () => void
}) {
	return (
		<UserShell>
			<RouteError retry={retry} />
		</UserShell>
	)
}

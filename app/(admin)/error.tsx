'use client'

import RouteError from '@/components/shell/route-error'

// Rendered inside AdminShell (an error.tsx does not wrap its own segment's layout, error.md).
export default function AdminError({
	retry,
}: {
	error: Error & { digest?: string }
	retry: () => void
}) {
	return <RouteError retry={retry} />
}

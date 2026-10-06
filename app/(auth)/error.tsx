'use client'

import RouteError from '@/components/shell/route-error'

// Rendered inside the (auth) layout's AuthCard (an error.tsx does not wrap its own segment's layout, error.md).
export default function AuthError({
	retry,
}: {
	error: Error & { digest?: string }
	retry: () => void
}) {
	return <RouteError retry={retry} />
}

'use client'

import { usePathname } from 'next/navigation'
import React from 'react'

import AuthGuard from '../auth/auth-guard'
import AdminPageLayout from './admin-page-layout'

/** Temporary (until the route groups land): admin pages get the admin layout, everything else renders as is. */
export default function PageLayoutWrapper({ children }: { children: React.ReactNode }) {
	const pathname = usePathname()
	const isPublicPage =
		pathname === '/login' ||
		pathname === '/forgot-password' ||
		pathname === '/reset-password' ||
		pathname?.startsWith('/init') ||
		pathname?.startsWith('/chat') ||
		pathname?.startsWith('/apps') ||
		pathname?.startsWith('/auth')

	return isPublicPage ? (
		children
	) : (
		<AuthGuard>
			<AdminPageLayout>{children}</AdminPageLayout>
		</AuthGuard>
	)
}

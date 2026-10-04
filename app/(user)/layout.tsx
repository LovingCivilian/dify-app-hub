'use client'

import { Spin } from 'antd'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { useAuth } from '@/hooks/use-auth'

export default function UserLayout({ children }: { children: React.ReactNode }) {
	const { isAuthorized, isLoading } = useAuth()
	const router = useRouter()

	useEffect(() => {
		if (!isLoading && !isAuthorized) {
			router.replace('/login')
		}
	}, [isAuthorized, isLoading, router])

	if (isLoading || !isAuthorized) {
		return <Spin fullscreen />
	}
	return children
}

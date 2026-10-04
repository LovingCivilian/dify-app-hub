'use client'

import { ThemeContextProvider, useThemeContext } from '@/lib/theme'
import { App, ConfigProvider, Spin, theme } from 'antd'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/hooks/use-auth'
import { initResponsiveConfig } from '@/lib/helpers'
import { getAntdLocale } from '@/libs/antd-locale'

import '@/libs/i18n'

initResponsiveConfig()

function UserLayoutInner({ children }: { children: React.ReactNode }) {
	const { isAuthorized, isLoading } = useAuth()
	const router = useRouter()
	const { i18n } = useTranslation()
	const { isDark } = useThemeContext()

	useEffect(() => {
		if (!isLoading && !isAuthorized) {
			router.replace('/login')
		}
	}, [isAuthorized, isLoading, router])

	return (
		<ConfigProvider
			locale={getAntdLocale(i18n.resolvedLanguage)}
			theme={{
				algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
			}}
		>
			<App>
				{isLoading ? (
					<div className="flex min-h-screen items-center justify-center">
						<Spin spinning />
					</div>
				) : (
					children
				)}
			</App>
		</ConfigProvider>
	)
}

export default function UserLayout({ children }: { children: React.ReactNode }) {
	return (
		<ThemeContextProvider>
			<UserLayoutInner>{children}</UserLayoutInner>
		</ThemeContextProvider>
	)
}

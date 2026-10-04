'use client'

import { XProvider } from '@ant-design/x'
import { App, theme } from 'antd'
import { SessionProvider } from 'next-auth/react'
import { useTranslation } from 'react-i18next'

import { useHtmlLang } from '@/hooks/use-html-lang'
import { initResponsiveConfig } from '@/lib/helpers'
import { ThemeContextProvider, useThemeContext } from '@/lib/theme'
import { getAntdLocale } from '@/libs/antd-locale'

import '@/libs/i18n'

initResponsiveConfig()

/**
 * antd / Ant Design X configuration for the whole app: the only XProvider (it supersedes ConfigProvider)
 * and the App context that backs App.useApp(). Theme algorithm from the theme-mode switch, locale from i18next.
 */
// ADR-0008: the one XProvider + App stack for the whole app — docs/decisions/0008-rebuild-frontend-on-ant-design-6-and-x-2.md
function AntdProviders({ children }: { children: React.ReactNode }) {
	const { isDark } = useThemeContext()
	const { i18n } = useTranslation()
	useHtmlLang()

	return (
		<XProvider
			locale={getAntdLocale(i18n.resolvedLanguage)}
			theme={{ algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm }}
		>
			<App>{children}</App>
		</XProvider>
	)
}

export default function AppProviders({ children }: { children: React.ReactNode }) {
	return (
		<SessionProvider>
			<ThemeContextProvider>
				<AntdProviders>{children}</AntdProviders>
			</ThemeContextProvider>
		</SessionProvider>
	)
}

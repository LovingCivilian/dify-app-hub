'use client'

import { XProvider } from '@ant-design/x'
import { App, theme } from 'antd'
import { SessionProvider, type SessionProviderProps } from 'next-auth/react'
import { useTranslation } from 'react-i18next'

import { useHtmlLang } from '@/hooks/use-html-lang'
import { initResponsiveConfig } from '@/lib/helpers'
import { ThemeContextProvider, useThemeContext } from '@/lib/theme'
import type { InitialTheme } from '@/lib/theme/theme-cookie'
import { getAntdLocale } from '@/libs/antd-locale'

import '@/libs/i18n'

initResponsiveConfig()

// The session as SessionProvider types it. `Session` imported from 'next-auth' resolves to the ambient
// module declaration in types/next-auth.d.ts (no `expires`), which the provider's `session` prop rejects.
type ServerSession = NonNullable<SessionProviderProps['session']> | null

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

export default function AppProviders({
	session,
	initialTheme,
	children,
}: {
	session: ServerSession
	initialTheme: InitialTheme
	children: React.ReactNode
}) {
	return (
		// next-auth: a session passed from the server avoids the loading state on first load.
		<SessionProvider session={session}>
			<ThemeContextProvider initialTheme={initialTheme}>
				<AntdProviders>{children}</AntdProviders>
			</ThemeContextProvider>
		</SessionProvider>
	)
}

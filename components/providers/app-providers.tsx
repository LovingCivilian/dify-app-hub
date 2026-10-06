'use client'

import { XProvider } from '@ant-design/x'
import { App, theme } from 'antd'
import { SessionProvider, type SessionProviderProps } from 'next-auth/react'
import { useEffect, useState } from 'react'
import { I18nextProvider, useSSR, useTranslation } from 'react-i18next'

import { useHtmlLang } from '@/hooks/use-html-lang'
import { initResponsiveConfig } from '@/lib/helpers'
import type { SupportedLanguage } from '@/lib/i18n/language-cookie'
import { ThemeContextProvider, useThemeContext } from '@/lib/theme'
import type { InitialTheme } from '@/lib/theme/theme-cookie'
import { getAntdLocale } from '@/libs/antd-locale'
import i18n from '@/libs/i18n'
import { getXLocale } from '@/libs/x-locale'

initResponsiveConfig()

// The session as SessionProvider types it. `Session` imported from 'next-auth' resolves to the ambient
// module declaration in types/next-auth.d.ts (no `expires`), which the provider's `session` prop rejects.
type ServerSession = NonNullable<SessionProviderProps['session']> | null

/**
 * The i18next instance for this render: a clone per server render, set to the cookie's language, and the one
 * module instance in the browser (shape from Next's TanStack Query guide: "a new query client for each server
 * render and reuse one query client in the browser"). The clone keeps concurrent requests from changing the shared
 * instance (i18next API, cloneInstance: "independent on set language"; react-i18next SSR docs: an instance per
 * request through I18nextProvider). The browser instance carries the language detector that writes the cookie.
 */
// ADR-0005 (note 2026-10-05): the UI language is a cookie the server renders — docs/decisions/0005-internationalise-the-ui-with-typed-i18next-keys-and-msa-arabic.md
const getI18nInstance = (language: SupportedLanguage) =>
	typeof window === 'undefined' ? i18n.cloneInstance({ lng: language }) : i18n

/**
 * The first client render uses the server's language: react-i18next's useSSR "will call changeLanguage" with the
 * initial language, once, and does nothing for the server's clone. The bundled translations are already in the
 * store, so the store is passed as it is. A language the detector found without a usable cookie (an older
 * localStorage value, the browser language) is applied once after hydration, which also writes the cookie for the
 * next server render (the migration pattern of the theme cookies, ADR-0016).
 */
function InitialLanguage({
	language,
	children,
}: {
	language: SupportedLanguage
	children: React.ReactNode
}) {
	const { i18n: instance } = useTranslation()
	// Read before useSSR applies the server's language: what the detector chose (cookie → localStorage → navigator).
	const [detected] = useState(() => instance.resolvedLanguage)
	useSSR(instance.store.data, language)
	useEffect(() => {
		if (detected && detected !== language) void instance.changeLanguage(detected)
		// Once after hydration; later changes come from the language dropdown, which this must never undo.
	}, [])
	return children
}

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
			locale={{ ...getAntdLocale(i18n.resolvedLanguage), ...getXLocale(i18n.resolvedLanguage) }}
			theme={{ algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm }}
		>
			<App>{children}</App>
		</XProvider>
	)
}

export default function AppProviders({
	session,
	initialTheme,
	initialLanguage,
	children,
}: {
	session: ServerSession
	initialTheme: InitialTheme
	initialLanguage: SupportedLanguage
	children: React.ReactNode
}) {
	return (
		<I18nextProvider i18n={getI18nInstance(initialLanguage)}>
			<InitialLanguage language={initialLanguage}>
				{/* next-auth: a session passed from the server avoids the loading state on first load. */}
				<SessionProvider session={session}>
					<ThemeContextProvider initialTheme={initialTheme}>
						<AntdProviders>{children}</AntdProviders>
					</ThemeContextProvider>
				</SessionProvider>
			</InitialLanguage>
		</I18nextProvider>
	)
}

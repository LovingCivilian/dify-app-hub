import { AntdRegistry } from '@ant-design/nextjs-registry'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import AppProviders from '@/components/providers/app-providers'
import { readLanguageCookie } from '@/lib/i18n/language-cookie'
import { getCachedServerSession } from '@/lib/auth/session'
import { brandingView, getBranding } from '@/lib/settings/branding'
import { BUILT_IN_LOGO } from '@/lib/settings/built-in-logo'
import { ThemeEnum } from '@/lib/theme/constants'
import { readThemeCookies } from '@/lib/theme/theme-cookie'

// antd's browser reset (box-sizing, body margin, heading, paragraph and list margins, form-control font inheritance),
// the only global CSS since sub-project 4 (ADR-0021). No @layer wrapper: that is only needed with `StyleProvider layer`,
// which this app does not enable. Text colour, font and line height come from antd's <App> root (`.ant-app`).
import 'antd/dist/reset.css'

/**
 * The tab title and icon follow the brand (settings spec §4.6). app/favicon.ico is gone: a file-based icon overrides
 * generateMetadata (generate-metadata.md:114). getBranding is one read per request (React cache).
 */
export async function generateMetadata(): Promise<Metadata> {
	const view = brandingView(await getBranding(), BUILT_IN_LOGO)
	return {
		title: view.name,
		description: 'A Dify web app that fits your business',
		icons: { icon: view.faviconSrc },
	}
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	const [session, cookieStore, branding] = await Promise.all([
		getCachedServerSession(),
		cookies(),
		getBranding(),
	])
	const initialTheme = readThemeCookies(name => cookieStore.get(name)?.value)
	// The language detector's cookie (libs/i18n.ts), so the first HTML is already in the visitor's language.
	const initialLanguage = readLanguageCookie(name => cookieStore.get(name)?.value)
	// The browser's scheme for the canvas behind the shell, native controls and scrollbars (CSS color-scheme, ADR-0021);
	// antd's dark algorithm is applied by ThemeContextProvider. Rendered from the cookie so the first paint matches,
	// toggled in lib/theme/theme-context.tsx. `only light` forbids the browser's own override of the light theme (Chrome's Auto Dark Theme; MDN color-scheme, the `only` keyword).
	const colorScheme = initialTheme.resolved === ThemeEnum.DARK ? 'dark' : 'only light'
	return (
		<html
			lang={initialLanguage}
			suppressHydrationWarning
			style={{ colorScheme }}
		>
			<body>
				<AntdRegistry>
					<AppProviders
						session={session}
						initialTheme={initialTheme}
						initialLanguage={initialLanguage}
						branding={brandingView(branding, BUILT_IN_LOGO)}
					>
						{children}
					</AppProviders>
				</AntdRegistry>
			</body>
		</html>
	)
}

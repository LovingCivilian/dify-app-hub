import { AntdRegistry } from '@ant-design/nextjs-registry'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import AppProviders from '@/components/providers/app-providers'
import { readLanguageCookie } from '@/lib/i18n/language-cookie'
import { getCachedServerSession } from '@/lib/session-user'
import { ThemeEnum } from '@/lib/theme/constants'
import { readThemeCookies } from '@/lib/theme/theme-cookie'

// antd's browser reset (box-sizing, body margin, heading, paragraph and list margins, form-control font inheritance)
// in place of Tailwind's Preflight (ADR-0021). No @layer wrapper: that is only needed with `StyleProvider layer`,
// which this app does not enable. Text colour, font and line height come from antd's <App> root (`.ant-app`).
import 'antd/dist/reset.css'

export const metadata: Metadata = {
	title: 'Dify App Hub',
	description: 'A Dify web app that fits your business',
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	const [session, cookieStore] = await Promise.all([getCachedServerSession(), cookies()])
	const initialTheme = readThemeCookies(name => cookieStore.get(name)?.value)
	// The language detector's cookie (libs/i18n.ts), so the first HTML is already in the visitor's language.
	const initialLanguage = readLanguageCookie(name => cookieStore.get(name)?.value)
	const bodyClass = initialTheme.resolved === ThemeEnum.DARK ? 'antialiased dark' : 'antialiased'
	return (
		<html
			lang={initialLanguage}
			suppressHydrationWarning
		>
			<body className={bodyClass}>
				<AntdRegistry>
					<AppProviders
						session={session}
						initialTheme={initialTheme}
						initialLanguage={initialLanguage}
					>
						{children}
					</AppProviders>
				</AntdRegistry>
			</body>
		</html>
	)
}

import { AntdRegistry } from '@ant-design/nextjs-registry'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import AppProviders from '@/components/providers/app-providers'
import { readLanguageCookie } from '@/lib/i18n/language-cookie'
import { getCachedServerSession } from '@/lib/session-user'
import { ThemeEnum } from '@/lib/theme/constants'
import { readThemeCookies } from '@/lib/theme/theme-cookie'

import './globals.css'

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

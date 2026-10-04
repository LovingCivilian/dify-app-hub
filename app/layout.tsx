import { AntdRegistry } from '@ant-design/nextjs-registry'
import type { Metadata } from 'next'

import PageLayoutWrapper from '@/components/layout/page-layout-wrapper'
import AppProviders from '@/components/providers/app-providers'

import './globals.css'

export const metadata: Metadata = {
	title: 'Dify App Hub',
	description: 'A Dify web app that fits your business',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html
			lang="en"
			suppressHydrationWarning
		>
			<body className="antialiased">
				<AntdRegistry>
					<AppProviders>
						<PageLayoutWrapper>{children}</PageLayoutWrapper>
					</AppProviders>
				</AntdRegistry>
			</body>
		</html>
	)
}

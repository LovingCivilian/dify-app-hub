import { AntdRegistry } from '@ant-design/nextjs-registry'
import type { Metadata } from 'next'

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
					<AppProviders>{children}</AppProviders>
				</AntdRegistry>
			</body>
		</html>
	)
}

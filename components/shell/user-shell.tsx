'use client'

import { Layout } from 'antd'

import AppHeader, { type AppHeaderProps } from './app-header'
import styles from './shell.module.css'

/** Shell for the user area: the shared header plus a content region; pages pass header slots through. */
export default function UserShell({
	children,
	...header
}: AppHeaderProps & { children: React.ReactNode }) {
	return (
		<Layout className={styles.root}>
			<AppHeader {...header} />
			<Layout.Content className={styles.content}>{children}</Layout.Content>
		</Layout>
	)
}

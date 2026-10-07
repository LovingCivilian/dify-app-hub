'use client'

import { Card, Flex, Tag, Typography, theme } from 'antd'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'

import styles from './app-gallery.module.css'
import AppIcon from './app-icon'
import { APP_MODE_NAME_KEYS } from './app-modes'
import type { AppSummary } from './app-summary'

/**
 * One app (spec §4.2): a real link around a hoverable Card, so the keyboard and "open in new tab" work. antd
 * documents no whole-card link pattern; this is plain HTML semantics.
 */
export default function AppCard({ app }: { app: AppSummary }) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	return (
		<Link
			href={`/chat/${app.id}`}
			className={styles.cardLink}
		>
			<Card
				hoverable
				className={styles.card}
			>
				<Card.Meta
					avatar={
						<AppIcon
							appId={app.id}
							icon={app.icon}
							mode={app.mode}
						/>
					}
					title={app.name}
					description={app.mode ? t(APP_MODE_NAME_KEYS[app.mode]) : undefined}
				/>
				<Typography.Paragraph
					type="secondary"
					ellipsis={{ rows: 2 }}
					className={styles.description}
					style={{ marginBottom: 0 }}
				>
					{app.description || t('app.no_description_user')}
				</Typography.Paragraph>
				{app.tags.length > 0 && (
					<Flex
						wrap
						gap="small"
						// style, not a module class: antd's Flex resets margin (es/flex/style/index.js:10-11) at 0,1,1.
						style={{ marginTop: token.marginSM }}
					>
						{app.tags.map(tag => (
							<Tag key={tag}>{tag}</Tag>
						))}
					</Flex>
				)}
			</Card>
		</Link>
	)
}

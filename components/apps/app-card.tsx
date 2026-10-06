'use client'

import { Card, Flex, Tag, Typography } from 'antd'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'

import { AppModeNames } from '@/lib/core'

import styles from './app-gallery.module.css'
import AppIcon from './app-icon'
import type { AppSummary } from './app-summary'

/**
 * One app (spec §4.2): a real link around a hoverable Card, so the keyboard and "open in new tab" work. antd
 * documents no whole-card link pattern; this is plain HTML semantics. A row without info is not a link.
 */
export default function AppCard({ app }: { app: AppSummary }) {
	const { t } = useTranslation()
	if (app.missingInfo) {
		return (
			<Card className={styles.card}>
				<Typography.Text type="secondary">{t('app.info_missing')}</Typography.Text>
			</Card>
		)
	}
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
							mode={app.mode}
						/>
					}
					title={app.name}
					description={app.mode ? t(AppModeNames[app.mode]) : undefined}
				/>
				<Typography.Paragraph
					type="secondary"
					ellipsis={{ rows: 2 }}
					className={styles.description}
				>
					{app.description || t('app.no_description_user')}
				</Typography.Paragraph>
				{app.tags.length > 0 && (
					<Flex
						wrap
						gap="small"
						className={styles.tags}
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

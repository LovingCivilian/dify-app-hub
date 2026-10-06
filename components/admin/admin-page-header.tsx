'use client'

import { Flex, Typography } from 'antd'

import styles from './admin-page-header.module.css'

/** Title, optional subtitle and the page's primary action; wraps on narrow screens (spec §3.4). */
export default function AdminPageHeader({
	title,
	subtitle,
	action,
}: {
	title: React.ReactNode
	subtitle?: React.ReactNode
	action?: React.ReactNode
}) {
	return (
		<Flex
			wrap
			justify="space-between"
			align="center"
			gap="small"
		>
			<div>
				<Typography.Title
					level={4}
					className={styles.title}
				>
					{title}
				</Typography.Title>
				{subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}
			</div>
			{action}
		</Flex>
	)
}

'use client'

import { Flex, Typography } from 'antd'

/**
 * The header of a list page (apps, app management, user management): a level-4 title with its
 * subtitle under it and the page's primary action at the end; wraps on narrow screens (sub-project 3
 * spec §3.4, cosmetic sweep 1 item 4: the subtitle is on every page so the titles line up).
 */
export default function PageHeader({
	title,
	subtitle,
	action,
}: {
	title: React.ReactNode
	subtitle: React.ReactNode
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
					style={{ margin: 0 }}
				>
					{title}
				</Typography.Title>
				<Typography.Text type="secondary">{subtitle}</Typography.Text>
			</div>
			{action}
		</Flex>
	)
}

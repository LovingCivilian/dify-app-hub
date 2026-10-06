'use client'

import { Card, Col, Flex, Row, Skeleton, theme } from 'antd'

import styles from './app-gallery.module.css'

const PLACEHOLDER_CARDS = 4

/** The app list while its server page loads (app/(user)/apps/loading.tsx). */
export default function AppGallerySkeleton() {
	const { token } = theme.useToken()
	return (
		<Flex
			vertical
			gap={token.margin}
			className={styles.page}
		>
			<Skeleton
				active
				title
				paragraph={false}
			/>
			<Row gutter={[token.margin, token.margin]}>
				{Array.from({ length: PLACEHOLDER_CARDS }, (_, index) => (
					<Col
						key={index}
						xs={24}
						sm={12}
						lg={8}
						xl={6}
					>
						<Card loading />
					</Col>
				))}
			</Row>
		</Flex>
	)
}

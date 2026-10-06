'use client'

import { Col, Empty, Flex, Row, Typography, theme } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import SearchInput from '@/components/shell/search-input'
import { matchesQuery } from '@/lib/match-query'

import AppCard from './app-card'
import styles from './app-gallery.module.css'
import type { AppSummary } from './app-summary'

/** The app list (spec §4.2, §4.4): title, search, a responsive card grid and the two empty states. */
export default function AppGallery({ apps }: { apps: AppSummary[] }) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const [query, setQuery] = useState('')
	// A row without info has nothing to search, so it shows only while the query is empty.
	const shown = apps.filter(app =>
		app.missingInfo ? !query.trim() : matchesQuery([app.name, app.description, ...app.tags], query),
	)

	return (
		<Flex
			vertical
			gap={token.margin}
			className={styles.page}
		>
			<Typography.Title
				level={4}
				className={styles.title}
			>
				{t('app.list')}
			</Typography.Title>
			{apps.length === 0 ? (
				<Empty description={t('app.empty_contact_admin')} />
			) : (
				<>
					<Row>
						<Col
							xs={24}
							md={12}
							lg={8}
						>
							<SearchInput
								placeholder={t('app.search_placeholder')}
								value={query}
								onChange={setQuery}
							/>
						</Col>
					</Row>
					{shown.length === 0 ? (
						<Empty
							image={Empty.PRESENTED_IMAGE_SIMPLE}
							description={t('app.no_match')}
						/>
					) : (
						<Row gutter={[token.margin, token.margin]}>
							{shown.map(app => (
								<Col
									key={app.id}
									xs={24}
									sm={12}
									lg={8}
									xl={6}
								>
									<AppCard app={app} />
								</Col>
							))}
						</Row>
					)}
				</>
			)}
		</Flex>
	)
}

'use client'

import { Card, Col, Flex, Row, Typography, theme } from 'antd'

import { useBranding } from '@/components/providers/branding-context'

import styles from './auth-card.module.css'
import BrandLogo from './brand-logo'

/**
 * Centred card with the brand header for login, password reset and first-run setup (spec §7.1): the configured
 * logo and name, settings spec §4.6. The logo keeps its stored proportions at the card's height (BrandLogo).
 */
export default function AuthCard({ children }: { children: React.ReactNode }) {
	const { token } = theme.useToken()
	const branding = useBranding()
	return (
		<Row
			align="middle"
			justify="center"
			className={styles.surface}
		>
			<Col
				xs={24}
				sm={16}
				md={12}
				lg={10}
				xl={8}
			>
				<Card>
					<Flex
						vertical
						align="center"
						gap="small"
						// style, not a module class: antd's Flex resets margin (es/flex/style/index.js:10-11) at 0,1,1.
						style={{ marginBottom: token.marginLG }}
					>
						{branding.logo && (
							<BrandLogo
								image={branding.logo}
								height={64}
								// Alone, the image carries the name (W3C WAI Images Tutorial, informative images).
								alt={branding.showName ? '' : branding.name}
							/>
						)}
						{/* Typography margins out-specify a single module class, so reset through style. */}
						{branding.showName && (
							<Typography.Title
								level={3}
								style={{ margin: 0 }}
							>
								{branding.name}
							</Typography.Title>
						)}
					</Flex>
					{children}
				</Card>
			</Col>
		</Row>
	)
}

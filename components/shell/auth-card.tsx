'use client'

import { Card, Col, Flex, Row, Typography } from 'antd'
import Image from 'next/image'

import LogoIcon from '@/assets/images/logo.png'

import styles from './auth-card.module.css'

/**
 * Centred card with the brand header for login, password reset and first-run setup (spec §7.1). The logo keeps
 * its own 81×83 proportions: `width` only, and next/image derives the height from the static import.
 */
export default function AuthCard({ children }: { children: React.ReactNode }) {
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
						className={styles.brand}
					>
						<Image
							src={LogoIcon}
							width={64}
							alt=""
							priority
						/>
						{/* Typography margins out-specify a single module class, so reset through style. */}
						<Typography.Title
							level={3}
							style={{ margin: 0 }}
						>
							Dify App Hub
						</Typography.Title>
					</Flex>
					{children}
				</Card>
			</Col>
		</Row>
	)
}

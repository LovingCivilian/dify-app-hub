'use client'

import { Card, Col, Row, theme } from 'antd'

/** Centred card on the layout surface for login, password reset and first-run setup. */
export default function AuthCard({
	title,
	children,
}: {
	title?: React.ReactNode
	children: React.ReactNode
}) {
	const { token } = theme.useToken()
	return (
		<Row
			align="middle"
			justify="center"
			style={{ minHeight: '100vh', background: token.colorBgLayout, padding: token.paddingLG }}
		>
			<Col
				xs={24}
				sm={16}
				md={12}
				lg={8}
				xl={6}
			>
				<Card title={title}>{children}</Card>
			</Col>
		</Row>
	)
}

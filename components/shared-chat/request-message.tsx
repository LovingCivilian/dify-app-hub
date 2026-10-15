'use client'

import { Typography } from 'antd'

import styles from './request-message.module.css'

/**
 * An agent's request in a card's bordered box (approval-actions.tsx, interrupt-card.tsx, answered-interrupt-card.tsx):
 * its message as secondary text with its line breaks kept, as the agent sent it, a text node and never HTML (spec
 * §6.4). antd Typography `type` (`antd info Typography --version 6.6.5`); Typography resets its margins, so the
 * Paragraph's bottom margin goes through `style` (ADR-0020).
 */
export default function RequestMessage({ children }: { children: string }) {
	return (
		<Typography.Paragraph
			type="secondary"
			className={styles.request}
			style={{ marginBottom: 0 }}
		>
			{children}
		</Typography.Paragraph>
	)
}

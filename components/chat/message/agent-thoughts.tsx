'use client'

import { ThoughtChain, type ThoughtChainItemType } from '@ant-design/x'
import { Typography } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { IAgentThought } from '@/lib/api'

import { thoughtStatus } from './thought-status'
import styles from './workflow-logs.module.css'

export interface AgentThoughtsProps {
	thoughts?: IAgentThought[]
	streaming: boolean
	/** How the reply was cut short, if it was (a stream error or the user's stop). */
	interrupted?: 'error' | 'abort'
}

/**
 * An agent's tool calls in X ThoughtChain (spec §5.2): one collapsible step per thought that used a tool,
 * its input and observation as code. Thoughts without a tool are the answer's own text and are not steps.
 */
export default function AgentThoughts({ thoughts, streaming, interrupted }: AgentThoughtsProps) {
	const { t } = useTranslation()
	const items = useMemo<ThoughtChainItemType[]>(() => {
		const tools = (thoughts ?? []).filter(thought => thought.tool)
		return tools.map((thought, index) => {
			const status = thoughtStatus(thought, {
				last: index === tools.length - 1,
				streaming,
				interrupted,
			})
			return {
				key: thought.id || String(thought.position),
				title: `${t('message.tool.title_prefix')} ${thought.tool}`,
				status,
				blink: status === 'loading',
				collapsible: true,
				content: (
					<>
						<Typography.Text type="secondary">{t('message.tool.request')}</Typography.Text>
						<pre className={styles.code}>{thought.tool_input}</pre>
						<Typography.Text type="secondary">{t('message.tool.response')}</Typography.Text>
						<pre className={styles.code}>{thought.observation}</pre>
					</>
				),
			}
		})
	}, [thoughts, streaming, interrupted, t])

	if (!items.length) return null
	return <ThoughtChain items={items} />
}

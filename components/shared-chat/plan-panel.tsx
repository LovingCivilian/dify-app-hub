'use client'

import { UnorderedListOutlined } from '@ant-design/icons'
import { Flex, Progress, Steps } from 'antd'
import type { StepsProps } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { planProgress, planStepStatus, type PlanStep } from '@/lib/chat/plan-state'

import { cardBadge } from './card-icons'
import ChatCard from './chat-card'
import { planBadge } from './chat-card-view'

/**
 * The agent's plan above the composer (spec §6.4, decision 47, plan call P17): the full-stack template's panel
 * (`frontend/src/components/chat/research-panel.tsx`: a "Plan 2/5" header, a progress bar, the steps by status, closed
 * once no step is left) as the chat's card (chat-card.tsx), headed "Plan" with its progress, "1/3", as the badge, and
 * "Completed" once every step is (chat-card-view.ts `planBadge`); its body a small Progress and vertical small Steps
 * (antd 6.6.5 `Steps`: `orientation`, which replaces the deprecated `direction`; an item's own `status` wins over
 * `current`, `@rc-component/steps` `Steps.js`). Each step's description is its item's title, a text node (spec §6.4:
 * every text renders as text).
 */
export default function PlanPanel({ steps }: { steps: PlanStep[] }) {
	const { t } = useTranslation()
	const progress = planProgress(steps)
	const { done, total, percent, complete } = progress
	// A finished plan starts closed; the user opens and closes it at will.
	const [open, setOpen] = useState(!complete)
	// React "You Might Not Need an Effect" › "Adjusting some state when a prop changes": the previous value lives in
	// state and the panel is set while rendering, so it closes when the plan completes and opens again when a new one
	// starts (the template's rule, `research-panel.tsx` lines 65–71), with no Effect and no stale frame.
	const [wasComplete, setWasComplete] = useState(complete)
	if (complete !== wasComplete) {
		setWasComplete(complete)
		setOpen(!complete)
	}
	const items = useMemo<StepsProps['items']>(
		() =>
			steps.map((step, index) => ({
				key: index,
				title: step.description,
				status: planStepStatus(step.status),
			})),
		[steps],
	)
	return (
		<ChatCard
			open={open}
			onOpenChange={setOpen}
			icon={<UnorderedListOutlined />}
			title={t('shared_chat.plan.label')}
			badge={cardBadge(planBadge(progress), t, { done, total })}
		>
			<Flex
				vertical
				gap="small"
			>
				<Progress
					percent={percent}
					size="small"
				/>
				<Steps
					orientation="vertical"
					size="small"
					items={items}
				/>
			</Flex>
		</ChatCard>
	)
}
